package models

import (
	errors "errors"
	time "time"

	db "connections/server/db"
	encryption "connections/server/encryption"
)

// SettingNames is the allow-list for the settings dialog's switches.
// Anything else in a request is refused rather than stored, so the record
// cannot grow into a free-form key/value store for whatever a client decides
// to send. static/js/settings.js holds the same list.
var SettingNames = []string{
	"show_timer",
	"sound_on_solve",
	"dark_mode",
	"unlimited_guessing",
}

type Settings struct {
	Values    map[string]any `json:"values"`
	UpdatedAt time.Time      `json:"updated_at"`
}

// ValidSettings checks every name against the allow-list and every value is
// a bool.
func ValidSettings( values map[string]any ) ( result bool ) {
	if values == nil { return }
	for name , value := range values {
		known := false
		for _ , allowed := range SettingNames {
			if allowed == name {
				known = true
				break
			}
		}
		if known == false { return }
		if _ , ok := value.( bool ); ok == false { return }
	}
	result = true
	return
}

// GetSettings returns nil with no error for a player who has never saved
// any, so the client can tell "use your local copy" apart from a fault.
func GetSettings( store *db.Store , user_id uint64 ) ( settings *Settings , err error ) {
	settings = &Settings{}
	err = store.Get( db.BucketSettings , encryption.Uint64ToBytes( user_id ) , settings )
	if errors.Is( err , db.ErrNotFound ) {
		settings = nil
		err = nil
		return
	}
	if err != nil { settings = nil }
	return
}

// SaveSettings replaces the whole set. The dialog always sends every value,
// so there is nothing to merge and a plain Put is not a lost update.
func SaveSettings( store *db.Store , user_id uint64 , values map[string]any ) ( err error ) {
	err = store.Put( db.BucketSettings , encryption.Uint64ToBytes( user_id ) , &Settings{
		Values:    values,
		UpdatedAt: time.Now().UTC(),
	} )
	return
}
