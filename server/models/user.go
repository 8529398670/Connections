// Package models holds one file per stored record type. There is no ORM and
// no query builder -- each file is a small set of plain functions over the db
// store, which is enough for a bolt key/value file and keeps the storage
// layer readable end to end.
package models

import (
	errors "errors"
	strings "strings"
	time "time"

	bolt "go.etcd.io/bbolt"

	db "connections/server/db"
	encryption "connections/server/encryption"
)

const (
	RoleAdmin = "admin"
	RoleUser  = "user"
)

// User has no password field, and adding one would undo the entire design
// here: identity is proven only by redeeming a login link or presenting a
// session cookie. See references/architecture.md before changing that.
type User struct {
	ID          uint64     `json:"id"`
	DisplayName string     `json:"display_name"`
	Role        string     `json:"role"`
	CreatedAt   time.Time  `json:"created_at"`
	DisabledAt  *time.Time `json:"disabled_at,omitempty"`

	// Game features an admin has switched off for this player. Stored as
	// "off" so every existing record, and every new one, has them on.
	HintsOff bool `json:"hints_off,omitempty"`

	// How far off a wrong guess may be and still get an "N missing" alert:
	// 0 never, 3 always. nil is DefaultMissingHint, so records written
	// before this field existed keep the original "1 missing" behaviour.
	MissingHint *int `json:"missing_hint,omitempty"`

	// Whether this player may switch on Unlimited guessing in their settings.
	// Off unless an admin turns it on.
	UnlimitedGuesses bool `json:"unlimited_guesses,omitempty"`
}

const (
	DefaultMissingHint = 1
	MaxMissingHint     = 3
)

func ( user *User ) MissingHintLevel() ( level int ) {
	level = DefaultMissingHint
	if user.MissingHint != nil { level = *user.MissingHint }
	return
}

// Features is the game page's view of what this player may use. A
// switched-off feature is not greyed out there -- it is not drawn at all.
func ( user *User ) Features() ( features map[string]any ) {
	features = map[string]any{
		"hints":             user.HintsOff == false,
		"missing_hint":      user.MissingHintLevel(),
		"unlimited_guesses": user.UnlimitedGuesses,
	}
	return
}

// FeatureChange is one admin edit to a player's features; a nil field
// leaves that feature as it is.
type FeatureChange struct {
	Hints            *bool
	MissingHint      *int
	UnlimitedGuesses *bool
}

func ( user *User ) Disabled() ( result bool ) {
	result = user.DisabledAt != nil
	return
}

func ( user *User ) IsAdmin() ( result bool ) {
	result = user.Role == RoleAdmin
	return
}

func ValidRole( role string ) ( result bool ) {
	result = role == RoleAdmin || role == RoleUser
	return
}

// ValidDisplayName bounds the one piece of free text a user controls. The cap
// is about keeping the database and the UI sane; escaping for display is the
// frontend's job (see static/js/dom.js, which never uses innerHTML for
// user-supplied values).
func ValidDisplayName( display_name string ) ( result bool ) {
	trimmed := strings.TrimSpace( display_name )
	result = len( trimmed ) >= 1 && len( trimmed ) <= 80
	return
}

func CreateUser( store *db.Store , display_name string , role string ) ( user *User , err error ) {
	next_id , err := store.NextSequence( db.BucketUsers )
	if err != nil { return }
	user = &User{
		ID:          next_id,
		DisplayName: strings.TrimSpace( display_name ),
		Role:        role,
		CreatedAt:   time.Now().UTC(),
	}
	err = store.Put( db.BucketUsers , encryption.Uint64ToBytes( user.ID ) , user )
	if err != nil { user = nil }
	return
}

func GetUser( store *db.Store , user_id uint64 ) ( user *User , err error ) {
	user = &User{}
	err = store.Get( db.BucketUsers , encryption.Uint64ToBytes( user_id ) , user )
	if err != nil { user = nil }
	return
}

func ListUsers( store *db.Store ) ( users []*User , err error ) {
	users = []*User{}
	err = store.ForEach( db.BucketUsers ,
		func() any { return &User{} } ,
		func( key []byte , item any ) bool {
			users = append( users , item.( *User ) )
			return true
		} )
	return
}

func SaveUser( store *db.Store , user *User ) ( err error ) {
	err = store.Put( db.BucketUsers , encryption.Uint64ToBytes( user.ID ) , user )
	return
}

// RenameUser and SetUserDisabled both edit a record that already exists, so
// they go through UpdateValue rather than GetUser followed by SaveUser. The
// read and the write land in one transaction, which is what stops two
// concurrent admin requests from each reading the old row and the slower one
// silently discarding the other's change.
func RenameUser( store *db.Store , user_id uint64 , display_name string ) ( err error ) {
	err = store.UpdateValue( db.BucketUsers , encryption.Uint64ToBytes( user_id ) ,
		func() any { return &User{} } ,
		func( item any ) ( mutate_err error ) {
			item.( *User ).DisplayName = strings.TrimSpace( display_name )
			return
		} )
	return
}

