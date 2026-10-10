// The settings dialog. The list is built from NAMES, and each label comes
// from settings.<name> in language.yaml -- so emptying a label there removes
// that setting from the dialog, like every other piece of text in the app.
//
// The names must match the allow-list in server/models/connections_settings.go;
// the server refuses any it does not know. Every setting is a switch.
const Settings = {
  // unlimited_guessing is only drawn for a player an admin has allowed it;
  // play.js hides it otherwise.
  GAMEBOARD: [ "show_timer" , "sound_on_solve" , "unlimited_guessing" ],
  APPEARANCE: [ "dark_mode" ],

  // Like the NYT game: no clock on screen, a chime on a win, light mode
  // unless someone opts in.
  DEFAULTS: {
    show_timer: false,
    sound_on_solve: true,
    dark_mode: false,
    unlimited_guessing: false,
  },

  values: {},
  onChange: null,
  inputs: {},

  init( saved , onChange ) {
    this.onChange = onChange;
    this.values = Object.assign( {} , this.DEFAULTS );
    const stored = saved && saved.values ? saved.values : {};
    Object.keys( this.DEFAULTS ).forEach( function ( name ) {
      if ( typeof stored[ name ] === "boolean" ) Settings.values[ name ] = stored[ name ];
    } );
    this.build( Dom.get( "settings-list" ) , this.GAMEBOARD );
    this.build( Dom.get( "appearance-list" ) , this.APPEARANCE );
    this.applyTheme();
  },

  build( list , names ) {
    if ( !list ) return;
    names.forEach( function ( name ) {
      const label = I18n.get( "settings." + name );
      if ( label === "" ) return;
      const input = Dom.el( "input" , { attrs: { type: "checkbox" , id: "setting-" + name } } );
      input.checked = Settings.values[ name ];
      input.addEventListener( "change" , function () { Settings.set( name , input.checked ); } );
      Settings.inputs[ name ] = input;
      list.appendChild( Dom.el( "li" , { children: [
        Dom.el( "label" , { class: "setting-row" , attrs: { for: "setting-" + name } , children: [
          input,
          Dom.el( "span" , { text: label } ),
        ] } ),
      ] } ) );
    } );
  },

  // Takes a setting out of the dialog entirely, when the player cannot use
  // the feature it controls. Its saved value is kept, so it is back as it
  // was if the feature is switched on again; callers check the feature.
  hide( name ) {
    const input = this.inputs[ name ];
    if ( input && input.closest( "li" ) ) input.closest( "li" ).remove();
    delete this.inputs[ name ];
  },

  get( name ) {
    return this.values[ name ] === true;
  },

  set( name , value ) {
    this.values[ name ] = value;
    if ( this.inputs[ name ] ) this.inputs[ name ].checked = value;
    if ( name === "dark_mode" ) this.applyTheme();
    SyncStore.saveSettings( this.values );
    if ( this.onChange ) this.onChange( name );
  },

  applyTheme() {
    if ( this.values.dark_mode ) document.documentElement.setAttribute( "data-theme" , "dark" );
    else document.documentElement.removeAttribute( "data-theme" );
  },
};
