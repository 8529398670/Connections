// The archive: a month calendar of every board, each day marked with how
// the player got on. Picking a day opens that board. The calendar runs from
// the first puzzle to today's, and each day's state comes from the results
// list (finished boards) and saved games (boards under way).
const Archive = {
  year: 0,
  month: 0,          // 0-11
  onPick: null,
  SVG: "http://www.w3.org/2000/svg",

  init( onPick , onRandom ) {
    this.onPick = onPick;
    Dom.get( "archive-prev" ).addEventListener( "click" , function () { Archive.step( -1 ); } );
    Dom.get( "archive-next" ).addEventListener( "click" , function () { Archive.step( 1 ); } );
    Dom.get( "archive-month" ).addEventListener( "change" , function ( event ) {
      Archive.show( Archive.year , Number( event.target.value ) );
    } );
    Dom.get( "archive-year" ).addEventListener( "change" , function ( event ) {
      Archive.show( Number( event.target.value ) , Archive.month );
    } );
    Dom.get( "archive-today" ).addEventListener( "click" , function () {
      Menu.close( "archive-dialog" );
      onPick( Puzzles.todays() );
    } );
    Dom.get( "archive-random" ).addEventListener( "click" , function () {
      Menu.close( "archive-dialog" );
      onRandom();
    } );

    const weekdays = Dom.get( "archive-weekdays" );
    I18n.get( "archive.weekdays" ).split( "," ).forEach( function ( letter ) {
      weekdays.appendChild( Dom.el( "span" , { text: letter.trim() } ) );
    } );
    Dom.text( Dom.get( "archive-subheading" ) , I18n.format( "archive.subheading" , { first: Dates.display( Puzzles.first , "medium" ) } ) );
  },

  // Opens on the month of the board being played.
  open( date ) {
    const shown = Dates.parse( date || Puzzles.todays() ) || new Date();
    this.show( shown.getFullYear() , shown.getMonth() );
    Menu.open( "archive-dialog" );
  },

  bounds() {
    const first = Dates.parse( Puzzles.first );
    const last = Dates.parse( Puzzles.todays() );
    return {
      first: first.getFullYear() * 12 + first.getMonth(),
      last: last.getFullYear() * 12 + last.getMonth(),
      firstYear: first.getFullYear(),
      lastYear: last.getFullYear(),
    };
  },

  step( months ) {
    const index = this.year * 12 + this.month + months;
    this.show( Math.floor( index / 12 ) , index % 12 );
  },

  show( year , month ) {
    const bounds = this.bounds();
    const index = Math.min( Math.max( year * 12 + month , bounds.first ) , bounds.last );
    this.year = Math.floor( index / 12 );
    this.month = index % 12;
    Dom.get( "archive-prev" ).disabled = index <= bounds.first;
    Dom.get( "archive-next" ).disabled = index >= bounds.last;
    this.renderSelects( bounds );
    this.renderDays();
  },

  renderSelects( bounds ) {
    const months = Dom.get( "archive-month" );
    Dom.clear( months );
    for ( let month = 0; month < 12; month += 1 ) {
      const option = Dom.el( "option" , { text: Dates.monthName( month ) , attrs: { value: String( month ) } } );
      const index = this.year * 12 + month;
      option.disabled = index < bounds.first || index > bounds.last;
      months.appendChild( option );
    }
    months.value = String( this.month );

    const years = Dom.get( "archive-year" );
    Dom.clear( years );
    for ( let year = bounds.firstYear; year <= bounds.lastYear; year += 1 ) {
      years.appendChild( Dom.el( "option" , { text: String( year ) , attrs: { value: String( year ) } } ) );
    }
    years.value = String( this.year );
  },

  renderDays() {
    const grid = Dom.get( "archive-grid" );
    Dom.clear( grid );
    const today = Dates.today();
    const results = {};
    SyncStore.results.forEach( function ( result ) { results[ result.game_id ] = result; } );
    const current = Game.meta ? Game.meta.id : null;

    const lead = new Date( this.year , this.month , 1 ).getDay();
    for ( let i = 0; i < lead; i += 1 ) grid.appendChild( Dom.el( "span" , { class: "day day-blank" } ) );

    const days = new Date( this.year , this.month + 1 , 0 ).getDate();
    for ( let day = 1; day <= days; day += 1 ) {
      const date = Dates.key( new Date( this.year , this.month , day ) );
      const state = this.state( date , today , results );
      if ( state === "none" ) {
        grid.appendChild( Dom.el( "span" , {
          class: "day day-none",
          attrs: { "aria-label": I18n.format( "archive.day_label" , { date: Dates.display( date , "medium" ) , state: I18n.get( "archive.state_none" ) } ) },
          children: [ Dom.el( "span" , { class: "day-dot" } ) ],
        } ) );
        continue;
      }
      grid.appendChild( Dom.el( "button" , {
        class: "day state-" + state + ( date === current ? " current" : "" ),
        attrs: {
          type: "button",
          "aria-label": I18n.format( "archive.day_label" , { date: Dates.display( date , "medium" ) , state: I18n.get( "archive.state_" + state ) } ),
          "aria-current": date === current ? "date" : "false",
        },
        children: [
          Dom.el( "span" , { class: "day-box" , children: this.icon( state ) } ),
          Dom.el( "span" , { class: "day-num" , text: String( day ) } ),
        ],
        on: { click: function () {
          Menu.close( "archive-dialog" );
          Archive.onPick( date );
        } },
      } ) );
    }
  },

  // perfect | solved | failed | playing | unplayed | none
  state( date , today , results ) {
    if ( date > today || Puzzles.has( date ) === false ) return "none";
    const result = results[ date ];
    if ( result ) {
      if ( result.outcome === "solved" ) return result.mistakes === 0 ? "perfect" : "solved";
      return "failed";
    }
    const saved = SyncStore.game( date );
    if ( saved && saved.status === "solved" ) return saved.mistakes === 0 ? "perfect" : "solved";
    if ( saved && saved.status === "failed" ) return "failed";
    if ( saved && ( ( saved.guesses || [] ).length > 0 || ( saved.hinted || [] ).length > 0 ) ) return "playing";
    return "unplayed";
  },

  icon( state ) {
    const paths = {
      perfect: "M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z",
      solved: "M5 12.5l4.5 4.5L19 7.5",
      failed: "M7 7l10 10M17 7L7 17",
    };
    if ( !paths[ state ] ) return [];
    const svg = document.createElementNS( this.SVG , "svg" );
    svg.setAttribute( "viewBox" , "0 0 24 24" );
    svg.setAttribute( "aria-hidden" , "true" );
    svg.setAttribute( "class" , "day-icon" );
    const path = document.createElementNS( this.SVG , "path" );
    path.setAttribute( "d" , paths[ state ] );
    svg.appendChild( path );
    return [ svg ];
  },
};