func SetUserDisabled( store *db.Store , user_id uint64 , disabled bool ) ( err error ) {
	err = store.UpdateValue( db.BucketUsers , encryption.Uint64ToBytes( user_id ) ,
		func() any { return &User{} } ,
		func( item any ) ( mutate_err error ) {
			user := item.( *User )
			if disabled {
				now := time.Now().UTC()
				user.DisabledAt = &now
			} else {
				user.DisabledAt = nil
			}
			return
		} )
	return
}

// SetUserFeatures applies one admin edit to a player's game features.
func SetUserFeatures( store *db.Store , user_id uint64 , change FeatureChange ) ( err error ) {
	err = store.UpdateValue( db.BucketUsers , encryption.Uint64ToBytes( user_id ) ,
		func() any { return &User{} } ,
		func( item any ) ( mutate_err error ) {
			user := item.( *User )
			if change.Hints != nil { user.HintsOff = *change.Hints == false }
			if change.MissingHint != nil {
				level := *change.MissingHint
				user.MissingHint = &level
			}
			if change.UnlimitedGuesses != nil { user.UnlimitedGuesses = *change.UnlimitedGuesses }
			return
		} )
	return
}

var (
	ErrUserNotFound = errors.New( "no such user" )
	ErrLastAdmin    = errors.New( "cannot delete the last active admin" )
)

// DeleteUser removes an account and everything that belongs to it: its
// sessions (so any browser still holding the cookie is signed out on its next
// request), unused login links, API keys, and its games, results, settings
// and random deck.
//
// It is one transaction, for the same reason as DestroyAllSessionsForUser: a
// session or key created mid-delete must not outlive the account. The last
// active admin is refused inside that same transaction -- checked anywhere
// else, two admins deleting each other at once could both pass the check and
// leave nobody able to administer the app.
//
// User ids come from a bolt sequence and are never reused, so nothing stored
// elsewhere under this id (a browser's local copy, an old cookie) can ever be
// mistaken for a later account.
func DeleteUser( store *db.Store , user_id uint64 ) ( err error ) {
	key := encryption.Uint64ToBytes( user_id )
	err = store.Update( func( tx *bolt.Tx ) ( tx_err error ) {
		users := tx.Bucket( []byte( db.BucketUsers ) )
		raw := users.Get( key )
		if raw == nil {
			tx_err = ErrUserNotFound
			return
		}
		target := &User{}
		if tx_err = store.DecodeValue( raw , target ); tx_err != nil { return }

		if target.IsAdmin() && target.Disabled() == false {
			others := 0
			cursor := users.Cursor()
			for other_key , value := cursor.First(); other_key != nil; other_key , value = cursor.Next() {
				other := &User{}
				if tx_err = store.DecodeValue( value , other ); tx_err != nil { return }
				if other.ID != user_id && other.IsAdmin() && other.Disabled() == false { others += 1 }
			}
			if others == 0 {
				tx_err = ErrLastAdmin
				return
			}
		}

		if tx_err = users.Delete( key ); tx_err != nil { return }
		for _ , name := range []string{ db.BucketSettings , db.BucketGames , db.BucketResults , db.BucketRandom } {
			if tx_err = tx.Bucket( []byte( name ) ).Delete( key ); tx_err != nil { return }
		}
		for _ , name := range []string{ db.BucketSessions , db.BucketLoginTokens , db.BucketAPIKeys } {
			if tx_err = deleteOwnedBy( store , tx.Bucket( []byte( name ) ) , user_id ); tx_err != nil { return }
		}
		return
	} )
	return
}

// deleteOwnedBy drops every row in a bucket whose user_id is this user.
// Sessions, login tokens and API keys all store their owner under that name.
func deleteOwnedBy( store *db.Store , bucket *bolt.Bucket , user_id uint64 ) ( err error ) {
	doomed := [][]byte{}
	cursor := bucket.Cursor()
	for key , value := cursor.First(); key != nil; key , value = cursor.Next() {
		owner := struct {
			UserID uint64 `json:"user_id"`
		}{}
		if err = store.DecodeValue( value , &owner ); err != nil { return }
		if owner.UserID == user_id { doomed = append( doomed , append( []byte( nil ) , key... ) ) }
	}
	for _ , key := range doomed {
		if err = bucket.Delete( key ); err != nil { return }
	}
	return
}

// AnyAdminExists decides whether the server prints a first-run login link on
// boot. Once one admin exists, that bootstrap path stays closed.
func AnyAdminExists( store *db.Store ) ( result bool , err error ) {
	err = store.ForEach( db.BucketUsers ,
		func() any { return &User{} } ,
		func( key []byte , item any ) bool {
			user := item.( *User )
			if user.IsAdmin() && user.Disabled() == false {
				result = true
				return false
			}
			return true
		} )
	return
}
