// Where everything a player does is kept. localStorage always -- so the game
// works signed out, offline, and across a refresh -- and, for a signed-in
// player, the server as well, so a puzzle started on a phone can be finished
// on a laptop.
//
// The rules, in one place:
//   settings  the server's copy wins; if it has none, the local copy goes up
//   games     per puzzle, whichever copy was changed most recently wins
//   results   one per puzzle; anything finished while signed out is uploaded
//             at the next signed-in visit
//   random    what the Random button has dealt: the higher cycle wins, and
//             the same cycle is combined (see models/connections_random.go)
const SyncStore = {
  signedIn: false,
  userId: null,
  settings: null,   // { values: { name: bool } } or null
  games: {},        // id -> { id , updated_at , state }
  currentId: null,
  results: [],      // [ result + { synced: bool } ]
  random: { cycle: 0 , seen: [] },
  dirty: {},        // game ids waiting to be sent to the server
  pushTimer: null,

  KEYS: {
    settings: "connections.settings",
    games: "connections.games",
    current: "connections.current",
    results: "connections.results",
    random: "connections.random",
    owner: "connections.owner",
  },
  MAX_GAMES: 50,
  MAX_RESULTS: 5000,
  PUSH_DELAY_MS: 2000,
  RETRY_DELAY_MS: 30000,

  // Storage can throw (private windows, quotas, blocked site data), and the
  // game has to keep working when it does -- it just stops remembering.
  read( key , fallback ) {
    try {
      const raw = window.localStorage.getItem( key );
      return raw ? JSON.parse( raw ) : fallback;
    } catch ( error ) {
      return fallback;
    }
  },

  write( key , value ) {
    try {
      window.localStorage.setItem( key , JSON.stringify( value ) );
    } catch ( error ) {
      // Nothing useful to do; the in-memory copy carries on.
    }
  },

  // Data left by a different account -- or by a signed-in session that has
  // since ended -- already lives on the server. Drop this browser's copy
  // rather than show one person's games and stats to whoever is here now.
  clearLocal() {
    const keys = this.KEYS;
    Object.keys( keys ).forEach( function ( name ) {
      try { window.localStorage.removeItem( keys[ name ] ); } catch ( error ) { /* see read() */ }
    } );
  },

  async load( me ) {
    this.signedIn = Boolean( me && me.authenticated );
    this.userId = this.signedIn ? me.id : null;

    const owner = this.read( this.KEYS.owner , null );
    if ( owner !== null && owner !== this.userId ) this.clearLocal();

    this.settings = this.read( this.KEYS.settings , null );
    this.games = this.read( this.KEYS.games , {} ) || {};
    this.currentId = this.read( this.KEYS.current , null );
    this.results = this.read( this.KEYS.results , [] );
    if ( Array.isArray( this.results ) === false ) this.results = [];
    this.random = this.cleanDeck( this.read( this.KEYS.random , null ) );

    if ( this.signedIn === false ) return;
    try {
      const replies = await Promise.all( [ Api.gameSettings() , Api.savedGames() , Api.results() , Api.randomDeck() ] );
      this.mergeSettings( replies[ 0 ].settings );
      this.mergeGames( replies[ 1 ] );
      await this.mergeResults( replies[ 2 ].results || [] );
      this.mergeRandom( replies[ 3 ] );
      this.write( this.KEYS.owner , this.userId );
      this.persist();
      this.schedulePush( this.PUSH_DELAY_MS );
    } catch ( error ) {
      // Offline, or the server hiccupped: play on from the local copy. The
      // next load merges again, and saves keep trying in the meantime.
    }
  },

  mergeSettings( remote ) {
    if ( remote && typeof remote === "object" ) {
      this.settings = { values: remote };
      return;
    }
    if ( this.settings && this.settings.values ) {
      Api.saveGameSettings( this.settings.values ).catch( function () {} );
    }
  },

  mergeGames( reply ) {
    const self = this;
    const remoteIds = {};
    ( reply.games || [] ).forEach( function ( remote ) {
      remoteIds[ remote.id ] = true;
      const local = self.games[ remote.id ];
      if ( !local || local.updated_at < remote.updated_at ) self.games[ remote.id ] = remote;
      else if ( local.updated_at > remote.updated_at ) self.dirty[ remote.id ] = true;
    } );
    Object.keys( this.games ).forEach( function ( id ) {
      if ( !remoteIds[ id ] ) self.dirty[ id ] = true;
    } );

    // The current puzzle is whichever one was touched last, on either side.
    const remoteCurrent = reply.current_id && this.games[ reply.current_id ] ? reply.current_id : null;
    const localCurrent = this.currentId && this.games[ this.currentId ] ? this.currentId : null;
    if ( remoteCurrent && ( !localCurrent || this.games[ remoteCurrent ].updated_at > this.games[ localCurrent ].updated_at ) ) {
      this.currentId = remoteCurrent;
    } else if ( localCurrent ) {
      this.dirty[ localCurrent ] = true;
    }
    this.prune();
  },

  async mergeResults( remote ) {
    const known = {};
    remote.forEach( function ( result ) { known[ result.game_id ] = true; } );
    const unsynced = this.results.filter( function ( result ) { return !known[ result.game_id ]; } );
    this.results = remote.map( function ( result ) {
      return Object.assign( {} , result , { synced: true } );
    } ).concat( unsynced );

    for ( let start = 0; start < unsynced.length; start += 100 ) {
      const batch = unsynced.slice( start , start + 100 );
      try {
        await Api.addResults( batch.map( this.stripResult ) );
        batch.forEach( function ( result ) { result.synced = true; } );
      } catch ( error ) {
        // Left unsynced; the next signed-in load tries again.
      }
    }
    this.trimResults();
  },

  stripResult( result ) {
    const copy = Object.assign( {} , result );
    delete copy.synced;
    return copy;
  },

  persist() {
    this.write( this.KEYS.settings , this.settings );
    this.write( this.KEYS.games , this.games );
    this.write( this.KEYS.current , this.currentId );
    this.write( this.KEYS.results , this.results );
    this.write( this.KEYS.random , this.random );
  },

  // Keep the 50 most recently played puzzles, always including the current.
  prune() {
    const ids = Object.keys( this.games );
    if ( ids.length <= this.MAX_GAMES ) return;
    const self = this;
    ids.sort( function ( a , b ) { return self.games[ b ].updated_at - self.games[ a ].updated_at; } );
    let room = this.MAX_GAMES - ( this.games[ this.currentId ] ? 1 : 0 );
    ids.forEach( function ( id ) {
      if ( id === self.currentId ) return;
      if ( room > 0 ) {
        room -= 1;
        return;
      }
      delete self.games[ id ];
      delete self.dirty[ id ];
    } );
  },

  trimResults() {
    const overflow = this.results.length - this.MAX_RESULTS;
    if ( overflow > 0 ) this.results = this.results.slice( overflow );
  },

  game( id ) {
    const entry = id ? this.games[ id ] : null;
    return entry ? entry.state : null;
  },

  saveSettings( values ) {
    this.settings = { values: Object.assign( {} , values ) };
    this.write( this.KEYS.settings , this.settings );
    if ( this.signedIn ) Api.saveGameSettings( this.settings.values ).catch( function () {} );
  },

  // Saved locally at once; sent to the server a moment later, so a burst of
  // taps becomes one request instead of one per tap.
  saveGame( state , makeCurrent ) {
    this.games[ state.id ] = { id: state.id , updated_at: state.updated_at , state: state };
    if ( makeCurrent ) this.currentId = state.id;
    this.prune();
    this.write( this.KEYS.games , this.games );
    this.write( this.KEYS.current , this.currentId );
    if ( this.signedIn === false ) return;
    this.dirty[ state.id ] = true;
    this.schedulePush( this.PUSH_DELAY_MS );
  },

  schedulePush( delay ) {
    window.clearTimeout( this.pushTimer );
    this.pushTimer = window.setTimeout( this.flush.bind( this , false ) , delay );
  },

  // keepalive is for the tab closing: the browser finishes the request after
  // the page is gone.
  flush( keepalive ) {
    if ( this.signedIn === false ) return;
    window.clearTimeout( this.pushTimer );
    const self = this;
    const ids = Object.keys( this.dirty );
    this.dirty = {};
    ids.forEach( function ( id ) {
      const entry = self.games[ id ];
      if ( !entry ) return;
      Api.saveGame( entry , id === self.currentId , keepalive ).catch( function ( error ) {
        if ( Api.isRetryable( error ) === false ) return;
        self.dirty[ id ] = true;
        self.schedulePush( self.RETRY_DELAY_MS );
      } );
    } );
  },

  addResult( result ) {
    const exists = this.results.some( function ( entry ) { return entry.game_id === result.game_id; } );
    if ( exists ) return;
    const entry = Object.assign( {} , result , { synced: false } );
    this.results.push( entry );
    this.trimResults();
    this.write( this.KEYS.results , this.results );
    if ( this.signedIn === false ) return;
    const self = this;
    Api.addResults( [ result ] ).then( function () {
      entry.synced = true;
      self.write( self.KEYS.results , self.results );
    } ).catch( function () {} );
  },

  // --- the Random button's deck ---------------------------------------------

  cleanDeck( deck ) {
    const cycle = deck && Number.isInteger( deck.cycle ) && deck.cycle >= 0 ? deck.cycle : 0;
    const seen = deck && Array.isArray( deck.seen ) ? deck.seen.filter( function ( date ) { return typeof date === "string"; } ) : [];
    return { cycle: cycle , seen: seen };
  },

  // The local deck goes up whole and the merged one comes back: the server
  // applies the rule, so both devices end up holding the same thing.
  mergeRandom( remote ) {
    const local = this.random;
    const theirs = this.cleanDeck( remote );
    if ( theirs.cycle > local.cycle ) {
      this.random = theirs;
    } else if ( theirs.cycle === local.cycle ) {
      const union = theirs.seen.slice();
      local.seen.forEach( function ( date ) { if ( union.indexOf( date ) === -1 ) union.push( date ); } );
      this.random = { cycle: local.cycle , seen: union };
    }
    if ( local.cycle > theirs.cycle || local.seen.length > theirs.seen.length ) this.pushRandom( false );
  },

  // Called by random.js after every deal, and after it runs out and starts
  // a new cycle.
  saveRandom( deck , keepalive ) {
    this.random = this.cleanDeck( deck );
    this.write( this.KEYS.random , this.random );
    this.pushRandom( keepalive );
  },

  pushRandom( keepalive ) {
    if ( this.signedIn === false ) return;
    const self = this;
    Api.mergeRandomDeck( this.random , keepalive ).then( function ( merged ) {
      self.random = self.cleanDeck( merged );
      self.write( self.KEYS.random , self.random );
    } ).catch( function () {} );
  },
};
