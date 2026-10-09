// The solve chime, synthesised with WebAudio: no audio file to ship or embed,
// and nothing for the CSP to allow.
//
// Browsers only let audio start after a user gesture, so play.js calls
// unlock() on the first tap or key press; by the time a puzzle is solved the
// context is ready.
const Sound = {
  context: null,

  unlock() {
    try {
      if ( this.context === null ) {
        const AudioContextClass = window.AudioContext || window.webkitAudioContext;
        if ( AudioContextClass ) this.context = new AudioContextClass();
      }
      if ( this.context && this.context.state === "suspended" ) this.context.resume();
    } catch ( error ) {
      this.context = null;
    }
  },

  // A rising major arpeggio: C5 E5 G5 C6.
  chime() {
    const context = this.context;
    if ( !context ) return;
    const start = context.currentTime + 0.02;
    [ 523.25 , 659.25 , 783.99 , 1046.5 ].forEach( function ( frequency , index ) {
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      const at = start + index * 0.11;
      oscillator.type = "sine";
      oscillator.frequency.value = frequency;
      gain.gain.setValueAtTime( 0.0001 , at );
      gain.gain.exponentialRampToValueAtTime( 0.2 , at + 0.02 );
      gain.gain.exponentialRampToValueAtTime( 0.0001 , at + 0.7 );
      oscillator.connect( gain );
      gain.connect( context.destination );
      oscillator.start( at );
      oscillator.stop( at + 0.75 );
    } );
  },
};
