// The game page's controller: starts everything up in order, then turns
// taps, keys, and menu picks into Game moves and redraws afterwards.
//
// The order in init() matters: text first (every label comes from
// language.yaml), then who is signed in, then their saved data and the
// puzzle list, and only then the screens that display them.
const Play = {
  me: null,
  busy: false,       // a guess is animating; taps wait for it
  loading: false,    // a board is being fetched
  toastTimer: null,
  // What this player may use, from /api/me. An admin can switch hints off
  // per player; a switched-off feature is not drawn at all. Signed-out
  // players have it.
  features: { hints: true },

  async init() {
    try {
      await I18n.load();
      I18n.apply();
    } catch ( error ) {
      // Without the language file every label is blank, so say something in
      // the one place that can afford a hardcoded string.
      this.fail( "Could not load language file." );
      return;
    }

    let me = { authenticated: false };
    try {
      me = await Api.me();
    } catch ( error ) {
      // The server is unreachable: play signed out from local storage.
    }
    this.me = me;
    if ( me.authenticated && me.features ) this.features = { hints: me.features.hints !== false };
    await SyncStore.load( me );
    try {
      await Puzzles.load();
    } catch ( error ) {
      this.fail( I18n.get( "game.puzzles_failed" ) );
      return;
    }

    Settings.init( SyncStore.settings , this.onSettingChanged.bind( this ) );
    Board.init( Dom.get( "board" ) , this.toggle.bind( this ) );
    Menu.init();
    Archive.init( function ( date ) { Play.open( date , "calendar" , "push" ); } , function () { Play.random(); } );
    Dom.get( "shuffle-button" ).addEventListener( "click" , this.shuffle.bind( this ) );
    Dom.get( "deselect-button" ).addEventListener( "click" , this.deselect.bind( this ) );
    Dom.get( "submit-button" ).addEventListener( "click" , this.submit.bind( this ) );
    Dom.get( "results-button" ).addEventListener( "click" , this.viewResults.bind( this ) );
    Dom.get( "again-button" ).addEventListener( "click" , this.playAgain.bind( this ) );
    this.applyFeatures();
    this.renderAccountLink();
    this.wireLifecycle();
    this.wireKeyboard();
    // Back and Forward walk through the boards played in this tab.
    window.addEventListener( "popstate" , async function () {
      if ( await Play.openFromUrl() === false ) Play.open( Puzzles.todays() , "calendar" , "replace" );
    } );

    Dom.show( Dom.get( "app" ) , true );
    this.noticeFromUrl();
    if ( await this.openFromUrl() ) return;
    await this.open( Puzzles.todays() , "calendar" , "replace" );
  },

  fail( message ) {
    Dom.text( Dom.get( "error-banner" ) , message );
    Dom.show( Dom.get( "error-banner" ) , true );
  },

  // --- opening boards --------------------------------------------------------

  // kind: calendar | random -- how this board was reached, which its result
  // records. history: "push" when the player picked it (so Back returns to
  // the last one), "replace" when the URL already named it.
  async open( date , kind , history ) {
    if ( this.loading ) return false;
    if ( Puzzles.has( date ) === false || date > Dates.today() ) {
      this.toast( I18n.format( "game.no_puzzle" , { date: Dates.display( date , "medium" ) } ) );
      return false;
    }
    if ( Game.meta !== null && Game.meta.id === date ) return true;

    const saved = SyncStore.game( date );
    if ( Game.isValidState( saved ) ) {
      this.leaveCurrent();
      Game.load( saved );
      if ( kind === "random" && Game.playing() && Game.started() === false ) Game.meta.kind = "random";
    } else {
      this.setLoading( true );
      let board;
      try {
        board = await Puzzles.get( date );
      } catch ( error ) {
        this.setLoading( false );
        this.toast( I18n.get( "game.load_failed" ) );
        return false;
      }
      this.setLoading( false );
      this.leaveCurrent();
      Game.create( board , kind );
      // Finished long enough ago that its saved game was pruned: rebuild the
      // finished board from the result rather than offer it as new.
      const result = this.recorded( date );
      if ( result ) Game.replay( result );
    }
    this.afterLoad( history );
    return true;
  },

  afterLoad( history ) {
    this.busy = false;
    this.renderHeader();
    this.syncUrl( history || "push" );
    if ( Game.playing() && document.hidden === false ) Game.startClock();
    this.render();
  },

  random() {
    const date = Random.deal( Game.meta ? Game.meta.id : null );
    if ( date !== null ) this.open( date , "random" , "push" );
  },

  // The first result recorded for a board, or null.
  recorded( date ) {
    return SyncStore.results.find( function ( result ) { return result.game_id === date; } ) || null;
  },

  // Bank the clock into the board being left, so its time is right when it
  // is picked up again.
  leaveCurrent() {
    if ( Game.meta === null ) return;
    Game.pauseClock();
    this.save( false );
  },

  // A board nobody has touched is not worth a saved game: opening it again
  // deals the same opening board anyway.
  save( makeCurrent ) {
    if ( Game.meta === null || ( Game.started() === false && Game.playing() ) ) return;
    SyncStore.saveGame( Game.serialize() , makeCurrent );
  },

  setLoading( on ) {
    this.loading = on;
    Dom.show( Dom.get( "loading-overlay" ) , on );
  },

  // --- the address bar -------------------------------------------------------

  syncUrl( history ) {
    const path = Links.pathFor( Game.meta.id );
    if ( path === window.location.pathname ) return;
    if ( history === "replace" || Links.parse( window.location.pathname ) === null ) {
      window.history.replaceState( null , "" , path );
    } else {
      window.history.pushState( null , "" , path );
    }
  },

  // Opens the board the address bar names. Resolves to false when it names
  // none (the front page) or one that cannot be opened, leaving the caller
  // to open today's.
  async openFromUrl() {
    const date = Links.parse( window.location.pathname );
    if ( date === null ) return false;
    if ( date === false || Puzzles.has( date ) === false || date > Dates.today() ) {
      this.toast( I18n.get( "game.bad_link" ) , 6000 );
      window.history.replaceState( null , "" , "/" );
      return false;
    }
    return this.open( date , "calendar" , "replace" );
  },

  // --- moves -----------------------------------------------------------------

  toggle( tile ) {
    if ( this.busy || Game.toggle( tile ).changed === false ) return;
    this.save( true );
    this.render();
  },

  shuffle() {
    if ( this.busy || Game.shuffle().changed === false ) return;
    this.save( true );
    this.render();
  },

  deselect() {
    if ( this.busy || Game.deselectAll().changed === false ) return;
    this.save( true );
    this.render();
  },

  // The guess is decided at once; the board on screen is only redrawn after
  // the tiles have hopped (and shaken, for a miss), as on the NYT board.
  async submit() {
    if ( this.busy || Game.playing() === false || Game.selected.length !== 4 ) return;
    const picked = Game.selected.slice();
    const outcome = Game.submit();
    if ( outcome.changed === false ) {
      if ( outcome.verdict === "already" ) this.toast( I18n.get( "game.already_guessed" ) , 2000 );
      return;
    }
    this.busy = true;
    this.renderButtons();
    await Board.hop( picked );
    if ( outcome.verdict !== "correct" ) await Board.shake( picked );
    if ( outcome.verdict === "one_away" ) this.toast( I18n.get( "game.one_away" ) , 2000 );
    this.busy = false;
    this.save( true );
    this.render( { fresh: outcome.level } );
    if ( outcome.finished ) this.onFinished( outcome.finished );
  },

  onFinished( outcome ) {
    const result = Game.result();
    SyncStore.addResult( result );
    if ( outcome === "solved" && Settings.get( "sound_on_solve" ) ) Sound.chime();
    window.setTimeout( function () { Play.viewResults(); } , Board.reducedMotion() ? 0 : 900 );
  },

  // A board finished before shows this play's own card, with a note that
  // the stats keep the first result.
  viewResults() {
    if ( Game.meta === null || Game.playing() ) return;
    const result = Game.result();
    const first = this.recorded( Game.meta.id );
    Menu.showResult( result , {
      practice: first !== null && first.finished_at !== result.finished_at,
      hints: this.features.hints,
    } );
  },

  playAgain() {
    if ( Game.meta === null || this.busy ) return;
    Game.reset();
    this.save( true );
    if ( document.hidden === false ) Game.startClock();
    this.render();
    if ( this.recorded( Game.meta.id ) ) this.toast( I18n.get( "game.practice_notice" ) , 5000 );
  },

  async reset() {
    if ( Game.meta === null || this.busy ) return;
    if ( await Menu.confirm( "menu.confirm_reset" , "menu.reset_yes" ) === false ) return;
    this.playAgain();
  },

  hint() {
    if ( this.features.hints === false || this.busy || Game.playing() === false ) return;
    if ( Game.hint() === null ) {
      this.toast( I18n.get( "game.hint_none" ) );
      return;
    }
    this.save( true );
    this.render();
  },

  // --- the header and the ⋯ menu ---------------------------------------------

  async action( name ) {
    if ( name === "random" ) return this.random();
    if ( name === "archive" ) return Archive.open( Game.meta ? Game.meta.id : null );
    if ( name === "today" ) return this.open( Puzzles.todays() , "calendar" , "push" );
    if ( name === "hint" ) return this.hint();
    if ( name === "reset" ) return this.reset();
    if ( name === "share" ) return this.share();
    if ( name === "stats" ) return Stats.open();
    if ( name === "help" ) return Menu.open( "help-dialog" );
    if ( name === "settings" ) return Menu.open( "settings-dialog" );
  },

  // A finished board shares its result; one under way shares its link.
  share() {
    if ( Game.meta === null ) return;
    if ( Game.playing() ) return this.copy( Links.urlFor( Game.meta.id ) , I18n.get( "game.link_copied" ) );
    return this.shareResult( Game.result() );
  },

  shareResult( result ) {
    return this.copy( Score.shareText( result ) + "\n" + Links.urlFor( result.game_id ) , I18n.get( "game.result_copied" ) );
  },

  // Phones get the system share sheet; desktops get the clipboard, which is
  // what a share sheet there would mostly do anyway.
  async copy( text , notice ) {
    if ( navigator.share && window.matchMedia( "(pointer: coarse)" ).matches ) {
      try {
        await navigator.share( { text: text } );
        return;
      } catch ( error ) {
        if ( error && error.name === "AbortError" ) return;
      }
    }
    try {
      await navigator.clipboard.writeText( text );
      this.toast( notice );
    } catch ( error ) {
      // No clipboard (plain http, or permission refused): show the text so
      // it can at least be copied by hand.
      this.toast( text , 10000 );
    }
  },

  // --- features the admin can switch off --------------------------------------

  // Hides everything to do with a feature this player cannot use. Only ever
  // hides -- language.yaml may already have hidden some of these, and that
  // stands.
  applyFeatures() {
    if ( this.features.hints === false ) {
      Dom.all( '[data-action="hint"]' ).forEach( function ( element ) { Dom.show( element , false ); } );
      Dom.show( Dom.get( "help-hints" ) , false );
      Dom.show( Dom.get( "hint-line" ) , false );
    }
  },

  // --- lifecycle and keys ----------------------------------------------------

  wireLifecycle() {
    // A hidden tab stops the clock (and saves) by itself.
    document.addEventListener( "visibilitychange" , function () {
      if ( document.hidden ) {
        Game.pauseClock();
        Play.save( false );
        SyncStore.flush( true );
      } else if ( Game.playing() ) {
        Game.startClock();
      }
    } );
    window.addEventListener( "pagehide" , function () {
      Game.pauseClock();
      Play.save( false );
      SyncStore.flush( true );
    } );
    window.setInterval( function () { Play.renderStatus(); } , 500 );

    const unlock = function () {
      Sound.unlock();
      document.removeEventListener( "pointerdown" , unlock );
      document.removeEventListener( "keydown" , unlock );
    };
    document.addEventListener( "pointerdown" , unlock );
    document.addEventListener( "keydown" , unlock );
  },

  // Enter submits and Esc deselects -- unless a dialog is open or the
  // player is typing somewhere, where those keys already mean something.
  wireKeyboard() {
    document.addEventListener( "keydown" , function ( event ) {
      if ( event.ctrlKey || event.metaKey || event.altKey ) return;
      if ( document.querySelector( "dialog[open]" ) ) return;
      const target = event.target;
      if ( target && target.closest && target.closest( "input, select, textarea, .menu" ) ) return;
      if ( event.key === "Enter" && Game.selected.length === 4 ) {
        event.preventDefault();
        Play.submit();
      } else if ( event.key === "Escape" ) {
        Menu.closeMore();
        Play.deselect();
      }
    } );
  },

  // --- drawing ---------------------------------------------------------------

  render( options ) {
    if ( Game.meta === null ) return;
    Board.render( Game , Object.assign( { busy: this.busy } , options || {} ) );
    this.renderHints();
    this.renderButtons();
    this.renderStatus();
  },

  renderButtons() {
    if ( Game.meta === null ) return;
    Dom.get( "shuffle-button" ).disabled = this.busy || Game.playing() === false;
    Dom.get( "deselect-button" ).disabled = this.busy || Game.selected.length === 0;
    Dom.get( "submit-button" ).disabled = this.busy || Game.selected.length !== 4;
    Dom.all( '.game-header [data-action="hint"]' ).forEach( function ( button ) {
      button.disabled = Game.hintsLeft() === false;
    } );
  },

  // The groups a hint has named and the player hasn't found yet.
  renderHints() {
    const line = Dom.get( "hint-line" );
    const list = Dom.get( "hint-list" );
    Dom.clear( list );
    const open = Game.playing() ? Game.hinted.filter( function ( level ) { return Game.found.indexOf( level ) === -1; } ) : [];
    open.forEach( function ( level ) {
      list.appendChild( Dom.el( "li" , { class: "hint-chip level-" + level , text: Game.groups[ level ].group } ) );
    } );
    Dom.show( line , this.features.hints && open.length > 0 );
  },

  renderStatus() {
    if ( Game.meta === null ) return;
    const showTimer = Settings.get( "show_timer" );
    Dom.show( Dom.get( "timer" ) , showTimer );
    if ( showTimer ) Dom.text( Dom.get( "timer-value" ) , Game.formatDuration( Game.elapsedMs() / 1000 ) );
  },

  renderHeader() {
    Dom.text( Dom.get( "game-label" ) , I18n.format( "game.label" , {
      date: Dates.display( Game.meta.id , "long" ),
      id: Game.meta.puzzleId,
    } ) );
    Dom.show( Dom.get( "random-badge" ) , Game.meta.kind === "random" );
  },

  renderAccountLink() {
    const link = Dom.get( "account-link" );
    const label = this.me && this.me.authenticated
      ? I18n.format( "nav.account_signed_in" , { name: this.me.display_name } )
      : I18n.get( "nav.sign_in" );
    link.setAttribute( "aria-label" , label );
    link.setAttribute( "title" , label );
    link.classList.toggle( "signed-in" , Boolean( this.me && this.me.authenticated ) );
  },

  onSettingChanged() {
    this.renderStatus();
  },

  // The login route redirects here with ?login=invalid rather than explaining
  // what was wrong with the link -- see server/routes/auth.go.
  noticeFromUrl() {
    const params = new URLSearchParams( window.location.search );
    if ( params.get( "login" ) === "invalid" ) {
      this.toast( I18n.get( "signed_out.invalid_link" ) , 8000 );
      window.history.replaceState( null , "" , window.location.pathname );
    }
  },

  toast( message , milliseconds ) {
    if ( !message ) return;
    const toast = Dom.get( "toast" );
    Dom.text( toast , message );
    Dom.show( toast , true );
    window.clearTimeout( this.toastTimer );
    this.toastTimer = window.setTimeout( function () { Dom.show( toast , false ); } , milliseconds || 3500 );
  },
};

document.addEventListener( "DOMContentLoaded" , function () {
  Play.init();
} );
