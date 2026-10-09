package routes

import (
	strconv "strconv"

	fiber "github.com/gofiber/fiber/v3"

	models "connections/server/models"
)

// The admin's view of one player's games: the same result list their own
// stats are built from, nothing more. Behind RequireAdmin (see routes.go).

func ( handlers *Handlers ) GetUserResults( c fiber.Ctx ) ( err error ) {
	user_id , parse_err := strconv.ParseUint( c.Params( "user_id" ) , 10 , 64 )
	if parse_err != nil {
		err = badRequest( c , "invalid user id" )
		return
	}
	user , get_err := models.GetUser( handlers.Store , user_id )
	if get_err != nil {
		err = notFound( c , "no such user" )
		return
	}
	results , load_err := models.GetResults( handlers.Store , user.ID )
	if load_err != nil {
		err = serverError( c )
		return
	}
	err = c.JSON( fiber.Map{
		"user":    fiber.Map{ "id": user.ID , "display_name": user.DisplayName },
		"results": results,
	} )
	return
}
