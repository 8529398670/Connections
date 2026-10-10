// Statistics, computed here from the list of results -- the server only
// stores that list. A signed-out player's local list goes through the same
// code, so every number on screen has exactly one definition.
//
// Each board counts once: the first time it was finished. Replays never
// change anything here.
const Stats = {
  open() {
    this.render( this.compute( SyncStore.results , Dates.today() ) , Game.meta ? Game.meta.id : null );
    Dom.show( Dom.get( "stats-signed-out" ) , SyncStore.signedIn === false );
    Menu.open( "stats-dialog" );
  },

  compute( results , today ) {
    const wins = results.filter( function ( result ) { return result.outcome === "solved"; } );
    const onTimeDates = {};
    wins.forEach( function ( result ) { if ( Stats.onTime( result ) ) onTimeDates[ result.game_id ] = true; } );
    const streaks = this.streaks( onTimeDates , today );
    const distribution = [ 0 , 0 , 0 , 0 , 0 ];
    const byDate = {};
    results.forEach( function ( result ) {
      distribution[ Math.min( Math.max( result.mistakes , 0 ) , 4 ) ] += 1;
      byDate[ result.game_id ] = result;
    } );
    return {
      completed: results.length,
      winPercent: results.length ? Math.round( ( wins.length / results.length ) * 100 ) : null,
      currentStreak: streaks.current,
      maxStreak: streaks.best,
      perfect: wins.filter( function ( result ) { return result.mistakes === 0; } ).length,
      purpleFirst: results.filter( function ( result ) { return Score.purpleFirst( result ); } ).length,
      distribution: distribution,
      byDate: byDate,
    };
  },

  // A board only counts toward a streak when it was solved on its own day
  // -- or the morning after, for one started late at night. Archive play
  // never builds a streak, as on the NYT site.
  onTime( result ) {
    if ( !result.finished_at ) return false;
    const finished = new Date( result.finished_at );
    const dayBefore = new Date( result.finished_at );
    dayBefore.setDate( dayBefore.getDate() - 1 );
    return result.game_id === Dates.key( finished ) || result.game_id === Dates.key( dayBefore );
  },

  // Consecutive days with that day's board solved. The current streak
  // survives until a whole day is missed: today not being solved *yet* does
  // not break it.
  streaks( dates , today ) {
    const DAY = 86400000;
    const toTime = function ( key ) {
      const parts = key.split( "-" ).map( Number );
      return Date.UTC( parts[ 0 ] , parts[ 1 ] - 1 , parts[ 2 ] );
    };
    const days = Object.keys( dates ).map( toTime ).sort( function ( a , b ) { return a - b; } );
    let best = 0;
    let run = 0;
    for ( let i = 0; i < days.length; i += 1 ) {
      run = i > 0 && days[ i ] - days[ i - 1 ] === DAY ? run + 1 : 1;
      if ( run > best ) best = run;
    }
    const have = {};
    days.forEach( function ( day ) { have[ day ] = true; } );
    let cursor = toTime( today );
    if ( !have[ cursor ] ) cursor -= DAY;
    let current = 0;
    while ( have[ cursor ] ) {
      current += 1;
      cursor -= DAY;
    }
    return { current: current , best: best };
  },

  // currentId: the board on screen; its bar in the chart is highlighted when
  // it has a result.
  render( stats , currentId ) {
    const empty = I18n.get( "stats.empty_value" );
    const rows = [
      [ "stats.completed" , String( stats.completed ) ],
      [ "stats.win_percent" , stats.winPercent == null ? empty : I18n.format( "stats.percent" , { value: stats.winPercent } ) ],
      [ "stats.current_streak" , String( stats.currentStreak ) ],
      [ "stats.max_streak" , String( stats.maxStreak ) ],
      [ "stats.perfect" , String( stats.perfect ) ],
      [ "stats.purple_first" , String( stats.purpleFirst ) ],
    ];
    const grid = Dom.get( "stats-grid" );
    Dom.clear( grid );
    rows.forEach( function ( row ) {
      const label = I18n.get( row[ 0 ] );
      if ( label === "" ) return;
      // dt before dd, as a <dl> requires; the CSS puts the number on top.
      grid.appendChild( Dom.el( "div" , { class: "stat" , children: [
        Dom.el( "dt" , { class: "stat-label" , text: label } ),
        Dom.el( "dd" , { class: "stat-value" , text: row[ 1 ] } ),
      ] } ) );
    } );

    const chart = Dom.get( "stats-distribution" );
    Dom.clear( chart );
    const most = Math.max.apply( null , stats.distribution.concat( [ 1 ] ) );
    const mine = currentId && stats.byDate[ currentId ] ? Math.min( stats.byDate[ currentId ].mistakes , 4 ) : -1;
    stats.distribution.forEach( function ( count , mistakes ) {
      const bar = Dom.el( "span" , {
        class: "dist-bar" + ( mistakes === mine ? " current" : "" ),
        text: String( count ),
      } );
      // Width through the CSSOM: the CSP forbids inline style attributes,
      // not style properties set from script.
      bar.style.width = Math.max( 8 , Math.round( ( count / most ) * 100 ) ) + "%";
      chart.appendChild( Dom.el( "div" , {
        class: "dist-row",
        attrs: { "aria-label": I18n.format( "stats.distribution_label" , { count: count , mistakes: mistakes } ) },
        children: [
          // The last bar also holds Unlimited-guessing wins with more.
          Dom.el( "span" , { class: "dist-label" , text: mistakes === 4 ? I18n.get( "stats.distribution_last" ) : String( mistakes ) } ),
          Dom.el( "span" , { class: "dist-track" , children: [ bar ] } ),
        ],
      } ) );
    } );
  },
};
