// One board being played: its state, every move a player can make, and the
// rules about which moves are allowed. No DOM -- board.js draws it, play.js
// feeds it input -- so the rules live in exactly one place.
//
// A tile is a number 0-15: its group's level times four, plus the word's
// place in that group. So tile >> 2 is its colour, and a guess (four tiles)
// carries everything the result card, the share grid and the skill score
// need, without the words.
//
// Every mutation returns an outcome ({ changed , ... }) instead of reaching
// out to the page, which keeps this file free of rendering concerns.
const Game = {
  meta: null,        // { id (the date) , puzzleId , kind: calendar | random }
  groups: null,      // the board's four groups, level order
  order: [],         // tiles still on the grid, in display order
  selected: [],      // tiles picked for the next guess, in the order picked
  found: [],         // levels the player has solved, in the order found
  guesses: [],       // every submitted guess, four tiles each
  hinted: [],        // levels a hint has named
  mistakes: 0,
  status: "playing", // playing | solved | failed
  elapsed: 0,
  runningSince: null,
  startedAt: 0,
  updatedAt: 0,
  finishedAt: 0,

  MAX_MISTAKES: 4,
  STATE_VERSION: 1,

  create( board , kind ) {
    const now = Date.now();
    this.load( {
      v: this.STATE_VERSION,
      id: board.date,
      puzzle_id: board.id,
      kind: kind === "random" ? "random" : "calendar",
      groups: board.groups,
      order: this.startingOrder( board.id ),
      selected: [],
      found: [],
      guesses: [],
      hinted: [],
      mistakes: 0,
      status: "playing",
      elapsed: 0,
      started_at: now,
      updated_at: now,
      finished_at: 0,
    } );
  },

  // The words in the archive are alphabetised within each group, so the
  // board is dealt by a shuffle seeded with the puzzle's number: everyone
  // sees the same opening board, and Play Again starts from it too.
  startingOrder( puzzleId ) {
    let seed = ( puzzleId * 2654435761 ) >>> 0;
    const random = function () {
      // mulberry32
      seed = ( seed + 0x6d2b79f5 ) >>> 0;
      let t = seed;
      t = Math.imul( t ^ ( t >>> 15 ) , t | 1 );
      t ^= t + Math.imul( t ^ ( t >>> 7 ) , t | 61 );
      return ( ( t ^ ( t >>> 14 ) ) >>> 0 ) / 4294967296;
    };
    return this.shuffled( [ 0 , 1 , 2 , 3 , 4 , 5 , 6 , 7 , 8 , 9 , 10 , 11 , 12 , 13 , 14 , 15 ] , random );
  },

  shuffled( list , random ) {
    const copy = list.slice();
    for ( let i = copy.length - 1; i > 0; i -= 1 ) {
      const j = Math.floor( random() * ( i + 1 ) );
      const swap = copy[ i ];
      copy[ i ] = copy[ j ];
      copy[ j ] = swap;
    }
    return copy;
  },

  // Shape-checks a saved state before trusting it. Saved games come from
  // localStorage or another device, and a bad one should start the board
  // fresh rather than break the page.
  isValidState( saved ) {
    if ( !saved || saved.v !== this.STATE_VERSION || typeof saved.id !== "string" ) return false;
    if ( Puzzles.isValid( { date: saved.id , id: saved.puzzle_id , groups: saved.groups } ) === false ) return false;
    const tiles = function ( list , max ) {
      return Array.isArray( list ) && list.length <= max && list.every( function ( tile ) { return Number.isInteger( tile ) && tile >= 0 && tile <= 15; } );
    };
    if ( tiles( saved.order , 16 ) === false || tiles( saved.selected , 4 ) === false ) return false;
    if ( !Array.isArray( saved.guesses ) || saved.guesses.some( function ( guess ) { return tiles( guess , 4 ) === false || guess.length !== 4; } ) ) return false;
    return [ "playing" , "solved" , "failed" ].indexOf( saved.status ) !== -1;
  },

  load( saved ) {
    this.meta = { id: saved.id , puzzleId: saved.puzzle_id , kind: saved.kind === "random" ? "random" : "calendar" };
    this.groups = saved.groups;
    this.order = saved.order.slice();
    this.selected = saved.selected.slice();
    this.found = ( saved.found || [] ).slice();
    this.guesses = saved.guesses.map( function ( guess ) { return guess.slice(); } );
    this.hinted = ( saved.hinted || [] ).slice();
    this.mistakes = saved.mistakes || 0;
    this.status = saved.status;
    this.elapsed = saved.elapsed || 0;
    this.runningSince = null;
    this.startedAt = saved.started_at || Date.now();
    this.updatedAt = saved.updated_at || this.startedAt;
    this.finishedAt = saved.finished_at || 0;
  },

  serialize() {
    return {
      v: this.STATE_VERSION,
      id: this.meta.id,
      puzzle_id: this.meta.puzzleId,
      kind: this.meta.kind,
      groups: this.groups,
      order: this.order,
      selected: this.selected,
      found: this.found,
      guesses: this.guesses,
      hinted: this.hinted,
      mistakes: this.mistakes,
      status: this.status,
      elapsed: this.elapsedMs(),
      started_at: this.startedAt,
      updated_at: this.updatedAt,
      finished_at: this.finishedAt,
    };
  },

  touch() {
    this.updatedAt = Date.now();
  },

  playing() {
    return this.meta !== null && this.status === "playing";
  },

  // Whether anything has been done to this board yet -- the calendar shows
  // a board as in progress only once it has.
  started() {
    return this.guesses.length > 0 || this.hinted.length > 0;
  },

  word( tile ) {
    return this.groups[ tile >> 2 ].members[ tile & 3 ];
  },

  // --- moves -----------------------------------------------------------------

  toggle( tile ) {
    if ( this.playing() === false || this.order.indexOf( tile ) === -1 ) return { changed: false };
    const at = this.selected.indexOf( tile );
    if ( at !== -1 ) this.selected.splice( at , 1 );
    else if ( this.selected.length < 4 ) this.selected.push( tile );
    else return { changed: false };
    this.touch();
    return { changed: true };
  },

  deselectAll() {
    if ( this.selected.length === 0 ) return { changed: false };
    this.selected = [];
    this.touch();
    return { changed: true };
  },

  shuffle() {
    if ( this.playing() === false ) return { changed: false };
    this.order = this.shuffled( this.order , Math.random );
    this.touch();
    return { changed: true };
  },

  // verdict: correct | one_away | wrong | already. level: the group found,
  // for a correct guess. finished: the outcome, when this guess ended it.
  submit() {
    if ( this.playing() === false || this.selected.length !== 4 ) return { changed: false };
    const guess = this.selected.slice();
    const key = guess.slice().sort( function ( a , b ) { return a - b; } ).join( "," );
    const repeated = this.guesses.some( function ( earlier ) {
      return earlier.slice().sort( function ( a , b ) { return a - b; } ).join( "," ) === key;
    } );
    if ( repeated ) return { changed: false , verdict: "already" };

    this.guesses.push( guess );
    const counts = [ 0 , 0 , 0 , 0 ];
    guess.forEach( function ( tile ) { counts[ tile >> 2 ] += 1; } );
    const level = counts.indexOf( 4 );
    let outcome;
    if ( level !== -1 ) {
      this.found.push( level );
      this.order = this.order.filter( function ( tile ) { return tile >> 2 !== level; } );
      this.selected = [];
      outcome = { changed: true , verdict: "correct" , level: level };
      if ( this.found.length === 4 ) {
        this.finish( "solved" );
        outcome.finished = "solved";
      }
    } else {
      // A wrong guess stays selected, as on the NYT board, so the player
      // can swap one word and try again.
      this.mistakes += 1;
      outcome = { changed: true , verdict: counts.indexOf( 3 ) !== -1 ? "one_away" : "wrong" };
      if ( this.mistakes >= this.MAX_MISTAKES ) {
        // Every group not found is now shown as a bar, so no tiles remain.
        this.selected = [];
        this.order = [];
        this.finish( "failed" );
        outcome.finished = "failed";
      }
    }
    this.touch();
    return outcome;
  },

  // Names the easiest group not found and not already hinted. null when
  // there is nothing left to name.
  hint() {
    if ( this.playing() === false ) return null;
    for ( let level = 0; level < 4; level += 1 ) {
      if ( this.found.indexOf( level ) === -1 && this.hinted.indexOf( level ) === -1 ) {
        this.hinted.push( level );
        this.touch();
        return level;
      }
    }
    return null;
  },

  hintsLeft() {
    const self = this;
    return this.playing() && [ 0 , 1 , 2 , 3 ].some( function ( level ) {
      return self.found.indexOf( level ) === -1 && self.hinted.indexOf( level ) === -1;
    } );
  },

  // The groups to draw as bars above the grid: those found, in the order
  // found, then -- once the game is lost -- the rest, easiest first.
  bars() {
    const shown = this.found.map( function ( level ) { return { level: level , revealed: false }; } );
    if ( this.status === "failed" ) {
      for ( let level = 0; level < 4; level += 1 ) {
        if ( this.found.indexOf( level ) === -1 ) shown.push( { level: level , revealed: true } );
      }
    }
    return shown;
  },

  // Back to the opening board. The clock starts again too: a replay is
  // timed on its own.
  reset() {
    const board = { date: this.meta.id , id: this.meta.puzzleId , groups: this.groups };
    const kind = this.meta.kind;
    this.create( board , kind );
  },

  // Rebuilds a finished board from its result, for a puzzle whose saved
  // game has been pruned: every guess played again, in order.
  replay( result ) {
    const self = this;
    result.guesses.forEach( function ( guess ) {
      if ( self.playing() === false ) return;
      self.selected = guess.filter( function ( tile ) { return self.order.indexOf( tile ) !== -1; } );
      if ( self.selected.length === 4 ) self.submit();
    } );
    this.selected = [];
    this.hinted = [];
    for ( let level = 0; level < ( result.hints || 0 ) && level < 4; level += 1 ) this.hinted.push( level );
    this.elapsed = ( result.seconds || 0 ) * 1000;
    this.finishedAt = result.finished_at || this.finishedAt;
    this.meta.kind = result.kind === "random" ? "random" : "calendar";
  },

  result() {
    return {
      game_id: this.meta.id,
      puzzle_id: this.meta.puzzleId,
      kind: this.meta.kind,
      outcome: this.status,
      mistakes: this.mistakes,
      hints: this.hinted.length,
      guesses: this.guesses.map( function ( guess ) { return guess.slice(); } ),
      seconds: Math.round( this.elapsedMs() / 1000 ),
      finished_at: this.finishedAt || Date.now(),
    };
  },

  finish( outcome ) {
    this.pauseClock();
    this.status = outcome;
    this.finishedAt = Date.now();
  },

  // --- the clock -------------------------------------------------------------

  startClock() {
    if ( this.playing() && this.runningSince === null ) this.runningSince = Date.now();
  },

  pauseClock() {
    if ( this.runningSince === null ) return;
    this.elapsed += Date.now() - this.runningSince;
    this.runningSince = null;
  },

  elapsedMs() {
    return this.elapsed + ( this.runningSince === null ? 0 : Date.now() - this.runningSince );
  },

  formatDuration( totalSeconds ) {
    const seconds = Math.max( 0 , Math.floor( totalSeconds ) );
    const hours = Math.floor( seconds / 3600 );
    const minutes = Math.floor( ( seconds % 3600 ) / 60 );
    const rest = String( seconds % 60 ).padStart( 2 , "0" );
    if ( hours > 0 ) return hours + ":" + String( minutes ).padStart( 2 , "0" ) + ":" + rest;
    return minutes + ":" + rest;
  },
};
