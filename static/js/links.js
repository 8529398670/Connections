// Every board has its own address, so the address bar is always something
// you can copy and send:
//
//   /                     today's board
//   /daily/2026-10-09     that day's board
//
// The server needs no routes for this: any extensionless path is answered
// with index.html (server/static/static.go), and this file reads the rest.
const Links = {
  // The date a path names, null for the front door, or false for a path
  // that names nothing this site can open.
  parse( pathname ) {
    const parts = String( pathname ).split( "/" ).filter( Boolean ).filter( function ( part ) { return part !== "index.html"; } );
    if ( parts.length === 0 ) return null;
    if ( parts.length === 2 && parts[ 0 ] === "daily" && Dates.parse( parts[ 1 ] ) !== null ) return parts[ 1 ];
    return false;
  },

  pathFor( date ) {
    return "/daily/" + date;
  },

  urlFor( date ) {
    return window.location.origin + this.pathFor( date );
  },
};
