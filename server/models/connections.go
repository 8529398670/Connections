package models

import (
	regexp "regexp"
)

// The vocabulary shared by every Connections record. The server never plays
// the game -- checking guesses, hints, and scoring all happen in static/js/ --
// so this is only what it needs to refuse malformed input.

// A game id is the puzzle's date: "2026-10-09" is that day's board for
// everyone. Saved games, results, and the random deck are keyed by it, which
// is what makes posting a result idempotent.
var gameIDPattern = regexp.MustCompile( `^\d{4}-\d{2}-\d{2}$` )

func ValidGameID( game_id string ) ( result bool ) {
	result = gameIDPattern.MatchString( game_id )
	return
}
