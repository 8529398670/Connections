// What a finished game is worth, worked out from its result alone -- the
// result card, the share text and the admin's history page all use this, so
// a score means the same thing everywhere.
//
// The skill score follows the NYT's published breakdown: a base for how the
// game ended, plus the single best bonus a win earned. 95 + 4 makes 99.
const Score = {
  SQUARES: [ "🟨" , "🟩" , "🟦" , "🟪" ],
  WIN_BASE: [ 95 , 88 , 81 , 73 ],      // by mistakes
  LOSE_BASE: [ 50 , 57 , 65 , 65 ],     // by groups found

  levels( guess ) {
    return guess.map( function ( tile ) { return tile >> 2; } );
  },

  isCorrect( guess ) {
    const levels = this.levels( guess );
    return levels.every( function ( level ) { return level === levels[ 0 ]; } );
  },

  // The levels found, in the order they were found.
  foundOrder( result ) {
    const self = this;
    return result.guesses.filter( function ( guess ) { return self.isCorrect( guess ); } )
      .map( function ( guess ) { return guess[ 0 ] >> 2; } );
  },

  // { total , base , baseKey , bonus , bonusKey }. The keys name the lines
  // of the breakdown in language.yaml (result.base_* / result.bonus_*).
  skill( result ) {
    const order = this.foundOrder( result );
    let base;
    let baseKey;
    if ( result.outcome === "solved" ) {
      base = this.WIN_BASE[ Math.min( result.mistakes , 3 ) ];
      baseKey = "base_win_" + Math.min( result.mistakes , 3 );
    } else {
      const found = Math.min( order.length , 2 );
      base = this.LOSE_BASE[ found ];
      baseKey = "base_lose_" + found;
    }
    let bonus = 0;
    let bonusKey = null;
    if ( result.outcome === "solved" ) {
      if ( order.join( "" ) === "3210" ) {
        bonus = 4;
        bonusKey = "bonus_reverse_rainbow";
      } else if ( ( order[ 0 ] === 3 && order[ 1 ] === 2 ) || ( order[ 0 ] === 2 && order[ 1 ] === 3 ) ) {
        bonus = 3;
        bonusKey = "bonus_purple_blue";
      } else if ( order[ 0 ] === 3 ) {
        bonus = 2;
        bonusKey = "bonus_purple_first";
      } else if ( order[ 0 ] === 2 ) {
        bonus = 1;
        bonusKey = "bonus_blue_first";
      }
    }
    return { total: base + bonus , base: base , baseKey: baseKey , bonus: bonus , bonusKey: bonusKey };
  },

  purpleFirst( result ) {
    return this.foundOrder( result )[ 0 ] === 3;
  },

  // One line of coloured squares per guess.
  gridText( result ) {
    const self = this;
    return result.guesses.map( function ( guess ) {
      return self.levels( guess ).map( function ( level ) { return self.SQUARES[ level ]; } ).join( "" );
    } ).join( "\n" );
  },

  shareText( result ) {
    return I18n.format( "result.share_text" , { id: result.puzzle_id , grid: this.gridText( result ) } );
  },

  // The same grid as DOM: rows of coloured squares, coloured by CSS.
  gridElement( result , small ) {
    const self = this;
    return Dom.el( "div" , {
      class: "guess-grid" + ( small ? " guess-grid-small" : "" ),
      attrs: { "aria-hidden": "true" },
      children: result.guesses.map( function ( guess ) {
        return Dom.el( "div" , {
          class: "guess-row",
          children: self.levels( guess ).map( function ( level ) {
            return Dom.el( "span" , { class: "guess-square level-" + level } );
          } ),
        } );
      } ),
    } );
  },
};
