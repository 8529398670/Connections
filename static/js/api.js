// Every call to the server goes through here, so the things that are easy to
// forget -- sending the cookie, attaching the CSRF token, turning a non-2xx
// response into a real Error -- happen once instead of at each call site.
const Api = {
  csrfToken: null,

  async request( path , options ) {
    const settings = options || {};
    const response = await fetch( path , {
      method: settings.method || "GET",
      // The session cookie is the only credential; without this an
      // authenticated request silently arrives as an anonymous one.
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: settings.body ? JSON.stringify( settings.body ) : undefined,
      // keepalive lets a save started as the tab closes finish anyway.
      keepalive: settings.keepalive === true,
    } );

    let payload = {};
    try {
      payload = await response.json();
    } catch ( parseError ) {
      payload = {};
    }

    if ( !response.ok ) {
      const error = new Error( payload.error || response.statusText );
      error.status = response.status;
      throw error;
    }
    return payload;
  },

  // Whether a failed call is worth sending again. A network failure, a
  // server error, a timeout or "too many requests" will pass; any other
  // refusal (a bad body, signed out, forbidden) will be the same next time.
  isRetryable( error ) {
    const status = error && error.status;
    return !status || status >= 500 || status === 429 || status === 408;
  },

  // Any state-changing call carries the per-session CSRF token in the body.
  // Wrapping it here means a new endpoint cannot forget it.
  async post( path , body , options ) {
    return this.request( path , {
      method: "POST",
      body: Object.assign( {} , body || {} , { csrf_token: this.csrfToken } ),
      keepalive: Boolean( options && options.keepalive ),
    } );
  },

  async me() {
    try {
      const payload = await this.request( "/api/me" );
      this.csrfToken = payload.csrf_token;
      return payload;
    } catch ( error ) {
      if ( error.status === 401 ) return { authenticated: false };
      throw error;
    }
  },

  rename( displayName )        { return this.post( "/api/account/rename" , { display_name: displayName } ); },
  logout()                     { return this.post( "/api/logout" ); },
  listTeam()                   { return this.request( "/api/team" ); },
  listUsers()                  { return this.request( "/api/admin/users" ); },
  createUser( name , role )    { return this.post( "/api/admin/users" , { display_name: name , role: role } ); },
  reissueLogin( userId )       { return this.post( "/api/admin/users/" + userId + "/reissue-login" ); },
  setDisabled( userId , flag ) { return this.post( "/api/admin/users/" + userId + "/disabled" , { disabled: flag } ); },
  deleteUser( userId )         { return this.post( "/api/admin/users/" + userId + "/delete" ); },
  // change: { hints: bool }
  setFeatures( userId , change ) { return this.post( "/api/admin/users/" + userId + "/features" , change ); },

  // API keys. createKey's expiresInDays is passed through as-is including null,
  // because the server reads absent as "use the default" and 0 as "never
  // expires" -- collapsing them here would lose the distinction.
  listKeys()                   { return this.request( "/api/keys" ); },
  createKey( name , role , expiresInDays ) {
    return this.post( "/api/keys" , { name: name , role: role , expires_in_days: expiresInDays } );
  },
  revokeKey( keyId )           { return this.post( "/api/keys/" + encodeURIComponent( keyId ) + "/revoke" ); },
  listAllKeys()                { return this.request( "/api/admin/keys" ); },
  revokeAnyKey( keyId )        { return this.post( "/api/admin/keys/" + encodeURIComponent( keyId ) + "/revoke" ); },

  // The boards. Public: anyone can play signed out.
  puzzles()                    { return this.request( "/api/puzzles" ); },
  puzzle( date )               { return this.request( "/api/puzzles/" + encodeURIComponent( date ) ); },

  // Storage for a signed-in player. sync.js is the only caller.
  gameSettings()               { return this.request( "/api/connections/settings" ); },
  saveGameSettings( values )   { return this.post( "/api/connections/settings" , { settings: values } ); },
  savedGames()                 { return this.request( "/api/connections/games" ); },
  saveGame( entry , makeCurrent , keepalive ) {
    return this.post( "/api/connections/games" , {
      id: entry.id , updated_at: entry.updated_at , state: entry.state , make_current: makeCurrent,
    } , { keepalive: keepalive } );
  },
  results()                    { return this.request( "/api/connections/results" ); },
  addResults( results )        { return this.post( "/api/connections/results" , { results: results } ); },
  randomDeck()                 { return this.request( "/api/connections/random" ); },
  mergeRandomDeck( deck , keepalive ) {
    return this.post( "/api/connections/random" , { cycle: deck.cycle , seen: deck.seen } , { keepalive: keepalive } );
  },

  // A player's finished games, for the admin history page.
  userResults( userId )        { return this.request( "/api/admin/users/" + userId + "/results" ); },
};
