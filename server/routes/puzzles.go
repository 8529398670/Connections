package routes

import (
	fiber "github.com/gofiber/fiber/v3"

	models "connections/server/models"
)

// The boards themselves. Public, because anyone can play signed out, and
// registered ahead of the signed-in /api group in routes.go so its login
// requirement does not reach them.
//
// A board goes to the browser with its answers, as on the NYT page: the
// browser checks every guess itself. Nothing here is a secret worth a round
// trip per guess.

// ListPuzzles is the calendar's map of which days have a board.
func ( handlers *Handlers ) ListPuzzles( c fiber.Ctx ) ( err error ) {
	c.Set( fiber.HeaderContentType , fiber.MIMEApplicationJSONCharsetUTF8 )
	c.Set( fiber.HeaderCacheControl , "no-cache" )
	err = c.Send( handlers.Puzzles.Current().IndexJSON() )
	return
}

func ( handlers *Handlers ) GetPuzzle( c fiber.Ctx ) ( err error ) {
	date := c.Params( "date" )
	if models.ValidGameID( date ) == false {
		err = badRequest( c , "invalid date" )
		return
	}
	puzzle := handlers.Puzzles.Current().ByDate( date )
	if puzzle == nil {
		err = notFound( c , "no puzzle for that date" )
		return
	}
	// A published board never changes, so the browser may keep it.
	c.Set( fiber.HeaderCacheControl , "private, max-age=86400" )
	err = c.JSON( puzzle )
	return
}
