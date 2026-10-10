package models

import (
	errors "errors"
	time "time"

	db "connections/server/db"
	encryption "connections/server/encryption"
)

const (
	// Stats are computed in the browser from this list, so it is the window
	// they describe. It is larger than the whole archive, so a player who
	// works through every board keeps every result.
	MaxResults = 5000
	// One POST can upload everything a player finished while signed out.
	MaxResultsPerPost = 100
	// Four correct groups plus four mistakes is the most a game can take.
	MaxGuesses = 8
	// With Unlimited guessing the only bound is that no guess repeats:
	// C(16,4) is every distinct set of four tiles.
	MaxUnlimitedGuesses = 1820
)

// Result records how one board ended. The server stores these and does no
// arithmetic on them -- static/js/stats.js turns the list into streaks and
// the mistake chart, and the same code does it for a signed-out player's
// local list, so there is exactly one definition of every number shown.
//
// A guess is four tile ids. A tile id is level*4 + the word's place in its
// group, so the colours of a guess -- and so the shareable grid and the
// skill score -- can be rebuilt from the result alone.
type Result struct {
	GameID     string  `json:"game_id"`   // the puzzle's date
	PuzzleID   int     `json:"puzzle_id"` // the NYT number, #1 being 2023-06-12
	Kind       string  `json:"kind"`      // calendar | random
	Outcome    string  `json:"outcome"`   // solved | failed
	Mistakes   int     `json:"mistakes"`
	Hints      int     `json:"hints"`
	Guesses    [][]int `json:"guesses"`
	Seconds    int     `json:"seconds"`
	FinishedAt int64   `json:"finished_at"` // unix milliseconds
	// Played with Unlimited guessing: mistakes never ended it, so it can
	// only be a win, with any number of mistakes.
	Unlimited bool `json:"unlimited,omitempty"`
}

type ResultLog struct {
	Results []Result `json:"results"`
}

// ValidResult checks shape and bounds, and that the guesses agree with the
// outcome -- not that the guesses were honest. With no leaderboard the only
// person a made-up result misleads is the one who posted it. What it does
// stop is garbage that would break the stats or the result card.
func ValidResult( result *Result ) ( ok bool ) {
	if ValidGameID( result.GameID ) == false { return }
	if result.PuzzleID <= 0 || result.PuzzleID > 1000000 { return }
	if result.Kind != "calendar" && result.Kind != "random" { return }
	if result.Hints < 0 || result.Hints > 4 { return }
	if result.Seconds < 0 || result.Seconds > 10 * 24 * 3600 { return }
	latest := time.Now().Add( 24 * time.Hour ).UnixMilli()
	if result.FinishedAt <= 0 || result.FinishedAt > latest { return }

	most := MaxGuesses
	if result.Unlimited { most = MaxUnlimitedGuesses }
	if len( result.Guesses ) == 0 || len( result.Guesses ) > most { return }
	correct , wrong := 0 , 0
	for _ , guess := range result.Guesses {
		if len( guess ) != 4 { return }
		seen := map[int]bool{}
		for _ , tile := range guess {
			if tile < 0 || tile > 15 || seen[ tile ] { return }
			seen[ tile ] = true
		}
		if guess[ 0 ] / 4 == guess[ 1 ] / 4 && guess[ 0 ] / 4 == guess[ 2 ] / 4 && guess[ 0 ] / 4 == guess[ 3 ] / 4 {
			correct += 1
		} else {
			wrong += 1
		}
	}
	if result.Mistakes != wrong { return }
	switch result.Outcome {
	case "solved":
		if correct != 4 || ( wrong > 3 && result.Unlimited == false ) { return }
	case "failed":
		if result.Unlimited || correct > 3 || wrong != 4 { return }
	default:
		return
	}
	ok = true
	return
}

func GetResults( store *db.Store , user_id uint64 ) ( results []Result , err error ) {
	log := &ResultLog{}
	err = store.Get( db.BucketResults , encryption.Uint64ToBytes( user_id ) , log )
	if errors.Is( err , db.ErrNotFound ) {
		results = []Result{}
		err = nil
		return
	}
	if err != nil { return }
	results = log.Results
	if results == nil { results = []Result{} }
	return
}

// AddResults appends results it has not seen before. A board has exactly one
// result -- the first time it was finished -- so a retry, the signed-out
// backlog being uploaded twice, or a replay of a finished board adds nothing.
func AddResults( store *db.Store , user_id uint64 , incoming []Result ) ( added int , err error ) {
	err = store.UpsertValue( db.BucketResults , encryption.Uint64ToBytes( user_id ) ,
		func() any { return &ResultLog{} } ,
		func( item any ) ( mutate_err error ) {
			log := item.( *ResultLog )
			seen := make( map[string]bool , len( log.Results ) )
			for _ , existing := range log.Results {
				seen[ existing.GameID ] = true
			}
			for _ , result := range incoming {
				if seen[ result.GameID ] { continue }
				seen[ result.GameID ] = true
				log.Results = append( log.Results , result )
				added += 1
			}
			if overflow := len( log.Results ) - MaxResults; overflow > 0 {
				log.Results = append( []Result( nil ) , log.Results[ overflow: ]... )
			}
			return
		} )
	if err != nil { added = 0 }
	return
}
