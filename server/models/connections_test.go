package models

import (
	filepath "path/filepath"
	strings "strings"
	testing "testing"
	time "time"

	config "connections/server/config"
	db "connections/server/db"
)

func openTestStore( t *testing.T ) ( store *db.Store ) {
	t.Helper()
	store , err := db.Open( &config.Config{
		DatabasePath:  filepath.Join( t.TempDir() , "test.db" ),
		SecretKey:     strings.Repeat( "ab" , 32 ),
		EncryptAtRest: true,
	} )
	if err != nil { t.Fatal( err ) }
	t.Cleanup( func() { store.Close() } )
	return
}

func solvedResult( date string ) ( result Result ) {
	result = Result{
		GameID: date , PuzzleID: 1 , Kind: "calendar" , Outcome: "solved" , Mistakes: 1 ,
		Guesses:    [][]int{ { 0 , 1 , 2 , 4 } , { 0 , 1 , 2 , 3 } , { 4 , 5 , 6 , 7 } , { 8 , 9 , 10 , 11 } , { 12 , 13 , 14 , 15 } },
		Seconds:    90,
		FinishedAt: time.Now().UnixMilli(),
	}
	return
}

func TestValidResult( t *testing.T ) {
	good := solvedResult( "2026-10-09" )
	if ValidResult( &good ) == false { t.Fatal( "a good result was refused" ) }

	cases := map[string]func( result *Result ){
		"bad date":          func( result *Result ) { result.GameID = "d-2026-10-09-hard" },
		"bad kind":          func( result *Result ) { result.Kind = "daily" },
		"mistakes disagree": func( result *Result ) { result.Mistakes = 0 },
		"tile out of range": func( result *Result ) { result.Guesses[ 0 ][ 0 ] = 16 },
		"repeated tile":     func( result *Result ) { result.Guesses[ 0 ] = []int{ 1 , 1 , 2 , 3 } },
		"too few tiles":     func( result *Result ) { result.Guesses[ 0 ] = []int{ 1 , 2 , 3 } },
		"solved but short":  func( result *Result ) { result.Guesses = result.Guesses[ :4 ] },
		"failed not four":   func( result *Result ) { result.Outcome = "failed" },
		"future":            func( result *Result ) { result.FinishedAt = time.Now().Add( 48 * time.Hour ).UnixMilli() },
	}
	for name , breakIt := range cases {
		result := solvedResult( "2026-10-09" )
		result.Guesses = append( [][]int{} , result.Guesses... )
		for index := range result.Guesses { result.Guesses[ index ] = append( []int{} , result.Guesses[ index ]... ) }
		breakIt( &result )
		if ValidResult( &result ) { t.Errorf( "%s: accepted" , name ) }
	}

	failed := Result{
		GameID: "2026-10-08" , PuzzleID: 2 , Kind: "random" , Outcome: "failed" , Mistakes: 4 ,
		Guesses:    [][]int{ { 0 , 1 , 2 , 3 } , { 4 , 5 , 6 , 8 } , { 4 , 5 , 6 , 9 } , { 4 , 5 , 6 , 10 } , { 4 , 5 , 6 , 12 } },
		FinishedAt: time.Now().UnixMilli(),
	}
	if ValidResult( &failed ) == false { t.Fatal( "a good failed result was refused" ) }
}

func TestAddResultsKeepsTheFirst( t *testing.T ) {
	store := openTestStore( t )
	first := solvedResult( "2026-10-09" )
	replay := solvedResult( "2026-10-09" )
	replay.Seconds = 5
	added , err := AddResults( store , 7 , []Result{ first , replay , solvedResult( "2026-10-08" ) } )
	if err != nil || added != 2 { t.Fatalf( "added %d err %v" , added , err ) }
	added , _ = AddResults( store , 7 , []Result{ replay } )
	if added != 0 { t.Fatal( "a replay replaced the first result" ) }
	results , _ := GetResults( store , 7 )
	if len( results ) != 2 || results[ 0 ].Seconds != 90 { t.Fatalf( "results %+v" , results ) }
}

func TestRandomDeckMerge( t *testing.T ) {
	store := openTestStore( t )
	merged , err := MergeRandomDeck( store , 1 , &RandomDeck{ Cycle: 0 , Seen: []string{ "2024-01-01" , "2024-01-02" } } )
	if err != nil || len( merged.Seen ) != 2 { t.Fatalf( "first merge %+v %v" , merged , err ) }

	// Same cycle from another device: union, first-seen order kept.
	merged , _ = MergeRandomDeck( store , 1 , &RandomDeck{ Cycle: 0 , Seen: []string{ "2024-01-02" , "2024-01-03" } } )
	if strings.Join( merged.Seen , "," ) != "2024-01-01,2024-01-02,2024-01-03" { t.Fatalf( "union %v" , merged.Seen ) }

	// A reset on one device wins over the old cycle's longer list.
	merged , _ = MergeRandomDeck( store , 1 , &RandomDeck{ Cycle: 1 , Seen: []string{ "2024-02-01" } } )
	if merged.Cycle != 1 || strings.Join( merged.Seen , "," ) != "2024-02-01" { t.Fatalf( "reset %+v" , merged ) }
	merged , _ = MergeRandomDeck( store , 1 , &RandomDeck{ Cycle: 0 , Seen: []string{ "2024-01-04" } } )
	if merged.Cycle != 1 || len( merged.Seen ) != 1 { t.Fatalf( "stale device undid the reset: %+v" , merged ) }

	if ValidRandomDeck( &RandomDeck{ Seen: []string{ "nope" } } ) { t.Fatal( "bad date accepted" ) }
}

func TestValidSettings( t *testing.T ) {
	if ValidSettings( map[string]any{ "dark_mode": true , "show_timer": false } ) == false { t.Fatal( "good settings refused" ) }
	if ValidSettings( map[string]any{ "highlight_box": true } ) { t.Fatal( "unknown setting accepted" ) }
	if ValidSettings( map[string]any{ "dark_mode": 1.0 } ) { t.Fatal( "non-bool accepted" ) }
}
