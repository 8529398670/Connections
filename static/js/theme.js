// Loaded in <head>, before the stylesheet paints anything, so a player who
// chose dark mode never sees a flash of the light theme first. It reads the
// settings sync.js keeps in localStorage; settings.js takes over once the
// page is up. Light stays the default when there is nothing to read.
( function () {
  try {
    const raw = window.localStorage.getItem( "connections.settings" );
    const saved = raw ? JSON.parse( raw ) : null;
    if ( saved && saved.values && saved.values.dark_mode === true ) {
      document.documentElement.setAttribute( "data-theme" , "dark" );
    }
  } catch ( error ) {
    // Storage blocked (private window, previews): stay light.
  }
} )();
