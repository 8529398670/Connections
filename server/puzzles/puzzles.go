// Package puzzles owns the list of Connections boards: reading it, cleaning
// it up, serving it, and keeping it current.
//
// The list ships inside the binary (connections.json at the module root), so
// a fresh install can play every board up to the day it was built. A
// background refresh then pulls the community archive the file came from and
// keeps the newest copy in the app directory, which is what lets a long-running
// server pick up each new day without a rebuild.
//
// The server never plays the game. It hands a board to the browser, answers
// included -- the same as the NYT page does -- and the browser checks guesses
// itself, which is what lets someone play signed out.
package puzzles

import (
	json "encoding/json"
	fmt "fmt"
	sort "sort"
	strings "strings"
	time "time"
)

// Group is one category: its difficulty (0 yellow, 1 green, 2 blue, 3 purple),
// its name, and its four words.
type Group struct {
	Level   int      `json:"level"`
	Group   string   `json:"group"`
	Members []string `json:"members"`
}

// Puzzle is one day's board. Groups are always in level order, 0 to 3.
type Puzzle struct {
	ID     int     `json:"id"`
	Date   string  `json:"date"`
	Groups []Group `json:"groups"`
}

// rawPuzzle is the file's own shape, which names the groups "answers".
type rawPuzzle struct {
	ID      int     `json:"id"`
	Date    string  `json:"date"`
	Answers []Group `json:"answers"`
}

// Set is one parsed, validated copy of the list. It is never modified after
// Parse returns, so readers can hold it without a lock while a refresh swaps
// in the next one.
type Set struct {
	list    []*Puzzle
	byDate  map[string]*Puzzle
	index   []byte
	Dropped int
}

// indexEntry is one calendar day in the /api/puzzles response.
type indexEntry struct {
	Date string `json:"date"`
	ID   int    `json:"id"`
}

// Parse reads the archive's JSON and keeps every board that can actually be
// played. Some can't: 2025-04-01 was an emoji board whose tiles arrived as
// empty strings. Those are counted in Dropped and the calendar shows the day
// as having no puzzle, rather than the whole list being refused over one day.
func Parse( raw []byte ) ( set *Set , err error ) {
	var entries []rawPuzzle
	if err = json.Unmarshal( raw , &entries ); err != nil {
		err = fmt.Errorf( "puzzles: not a JSON list of puzzles: %w" , err )
		return
	}

	set = &Set{ byDate: map[string]*Puzzle{} }
	for _ , entry := range entries {
		puzzle , ok := normalize( entry )
		if ok == false || set.byDate[ puzzle.Date ] != nil {
			set.Dropped += 1
			continue
		}
		set.byDate[ puzzle.Date ] = puzzle
		set.list = append( set.list , puzzle )
	}
	if len( set.list ) == 0 {
		set = nil
		err = fmt.Errorf( "puzzles: no playable puzzles in %d entries" , len( entries ) )
		return
	}
	sort.Slice( set.list , func( a int , b int ) bool { return set.list[ a ].Date < set.list[ b ].Date } )

	days := make( []indexEntry , 0 , len( set.list ) )
	for _ , puzzle := range set.list {
		days = append( days , indexEntry{ Date: puzzle.Date , ID: puzzle.ID } )
	}
	set.index , err = json.Marshal( map[string]any{
		"first":   set.First(),
		"latest":  set.Latest(),
		"puzzles": days,
	} )
	if err != nil { set = nil }
	return
}

// normalize checks one board and puts its groups in level order.
//
// Boards from the newer NYT feed carry no colours, and the archive writes
// level -1 for all four. Their groups are listed easiest first, though --
// checked against the game's own colours -- so a missing or inconsistent set
// of levels falls back to the list order.
func normalize( entry rawPuzzle ) ( puzzle *Puzzle , ok bool ) {
	if entry.ID <= 0 || len( entry.Answers ) != 4 { return }
	if _ , parse_err := time.Parse( "2006-01-02" , entry.Date ); parse_err != nil { return }

	levels_ok := true
	seen_levels := map[int]bool{}
	for _ , answer := range entry.Answers {
		if answer.Level < 0 || answer.Level > 3 || seen_levels[ answer.Level ] { levels_ok = false }
		seen_levels[ answer.Level ] = true
	}

	groups := make( []Group , 0 , 4 )
	seen_words := map[string]bool{}
	for index , answer := range entry.Answers {
		name := strings.TrimSpace( answer.Group )
		if name == "" || len( answer.Members ) != 4 { return }
		members := make( []string , 0 , 4 )
		for _ , member := range answer.Members {
			word := strings.TrimSpace( member )
			key := strings.ToUpper( word )
			if word == "" || seen_words[ key ] { return }
			seen_words[ key ] = true
			members = append( members , word )
		}
		level := answer.Level
		if levels_ok == false { level = index }
		groups = append( groups , Group{ Level: level , Group: name , Members: members } )
	}
	sort.Slice( groups , func( a int , b int ) bool { return groups[ a ].Level < groups[ b ].Level } )

	puzzle = &Puzzle{ ID: entry.ID , Date: entry.Date , Groups: groups }
	ok = true
	return
}

func ( set *Set ) Count() int { return len( set.list ) }

func ( set *Set ) First() string { return set.list[ 0 ].Date }

func ( set *Set ) Latest() string { return set.list[ len( set.list ) - 1 ].Date }

// ByDate returns nil for a day with no playable board.
func ( set *Set ) ByDate( date string ) *Puzzle { return set.byDate[ date ] }

// IndexJSON is the calendar's view of the whole list, encoded once per set.
func ( set *Set ) IndexJSON() []byte { return set.index }
