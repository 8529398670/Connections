package models

import (
	bytes "bytes"
	json "encoding/json"
	errors "errors"
	sort "sort"

	db "connections/server/db"
	encryption "connections/server/encryption"
)

const (
	// Enough to keep a good run of archive boards in flight on every device;
	// older ones fall off. The current game is never pruned.
	MaxSavedGames = 50
	// A serialized game is well under 1 KB. The cap is generous headroom, not
	// a target -- it exists so one record cannot be inflated without bound.
	MaxStateBytes = 8 * 1024
)

// SavedGame is opaque to the server on purpose. Only the browser knows what a
// game state means; the server keeps it, and decides which copy is newer.
type SavedGame struct {
	ID        string          `json:"id"`
	UpdatedAt int64           `json:"updated_at"` // unix milliseconds, set by the client
	State     json.RawMessage `json:"state"`
}

// SavedGames is one record per player rather than one row per game. bolt has
// no prefix query worth the name across a shared bucket, and a player's whole
// set is small and always wanted together.
type SavedGames struct {
	CurrentID string                `json:"current_id"`
	Games     map[string]*SavedGame `json:"games"`
}

func newSavedGames() ( record *SavedGames ) {
	record = &SavedGames{ Games: map[string]*SavedGame{} }
	return
}

// ValidGameState accepts a JSON object within the size cap and nothing
// else. Checking the shape here means a bad client fails at the door rather
// than poisoning the record every later load has to decode.
func ValidGameState( state json.RawMessage ) ( result bool ) {
	if len( state ) == 0 || len( state ) > MaxStateBytes { return }
	if json.Valid( state ) == false { return }
	trimmed := bytes.TrimSpace( state )
	result = len( trimmed ) > 0 && trimmed[ 0 ] == '{'
	return
}

func GetSavedGames( store *db.Store , user_id uint64 ) ( record *SavedGames , err error ) {
	record = newSavedGames()
	err = store.Get( db.BucketGames , encryption.Uint64ToBytes( user_id ) , record )
	if errors.Is( err , db.ErrNotFound ) {
		record = newSavedGames()
		err = nil
		return
	}
	if err != nil { record = nil }
	if record != nil && record.Games == nil { record.Games = map[string]*SavedGame{} }
	return
}

// SaveGame stores a game unless the server already holds a newer copy of it,
// which is how a phone and a laptop playing the same puzzle avoid trampling
// each other: the most recent move wins, whichever device made it. stored
// reports which way that went so the client can adopt the newer copy.
func SaveGame( store *db.Store , user_id uint64 , game *SavedGame , make_current bool ) ( stored bool , err error ) {
	err = store.UpsertValue( db.BucketGames , encryption.Uint64ToBytes( user_id ) ,
		func() any { return newSavedGames() } ,
		func( item any ) ( mutate_err error ) {
			record := item.( *SavedGames )
			if record.Games == nil { record.Games = map[string]*SavedGame{} }

			existing := record.Games[ game.ID ]
			if existing == nil || existing.UpdatedAt <= game.UpdatedAt {
				record.Games[ game.ID ] = game
				stored = true
			}
			if make_current { record.CurrentID = game.ID }
			pruneSavedGames( record )
			return
		} )
	if err != nil { stored = false }
	return
}

func pruneSavedGames( record *SavedGames ) {
	if len( record.Games ) <= MaxSavedGames { return }
	ordered := make( []*SavedGame , 0 , len( record.Games ) )
	for _ , game := range record.Games {
		ordered = append( ordered , game )
	}
	sort.Slice( ordered , func( a int , b int ) bool {
		return ordered[ a ].UpdatedAt > ordered[ b ].UpdatedAt
	} )
	// The current game keeps its slot wherever it sorts; the rest share
	// what is left, newest first.
	room := MaxSavedGames
	if record.Games[ record.CurrentID ] != nil { room -= 1 }
	for _ , game := range ordered {
		if game.ID == record.CurrentID { continue }
		if room > 0 {
			room -= 1
			continue
		}
		delete( record.Games , game.ID )
	}
}

// SortedSavedGames lists newest first, the order the client wants to show.
func SortedSavedGames( record *SavedGames ) ( games []*SavedGame ) {
	games = make( []*SavedGame , 0 , len( record.Games ) )
	for _ , game := range record.Games {
		games = append( games , game )
	}
	sort.Slice( games , func( a int , b int ) bool {
		return games[ a ].UpdatedAt > games[ b ].UpdatedAt
	} )
	return
}
