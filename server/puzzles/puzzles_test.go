package puzzles

import (
	context "context"
	json "encoding/json"
	http "net/http"
	httptest "net/http/httptest"
	os "os"
	filepath "path/filepath"
	testing "testing"
)

func board( id int , date string , level int ) ( entry rawPuzzle ) {
	entry = rawPuzzle{ ID: id , Date: date }
	words := [][]string{
		{ "HAIL" , "RAIN" , "SLEET" , "SNOW" },
		{ "BUCKS" , "HEAT" , "JAZZ" , "NETS" },
		{ "OPTION" , "RETURN" , "SHIFT" , "TAB" },
		{ "KAYAK" , "LEVEL" , "MOM" , "RACECAR" },
	}
	for index , members := range words {
		group_level := level
		if level >= 0 { group_level = index }
		entry.Answers = append( entry.Answers , Group{ Level: group_level , Group: "GROUP " + string( rune( 'A' + index ) ) , Members: members } )
	}
	return
}

func encode( t *testing.T , entries []rawPuzzle ) ( raw []byte ) {
	t.Helper()
	raw , err := json.Marshal( entries )
	if err != nil { t.Fatal( err ) }
	return
}

func TestParseNormalizesMissingLevels( t *testing.T ) {
	set , err := Parse( encode( t , []rawPuzzle{ board( 2 , "2023-06-13" , -1 ) , board( 1 , "2023-06-12" , 0 ) } ) )
	if err != nil { t.Fatal( err ) }
	if set.Count() != 2 || set.First() != "2023-06-12" || set.Latest() != "2023-06-13" {
		t.Fatalf( "count %d first %s latest %s" , set.Count() , set.First() , set.Latest() )
	}
	for index , group := range set.ByDate( "2023-06-13" ).Groups {
		if group.Level != index || group.Group != "GROUP " + string( rune( 'A' + index ) ) {
			t.Fatalf( "group %d is level %d %q; want list order" , index , group.Level , group.Group )
		}
	}
}

func TestParseSortsGroupsByLevel( t *testing.T ) {
	entry := board( 1 , "2023-06-12" , 0 )
	entry.Answers[ 0 ].Level , entry.Answers[ 3 ].Level = 3 , 0
	set , err := Parse( encode( t , []rawPuzzle{ entry } ) )
	if err != nil { t.Fatal( err ) }
	groups := set.ByDate( "2023-06-12" ).Groups
	if groups[ 0 ].Group != "GROUP D" || groups[ 3 ].Group != "GROUP A" {
		t.Fatalf( "groups not in level order: %+v" , groups )
	}
}

func TestParseDropsUnplayableBoards( t *testing.T ) {
	empty := board( 660 , "2025-04-01" , 0 )
	for index := range empty.Answers {
		empty.Answers[ index ].Members = []string{ "" , "" , "" , "" }
	}
	short := board( 3 , "2023-06-14" , 0 )
	short.Answers = short.Answers[ :3 ]
	repeated := board( 4 , "2023-06-15" , 0 )
	repeated.Answers[ 1 ].Members[ 0 ] = "hail"
	bad_date := board( 5 , "2023-02-30" , 0 )

	set , err := Parse( encode( t , []rawPuzzle{ board( 1 , "2023-06-12" , 0 ) , empty , short , repeated , bad_date } ) )
	if err != nil { t.Fatal( err ) }
	if set.Count() != 1 || set.Dropped != 4 {
		t.Fatalf( "count %d dropped %d; want 1 and 4" , set.Count() , set.Dropped )
	}
	if set.ByDate( "2025-04-01" ) != nil { t.Fatal( "the empty board was kept" ) }
}

func TestRealArchiveLoads( t *testing.T ) {
	raw , err := os.ReadFile( "../../connections.json" )
	if err != nil { t.Skip( "no connections.json at the module root" ) }
	set , err := Parse( raw )
	if err != nil { t.Fatal( err ) }
	if set.ByDate( "2025-04-01" ) != nil { t.Fatal( "2025-04-01 has no words and should be dropped" ) }
	// The board in example-ui: yellow is DECISIVE VICTORY, purple AIR ___.
	if puzzle := set.ByDate( "2026-10-09" ); puzzle != nil {
		if puzzle.Groups[ 0 ].Group != "DECISIVE VICTORY" || puzzle.Groups[ 3 ].Group != "AIR ___" {
			t.Fatalf( "2026-10-09 colours wrong: %+v" , puzzle.Groups )
		}
	}
}

func newTestLibrary( t *testing.T , embedded []rawPuzzle , server *httptest.Server ) ( library *Library ) {
	t.Helper()
	library , err := New( encode( t , embedded ) , filepath.Join( t.TempDir() , "connections.json" ) , server.URL )
	if err != nil { t.Fatal( err ) }
	library.client = server.Client()
	return
}

func TestRefreshUsesETagAndRefusesShrinking( t *testing.T ) {
	two := []rawPuzzle{ board( 1 , "2023-06-12" , 0 ) , board( 2 , "2023-06-13" , -1 ) }
	three := append( append( []rawPuzzle{} , two... ) , board( 3 , "2023-06-14" , -1 ) )
	serving := three
	requests , conditional := 0 , 0
	server := httptest.NewTLSServer( http.HandlerFunc( func( writer http.ResponseWriter , request *http.Request ) {
		requests += 1
		if request.Header.Get( "If-None-Match" ) == `"v1"` {
			conditional += 1
			writer.WriteHeader( http.StatusNotModified )
			return
		}
		writer.Header().Set( "ETag" , `"v1"` )
		json.NewEncoder( writer ).Encode( serving )
	} ) )
	defer server.Close()

	library := newTestLibrary( t , two , server )
	changed , err := library.Refresh( context.Background() )
	if err != nil || changed == false || library.Current().Count() != 3 {
		t.Fatalf( "first refresh: changed %v err %v count %d" , changed , err , library.Current().Count() )
	}
	if _ , err := os.Stat( library.file ); err != nil { t.Fatal( "download was not saved" ) }

	changed , err = library.Refresh( context.Background() )
	if err != nil || changed || conditional != 1 {
		t.Fatalf( "second refresh: changed %v err %v conditional %d" , changed , err , conditional )
	}

	// A restart prefers the saved download over the shorter embedded list.
	again , err := New( encode( t , two ) , library.file , server.URL )
	if err != nil || again.Current().Count() != 3 || again.Source != library.file {
		t.Fatalf( "restart: err %v count %d source %s" , err , again.Current().Count() , again.Source )
	}

	// A shorter download is refused and the loaded list stays.
	os.Remove( library.etagFile )
	serving = two
	if _ , err = library.Refresh( context.Background() ); err == nil {
		t.Fatal( "a shrinking download was accepted" )
	}
	if library.Current().Count() != 3 { t.Fatal( "the loaded list changed" ) }
}

func TestRefreshRequiresHTTPS( t *testing.T ) {
	library , err := New( encode( t , []rawPuzzle{ board( 1 , "2023-06-12" , 0 ) } ) , filepath.Join( t.TempDir() , "c.json" ) , "http://example.com/c.json" )
	if err != nil { t.Fatal( err ) }
	if _ , err = library.Refresh( context.Background() ); err == nil { t.Fatal( "plain http was allowed" ) }
}
