// The header's buttons and every dialog: the ⋯ menu, Help, Settings,
// Statistics, the result card, and confirmations. Dialogs are native
// <dialog> elements, which bring focus trapping and Esc-to-close for free.
// The archive calendar has its own file, archive.js.
const Menu = {
  confirmResolve: null,
  shown: null,       // the result the result card is showing

  init() {
    const more = Dom.get( "more-button" );
    more.addEventListener( "click" , function ( event ) {
      event.stopPropagation();
      if ( Dom.get( "more-menu" ).hidden ) Menu.openMore(); else Menu.closeMore();
    } );
    Dom.all( "#more-menu [data-action]" ).forEach( function ( item ) {
      item.addEventListener( "click" , function () {
        Menu.closeMore();
        Play.action( item.getAttribute( "data-action" ) );
      } );
    } );
    document.addEventListener( "click" , function ( event ) {
      if ( !event.target.closest( ".menu-wrap" ) ) Menu.closeMore();
    } );

    // Header buttons share the ⋯ menu's actions. Direct children only: the
    // ⋯ menu's own items are wired above.
    Dom.all( ".game-header > [data-action], .header-actions > [data-action]" ).forEach( function ( button ) {
      button.addEventListener( "click" , function () { Play.action( button.getAttribute( "data-action" ) ); } );
    } );

    Dom.all( "dialog [data-close]" ).forEach( function ( button ) {
      button.addEventListener( "click" , function () { button.closest( "dialog" ).close(); } );
    } );

    Dom.get( "confirm-yes" ).addEventListener( "click" , function () { Menu.settleConfirm( true ); } );
    Dom.get( "confirm-no" ).addEventListener( "click" , function () { Menu.settleConfirm( false ); } );
    Dom.get( "confirm-dialog" ).addEventListener( "close" , function () { Menu.settleConfirm( false ); } );

    Dom.get( "result-share" ).addEventListener( "click" , function () {
      if ( Menu.shown ) Play.shareResult( Menu.shown );
    } );
    Dom.get( "result-stats" ).addEventListener( "click" , function () {
      Menu.close( "result-dialog" );
      Stats.open();
    } );
    Dom.get( "result-random" ).addEventListener( "click" , function () {
      Menu.close( "result-dialog" );
      Play.random();
    } );
    this.buildLegend();
  },

  // Opened at the top: showModal focuses the first button, which in a long
  // dialog is at the bottom and would scroll the start out of view.
  open( id ) {
    const dialog = Dom.get( id );
    if ( !dialog || dialog.open ) return;
    dialog.showModal();
    dialog.scrollTop = 0;
  },

  close( id ) {
    const dialog = Dom.get( id );
    if ( dialog && dialog.open ) dialog.close();
  },

  openMore() {
    Dom.show( Dom.get( "more-menu" ) , true );
    Dom.get( "more-button" ).setAttribute( "aria-expanded" , "true" );
  },

  closeMore() {
    Dom.show( Dom.get( "more-menu" ) , false );
    Dom.get( "more-button" ).setAttribute( "aria-expanded" , "false" );
  },

  // The colour key in How to Play: four swatches, easiest to trickiest.
  buildLegend() {
    const legend = Dom.get( "help-legend" );
    for ( let level = 0; level < 4; level += 1 ) {
      let label = "";
      if ( level === 0 ) label = I18n.get( "help.easy" );
      if ( level === 3 ) label = I18n.get( "help.tricky" );
      legend.appendChild( Dom.el( "li" , { children: [
        Dom.el( "span" , { class: "swatch level-" + level , attrs: { title: I18n.get( "game.level_" + level ) } } ),
        Dom.el( "span" , { text: label } ),
      ] } ) );
    }
  },

  confirm( messageKey , yesKey ) {
    this.settleConfirm( false );
    Dom.text( Dom.get( "confirm-message" ) , I18n.get( messageKey ) );
    Dom.text( Dom.get( "confirm-yes" ) , I18n.get( yesKey ) );
    const self = this;
    return new Promise( function ( resolve ) {
      self.confirmResolve = resolve;
      self.open( "confirm-dialog" );
    } );
  },

  settleConfirm( answer ) {
    const resolve = this.confirmResolve;
    this.confirmResolve = null;
    this.close( "confirm-dialog" );
    if ( resolve ) resolve( answer );
  },

  // The result card. practice: this play was a replay, so the stats keep
  // the first result; hints: false when this player has no hints, so the
  // count is left out rather than show a feature they never had.
  showResult( result , options ) {
    const settings = options || {};
    this.shown = result;
    const titleKey = result.outcome === "solved" ? "result.title_" + Math.min( result.mistakes , 3 ) : "result.title_failed";
    Dom.text( Dom.get( "result-heading" ) , I18n.get( titleKey ) );
    Dom.text( Dom.get( "result-subtitle" ) , I18n.format( "result.subtitle" , {
      id: result.puzzle_id,
      date: Dates.display( result.game_id , "medium" ),
    } ) );

    const grid = Dom.get( "result-grid" );
    Dom.clear( grid );
    grid.appendChild( Score.gridElement( result , false ) );

    const skill = Score.skill( result );
    Dom.text( Dom.get( "result-skill" ) , String( skill.total ) );
    const breakdown = Dom.get( "result-breakdown" );
    Dom.clear( breakdown );
    const line = function ( key , points ) {
      breakdown.appendChild( Dom.el( "li" , { children: [
        Dom.el( "span" , { text: I18n.get( "result." + key ) } ),
        Dom.el( "span" , { class: "points" , text: points } ),
      ] } ) );
    };
    line( skill.baseKey , I18n.format( "result.points" , { points: skill.base } ) );
    if ( skill.bonusKey ) line( skill.bonusKey , I18n.format( "result.bonus_points" , { points: skill.bonus } ) );

    Dom.text( Dom.get( "result-details" ) , I18n.format( settings.hints === false ? "result.details_no_hints" : "result.details" , {
      mistakes: result.mistakes,
      hints: result.hints,
      time: Game.formatDuration( result.seconds ),
    } ) );
    Dom.show( Dom.get( "result-practice" ) , settings.practice === true );
    this.open( "result-dialog" );
  },
};
