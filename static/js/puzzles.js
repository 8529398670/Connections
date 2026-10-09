// The list of boards, from the server: which days have one (for the
// calendar and Random) and each day's board when it is opened.
//
// A board comes with its answers, as on the NYT page. Saved games keep a
// copy of their board, so a puzzle already started opens without the
// network; the list itself is kept in localStorage for the same reason.
const Puzzles = {
  first: null,
  latest: null,
  dates: [],   // every day with a playable board, oldest first
  ids: {},     // date -> puzzle number
  boards: {},  // date -> board, fetched this visit
  INDEX_KEY: "connections.index",

  async load() {
    let index = null;
    try {
      index = await Api.puzzles();
      try { window.localStorage.setItem( this.INDEX_KEY , JSON.stringify( index ) ); } catch ( error ) { /* storage blocked */ }
    } catch ( error ) {
      try { index = JSON.parse( window.localStorage.getItem( this.INDEX_KEY ) ); } catch ( storageError ) { index = null; }
    }
    if ( !index || !Array.isArray( index.puzzles ) || index.puzzles.length === 0 ) throw new Error( "no puzzle list" );
    this.first = index.first;
    this.latest = index.latest;
    this.dates = [];
    this.ids = {};
    const self = this;
    index.puzzles.forEach( function ( entry ) {
      self.dates.push( entry.date );
      self.ids[ entry.date ] = entry.id;
    } );
  },

  has( date ) {
    return Object.prototype.hasOwnProperty.call( this.ids , date );
  },

  idFor( date ) {
    return this.ids[ date ] || null;
  },

  // Every board a player can open today. The archive may already hold
  // tomorrow somewhere east of here; it stays locked until it is tomorrow
  // here too.
  playable( today ) {
    const limit = today || Dates.today();
    return this.dates.filter( function ( date ) { return date <= limit; } );
  },

  // Today's board, or the newest one before it when today's hasn't been
  // published yet.
  todays( today ) {
    const open = this.playable( today );
    return open.length ? open[ open.length - 1 ] : this.dates[ 0 ];
  },

  async get( date ) {
    if ( this.boards[ date ] ) return this.boards[ date ];
    const board = await Api.puzzle( date );
    if ( this.isValid( board ) === false ) throw new Error( "bad board" );
    this.boards[ date ] = board;
    return board;
  },

  // The server checks boards as it loads them; this is for copies that come
  // back out of localStorage or another device's saved game.
  isValid( board ) {
    if ( !board || typeof board.date !== "string" || !Number.isInteger( board.id ) ) return false;
    if ( !Array.isArray( board.groups ) || board.groups.length !== 4 ) return false;
    return board.groups.every( function ( group , level ) {
      return group && group.level === level && typeof group.group === "string" &&
        Array.isArray( group.members ) && group.members.length === 4 &&
        group.members.every( function ( word ) { return typeof word === "string" && word !== ""; } );
    } );
  },
};
