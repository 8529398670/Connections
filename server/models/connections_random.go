package models

import (
	errors "errors"

	db "connections/server/db"
	encryption "connections/server/encryption"
)

// MaxRandomSeen is far more boards than the archive holds; it only stops one
// record being inflated without bound.
const MaxRandomSeen = 20000

// RandomDeck is what the Random button has already dealt a player. The
// browser does the dealing (static/js/random.js): it skips every board in
// Seen and every board the player has finished, and when nothing is left it
// starts a new Cycle with Seen empty.
//
// Cycle is what makes two devices agree. A reset on one device must not be
// undone by the other device's longer list arriving later, so the higher
// cycle wins outright and only lists from the same cycle are combined.
type RandomDeck struct {
	Cycle int      `json:"cycle"`
	Seen  []string `json:"seen"`
}

func ValidRandomDeck( deck *RandomDeck ) ( ok bool ) {
	if deck.Cycle < 0 || deck.Cycle > 1000000 { return }
	if len( deck.Seen ) > MaxRandomSeen { return }
	for _ , date := range deck.Seen {
		if ValidGameID( date ) == false { return }
	}
	ok = true
	return
}

func GetRandomDeck( store *db.Store , user_id uint64 ) ( deck *RandomDeck , err error ) {
	deck = &RandomDeck{}
	err = store.Get( db.BucketRandom , encryption.Uint64ToBytes( user_id ) , deck )
	if errors.Is( err , db.ErrNotFound ) {
		deck = &RandomDeck{}
		err = nil
	}
	if err != nil { deck = nil }
	if deck != nil && deck.Seen == nil { deck.Seen = []string{} }
	return
}

// MergeRandomDeck folds a device's deck into the stored one and returns the
// result, which the device adopts.
func MergeRandomDeck( store *db.Store , user_id uint64 , incoming *RandomDeck ) ( merged *RandomDeck , err error ) {
	err = store.UpsertValue( db.BucketRandom , encryption.Uint64ToBytes( user_id ) ,
		func() any { return &RandomDeck{} } ,
		func( item any ) ( mutate_err error ) {
			stored := item.( *RandomDeck )
			*stored = mergeDecks( *stored , *incoming )
			merged = &RandomDeck{ Cycle: stored.Cycle , Seen: append( []string{} , stored.Seen... ) }
			return
		} )
	if err != nil { merged = nil }
	return
}

func mergeDecks( stored RandomDeck , incoming RandomDeck ) ( result RandomDeck ) {
	switch {
	case incoming.Cycle > stored.Cycle:
		result = RandomDeck{ Cycle: incoming.Cycle }
		result.Seen = unionDates( nil , incoming.Seen )
	case incoming.Cycle < stored.Cycle:
		result = RandomDeck{ Cycle: stored.Cycle }
		result.Seen = unionDates( nil , stored.Seen )
	default:
		result = RandomDeck{ Cycle: stored.Cycle }
		result.Seen = unionDates( stored.Seen , incoming.Seen )
	}
	if len( result.Seen ) > MaxRandomSeen { result.Seen = result.Seen[ len( result.Seen ) - MaxRandomSeen: ] }
	return
}

// unionDates keeps first-seen order, so the deck still reads oldest deal first.
func unionDates( first []string , second []string ) ( result []string ) {
	result = []string{}
	seen := map[string]bool{}
	for _ , list := range [][]string{ first , second } {
		for _ , date := range list {
			if seen[ date ] { continue }
			seen[ date ] = true
			result = append( result , date )
		}
	}
	return
}
