// The Random button. It deals a board the player has neither been dealt at
// random before nor finished, so pressing it again and again works through
// the whole archive without repeats. When nothing is left the deck starts a
// new cycle and the dealt list empties; if every board is finished too, any
// board but the current one can come up.
//
// The deck is SyncStore.random, which follows a signed-in player between
// devices (see models/connections_random.go for how two devices agree).
const Random = {
  // The date to open, or null when the archive has nothing but the current
  // board.
  deal( current ) {
    const all = Puzzles.playable( Dates.today() );
    const finished = {};
    SyncStore.results.forEach( function ( result ) { finished[ result.game_id ] = true; } );
    let deck = { cycle: SyncStore.random.cycle , seen: SyncStore.random.seen.slice() };
    const dealt = {};
    deck.seen.forEach( function ( date ) { dealt[ date ] = true; } );

    let pool = all.filter( function ( date ) { return !finished[ date ] && !dealt[ date ] && date !== current; } );
    if ( pool.length === 0 ) {
      deck = { cycle: deck.cycle + 1 , seen: [] };
      pool = all.filter( function ( date ) { return !finished[ date ] && date !== current; } );
      if ( pool.length === 0 ) pool = all.filter( function ( date ) { return date !== current; } );
    }
    if ( pool.length === 0 ) return null;

    const date = pool[ Math.floor( Math.random() * pool.length ) ];
    deck.seen.push( date );
    SyncStore.saveRandom( deck );
    return date;
  },
};
