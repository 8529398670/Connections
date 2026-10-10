// Draws the board: the solved groups as coloured bars, the remaining words
// as a 4×4 grid of tiles, the mistakes left, and the buttons under it. It
// reads Game and never changes it -- taps go to play.js.
const Board = {
  root: null,
  onTile: null,

  init( root , onTile ) {
    this.root = root;
    this.onTile = onTile;
    root.setAttribute( "aria-label" , I18n.get( "game.board_label" ) );
    let timer = null;
    window.addEventListener( "resize" , function () {
      window.clearTimeout( timer );
      timer = window.setTimeout( function () { Board.fit(); } , 100 );
    } );
  },

  // fresh: the level of a group found by this very move, so only its bar
  // plays the reveal animation.
  render( game , options ) {
    const settings = options || {};
    const bars = Dom.get( "bars" );
    Dom.clear( bars );
    game.bars().forEach( function ( bar ) {
      const group = game.groups[ bar.level ];
      bars.appendChild( Dom.el( "div" , {
        class: "bar level-" + bar.level + ( bar.revealed ? " revealed" : "" ) + ( settings.fresh === bar.level ? " bar-new" : "" ),
        attrs: { role: "group" , "aria-label": group.group + ": " + group.members.join( ", " ) },
        children: [
          Dom.el( "strong" , { class: "bar-name" , text: group.group } ),
          Dom.el( "span" , { class: "bar-words" , text: group.members.join( ", " ) } ),
        ],
      } ) );
    } );

    // Once a game ends every group is a bar, so no tiles are left to draw
    // (a game saved mid-loss by an older version may still list some).
    Dom.clear( this.root );
    const self = this;
    const tiles = game.playing() ? game.order : [];
    tiles.forEach( function ( tile ) {
      const word = game.word( tile );
      const picked = game.selected.indexOf( tile ) !== -1;
      self.root.appendChild( Dom.el( "button" , {
        class: "tile " + self.sizeClass( word ) + ( picked ? " selected" : "" ),
        text: word,
        attrs: { type: "button" , "aria-pressed": picked ? "true" : "false" , "data-tile": String( tile ) },
        on: { click: function () { self.onTile( tile ); } },
      } ) );
    } );
    Dom.show( this.root , tiles.length > 0 );
    this.fit();

    // With Unlimited guessing there is nothing to run out of, so the row
    // counts mistakes made instead of showing the dots left.
    const unlimited = Boolean( options && options.unlimited );
    Dom.text( Dom.get( "mistakes-label" ) , unlimited
      ? I18n.format( "game.mistakes_made" , { count: game.mistakes } )
      : I18n.get( "game.mistakes_remaining" ) );
    const dots = Dom.get( "mistake-dots" );
    Dom.show( dots , unlimited === false );
    Dom.clear( dots );
    for ( let i = 0; i < game.MAX_MISTAKES; i += 1 ) {
      dots.appendChild( Dom.el( "span" , { class: "mistake-dot" + ( i < game.MAX_MISTAKES - game.mistakes ? "" : " used" ) } ) );
    }
    dots.setAttribute( "aria-label" , String( game.MAX_MISTAKES - game.mistakes ) );

    const playing = game.playing();
    Dom.show( Dom.get( "mistakes-row" ) , playing );
    Dom.show( Dom.get( "play-actions" ) , playing );
    Dom.show( Dom.get( "done-actions" ) , playing === false );
  },

  // A word never breaks in the middle: any tile whose longest word is still
  // wider than the tile after sizeClass gets its type stepped down until it
  // fits. Multi-word tiles ("SMILING FACE WITH SUNGLASSES") wrap at spaces.
  fit() {
    Dom.all( ".tile" , this.root ).forEach( function ( tile ) {
      tile.style.fontSize = "";
      let size = parseFloat( window.getComputedStyle( tile ).fontSize );
      while ( tile.scrollWidth > tile.clientWidth && size > 7 ) {
        size -= 0.5;
        tile.style.fontSize = size + "px";
      }
    } );
  },

  // Long words start from smaller type, so fit() rarely has work to do.
  sizeClass( word ) {
    const longest = String( word ).split( /\s+/ ).reduce( function ( max , part ) { return Math.max( max , part.length ); } , 0 );
    if ( longest > 11 || word.length > 20 ) return "tile-xs";
    if ( longest > 9 || word.length > 14 ) return "tile-s";
    if ( longest > 7 ) return "tile-m";
    return "";
  },

  tiles( list ) {
    const self = this;
    return list.map( function ( tile ) { return self.root.querySelector( '[data-tile="' + tile + '"]' ); } )
      .filter( Boolean );
  },

  // The submit animation: the picked tiles hop one after another. Resolves
  // when the last one lands, so the verdict appears after it, as on the
  // NYT board. Instant when the player prefers reduced motion.
  async hop( list ) {
    if ( this.reducedMotion() ) return;
    this.tiles( list ).forEach( function ( element , index ) {
      element.style.animationDelay = ( index * 90 ) + "ms";
      element.classList.add( "hop" );
    } );
    await this.wait( 90 * ( list.length - 1 ) + 320 );
  },

  async shake( list ) {
    if ( this.reducedMotion() ) return;
    this.tiles( list ).forEach( function ( element ) {
      element.classList.remove( "hop" );
      element.style.animationDelay = "0ms";
      element.classList.add( "shake" );
    } );
    await this.wait( 420 );
  },

  reducedMotion() {
    return window.matchMedia && window.matchMedia( "(prefers-reduced-motion: reduce)" ).matches;
  },

  wait( milliseconds ) {
    return new Promise( function ( resolve ) { window.setTimeout( resolve , milliseconds ); } );
  },
};
