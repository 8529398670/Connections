package routes

import (
	json "encoding/json"
	time "time"

	fiber "github.com/gofiber/fiber/v3"

	models "connections/server/models"
	security "connections/server/security"
)

// The connections endpoints are storage for a signed-in player: settings,
// games in progress, finished results, and what the Random button has dealt.
// The game itself -- checking guesses, hints, scoring -- runs entirely in
// static/js/, and a signed-out player gets the same game with localStorage
// standing in for all of this.

type settingsRequest struct {
	Settings  map[string]any `json:"settings"`
	CSRFToken string         `json:"csrf_token"`
}

type gameRequest struct {
	ID          string          `json:"id"`
	UpdatedAt   int64           `json:"updated_at"`
	State       json.RawMessage `json:"state"`
	MakeCurrent bool            `json:"make_current"`
	CSRFToken   string          `json:"csrf_token"`
}

type resultsRequest struct {
	Results   []models.Result `json:"results"`
	CSRFToken string                `json:"csrf_token"`
}

func ( handlers *Handlers ) GetSettings( c fiber.Ctx ) ( err error ) {
	user := security.UserFrom( c )
	settings , load_err := models.GetSettings( handlers.Store , user.ID )
	if load_err != nil {
		err = serverError( c )
		return
	}
	// null rather than {} for "never saved", so the client knows to push its
	// local settings up instead of adopting an empty set.
	var values map[string]any
	if settings != nil { values = settings.Values }
	err = c.JSON( fiber.Map{ "settings": values } )
	return
}

func ( handlers *Handlers ) SaveSettings( c fiber.Ctx ) ( err error ) {
	var body settingsRequest
	if c.Bind().Body( &body ) != nil {
		err = badRequest( c , "malformed request body" )
		return
	}
	if handlers.Guard.CheckCSRF( c , body.CSRFToken ) == false {
		err = forbidden( c , "invalid csrf token" )
		return
	}
	if models.ValidSettings( body.Settings ) == false {
		err = badRequest( c , "unknown setting" )
		return
	}
	user := security.UserFrom( c )
	if models.SaveSettings( handlers.Store , user.ID , body.Settings ) != nil {
		err = serverError( c )
		return
	}
	err = c.JSON( fiber.Map{ "ok": true } )
	return
}

func ( handlers *Handlers ) ListGames( c fiber.Ctx ) ( err error ) {
	user := security.UserFrom( c )
	record , load_err := models.GetSavedGames( handlers.Store , user.ID )
	if load_err != nil {
		err = serverError( c )
		return
	}
	err = c.JSON( fiber.Map{
		"current_id": record.CurrentID,
		"games":      models.SortedSavedGames( record ),
	} )
	return
}

func ( handlers *Handlers ) SaveGame( c fiber.Ctx ) ( err error ) {
	var body gameRequest
	if c.Bind().Body( &body ) != nil {
		err = badRequest( c , "malformed request body" )
		return
	}
	if handlers.Guard.CheckCSRF( c , body.CSRFToken ) == false {
		err = forbidden( c , "invalid csrf token" )
		return
	}
	if models.ValidGameID( body.ID ) == false {
		err = badRequest( c , "invalid game id" )
		return
	}
	if models.ValidGameState( body.State ) == false {
		err = badRequest( c , "invalid game state" )
		return
	}
	// The timestamp decides which device's copy wins, so one far in the
	// future would freeze a game against every later save. A day of slack
	// covers any honest clock skew.
	latest := time.Now().Add( 24 * time.Hour ).UnixMilli()
	if body.UpdatedAt <= 0 || body.UpdatedAt > latest {
		err = badRequest( c , "invalid updated_at" )
		return
	}

	user := security.UserFrom( c )
	stored , save_err := models.SaveGame( handlers.Store , user.ID , &models.SavedGame{
		ID:        body.ID,
		UpdatedAt: body.UpdatedAt,
		State:     body.State,
	} , body.MakeCurrent )
	if save_err != nil {
		err = serverError( c )
		return
	}
	err = c.JSON( fiber.Map{ "ok": true , "stored": stored } )
	return
}

func ( handlers *Handlers ) ListResults( c fiber.Ctx ) ( err error ) {
	user := security.UserFrom( c )
	results , load_err := models.GetResults( handlers.Store , user.ID )
	if load_err != nil {
		err = serverError( c )
		return
	}
	err = c.JSON( fiber.Map{ "results": results } )
	return
}

func ( handlers *Handlers ) AddResults( c fiber.Ctx ) ( err error ) {
	var body resultsRequest
	if c.Bind().Body( &body ) != nil {
		err = badRequest( c , "malformed request body" )
		return
	}
	if handlers.Guard.CheckCSRF( c , body.CSRFToken ) == false {
		err = forbidden( c , "invalid csrf token" )
		return
	}
	if len( body.Results ) == 0 || len( body.Results ) > models.MaxResultsPerPost {
		err = badRequest( c , "expected 1-100 results" )
		return
	}
	for index := range body.Results {
		if models.ValidResult( &body.Results[ index ] ) == false {
			err = badRequest( c , "invalid result" )
			return
		}
	}

	user := security.UserFrom( c )
	added , add_err := models.AddResults( handlers.Store , user.ID , body.Results )
	if add_err != nil {
		err = serverError( c )
		return
	}
	err = c.JSON( fiber.Map{ "ok": true , "added": added } )
	return
}

type randomRequest struct {
	Cycle     int      `json:"cycle"`
	Seen      []string `json:"seen"`
	CSRFToken string   `json:"csrf_token"`
}

func ( handlers *Handlers ) GetRandomDeck( c fiber.Ctx ) ( err error ) {
	user := security.UserFrom( c )
	deck , load_err := models.GetRandomDeck( handlers.Store , user.ID )
	if load_err != nil {
		err = serverError( c )
		return
	}
	err = c.JSON( deck )
	return
}

// MergeRandomDeck takes a device's whole deck and answers with the merged
// one; see models/connections_random.go for the rule.
func ( handlers *Handlers ) MergeRandomDeck( c fiber.Ctx ) ( err error ) {
	var body randomRequest
	if c.Bind().Body( &body ) != nil {
		err = badRequest( c , "malformed request body" )
		return
	}
	if handlers.Guard.CheckCSRF( c , body.CSRFToken ) == false {
		err = forbidden( c , "invalid csrf token" )
		return
	}
	incoming := &models.RandomDeck{ Cycle: body.Cycle , Seen: body.Seen }
	if models.ValidRandomDeck( incoming ) == false {
		err = badRequest( c , "invalid random deck" )
		return
	}
	user := security.UserFrom( c )
	merged , merge_err := models.MergeRandomDeck( handlers.Store , user.ID , incoming )
	if merge_err != nil {
		err = serverError( c )
		return
	}
	err = c.JSON( merged )
	return
}
