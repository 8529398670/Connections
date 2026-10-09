// Calendar dates as "YYYY-MM-DD" keys -- the same form the puzzle list and
// every game id use. A key is always read as a *local* date: parsing
// "2026-10-09" with new Date() would mean UTC midnight, which is the 8th for
// anyone west of Greenwich.
const Dates = {
  // The player's local calendar date. "Today's puzzle" means today where
  // the player is.
  today() {
    return this.key( new Date() );
  },

  key( date ) {
    const pad = function ( value ) { return String( value ).padStart( 2 , "0" ); };
    return date.getFullYear() + "-" + pad( date.getMonth() + 1 ) + "-" + pad( date.getDate() );
  },

  // A local Date at midnight, or null when the key is not a real day.
  parse( key ) {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec( String( key ) );
    if ( !match ) return null;
    const year = Number( match[ 1 ] );
    const month = Number( match[ 2 ] ) - 1;
    const day = Number( match[ 3 ] );
    const date = new Date( year , month , day );
    if ( date.getFullYear() !== year || date.getMonth() !== month || date.getDate() !== day ) return null;
    return date;
  },

  addDays( key , days ) {
    const date = this.parse( key );
    date.setDate( date.getDate() + days );
    return this.key( date );
  },

  // style: "long" -> "Thursday, October 9, 2026"; "medium" -> "October 9,
  // 2026"; "short" -> "Oct 9, 2026". In the player's own locale.
  display( key , style ) {
    const date = this.parse( key );
    if ( date === null ) return String( key );
    const options = {
      long: { weekday: "long" , year: "numeric" , month: "long" , day: "numeric" },
      medium: { year: "numeric" , month: "long" , day: "numeric" },
      short: { year: "numeric" , month: "short" , day: "numeric" },
    }[ style || "medium" ];
    try {
      return new Intl.DateTimeFormat( undefined , options ).format( date );
    } catch ( error ) {
      return String( key );
    }
  },

  monthName( month ) {
    try {
      return new Intl.DateTimeFormat( undefined , { month: "long" } ).format( new Date( 2000 , month , 1 ) );
    } catch ( error ) {
      return String( month + 1 );
    }
  },
};
