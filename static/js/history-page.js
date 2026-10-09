// The admin's view of one player's finished puzzles (history.html?user=<id>):
// the same results their own stats are built from, newest first, each with
// its guess grid and skill score.
const HistoryPage = {
  async init() {
    try {
      await I18n.load();
      I18n.apply();
    } catch ( error ) {
      Dom.text( Dom.get( "error-banner" ) , "Could not load language file." );
      Dom.show( Dom.get( "error-banner" ) , true );
      return;
    }
    Dom.show( Dom.get( "main" ) , true );

    const userId = new URLSearchParams( window.location.search ).get( "user" );
    if ( /^[0-9]{1,20}$/.test( userId || "" ) === false ) return this.fail( "history.load_failed" );
    let data;
    try {
      await Api.me();
      data = await Api.userResults( userId );
    } catch ( error ) {
      return this.fail( error.status === 401 || error.status === 403 ? "history.not_admin" : "history.load_failed" );
    }

    const name = data.user.display_name;
    Dom.text( Dom.get( "player-name" ) , name );
    document.title = name + " · " + I18n.get( "history.title" );
    const results = ( data.results || [] ).slice().sort( function ( a , b ) { return b.finished_at - a.finished_at; } );
    this.renderTotals( results );
    this.renderGames( results );
  },

  fail( key ) {
    const banner = Dom.get( "error-banner" );
    Dom.text( banner , I18n.get( key ) );
    Dom.show( banner , true );
  },

  renderTotals( results ) {
    const wins = results.filter( function ( result ) { return result.outcome === "solved"; } );
    Dom.text( Dom.get( "history-totals" ) , I18n.format( "history.totals" , {
      games: results.length,
      wins: wins.length,
      perfect: wins.filter( function ( result ) { return result.mistakes === 0; } ).length,
    } ) );
  },

  renderGames( results ) {
    const body = Dom.get( "games-table" ).querySelector( "tbody" );
    Dom.clear( body );
    Dom.show( Dom.get( "no-games" ) , results.length === 0 );
    results.forEach( function ( result ) {
      const cell = function ( text , className ) { return Dom.el( "td" , { text: text , class: className || "" } ); };
      const minutes = Math.floor( result.seconds / 60 );
      body.appendChild( Dom.el( "tr" , { children: [
        cell( I18n.format( "history.puzzle_label" , { id: result.puzzle_id , date: result.game_id } ) , "nowrap" ),
        cell( new Date( result.finished_at ).toLocaleString() , "nowrap" ),
        cell( I18n.get( "history.kind_" + result.kind ) ),
        cell( I18n.get( "history.outcome_" + result.outcome ) , "outcome-" + result.outcome ),
        cell( String( result.mistakes ) ),
        cell( String( result.hints ) ),
        cell( minutes + ":" + String( result.seconds % 60 ).padStart( 2 , "0" ) , "nowrap" ),
        cell( String( Score.skill( result ).total ) ),
        Dom.el( "td" , { children: [ Score.gridElement( result , true ) ] } ),
      ] } ) );
    } );
  },
};

document.addEventListener( "DOMContentLoaded" , function () {
  HistoryPage.init();
} );
