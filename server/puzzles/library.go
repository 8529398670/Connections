package puzzles

import (
	bytes "bytes"
	context "context"
	errors "errors"
	fmt "fmt"
	io "io"
	log "log"
	http "net/http"
	url "net/url"
	os "os"
	filepath "path/filepath"
	strings "strings"
	atomic "sync/atomic"
	time "time"
)

const (
	// The archive is about 1.4 MB and grows by roughly 1 KB a day. The cap
	// is headroom for decades, and exists so a misbehaving server cannot
	// make this process read without bound.
	maxDownloadBytes = 20 * 1024 * 1024
	fetchTimeout     = 30 * time.Second
)

// Library is the live list. Current is lock-free: a refresh builds a whole
// new Set and swaps the pointer, so a request never sees half of an update.
type Library struct {
	current  atomic.Pointer[Set]
	file     string
	etagFile string
	url      string
	client   *http.Client

	// Source says where the list loaded at startup came from, for the log.
	// Set once in New and never again, so reading it needs no lock.
	Source string
}

// New picks the better of the embedded list and the downloaded copy in the
// app directory. "Better" is simply "at least as many boards": the archive
// only ever grows, so a shorter file on disk is stale or damaged and the
// embedded copy wins.
func New( embedded []byte , file string , source_url string ) ( library *Library , err error ) {
	builtin , err := Parse( embedded )
	if err != nil {
		err = fmt.Errorf( "embedded connections.json: %w" , err )
		return
	}
	library = &Library{
		file:     file,
		etagFile: file + ".etag",
		url:      source_url,
		client: &http.Client{
			Timeout: fetchTimeout,
			// Following a redirect must not downgrade to plain http.
			CheckRedirect: func( request *http.Request , via []*http.Request ) ( redirect_err error ) {
				if request.URL.Scheme != "https" { redirect_err = errors.New( "refusing a non-https redirect" ) }
				if len( via ) >= 5 { redirect_err = errors.New( "too many redirects" ) }
				return
			},
		},
	}
	library.current.Store( builtin )
	library.Source = "embedded"

	if raw , read_err := os.ReadFile( file ); read_err == nil {
		on_disk , parse_err := Parse( raw )
		switch {
		case parse_err != nil:
			log.Printf( "[puzzles] ignoring %s: %v" , file , parse_err )
		case on_disk.Count() < builtin.Count():
			log.Printf( "[puzzles] ignoring %s: %d puzzles, fewer than the %d built in" , file , on_disk.Count() , builtin.Count() )
		default:
			library.current.Store( on_disk )
			library.Source = file
		}
	}
	return
}

func ( library *Library ) Current() *Set { return library.current.Load() }

// Summary is the one-line description the log uses.
func ( library *Library ) Summary() ( text string ) {
	set := library.Current()
	text = fmt.Sprintf( "%d puzzles, %s to %s" , set.Count() , set.First() , set.Latest() )
	if set.Dropped > 0 { text += fmt.Sprintf( " (%d unplayable skipped)" , set.Dropped ) }
	return
}

// Start refreshes now and then on every tick until stop is closed. A failed
// refresh is logged and otherwise ignored: the list already loaded is still
// a perfectly good list.
func ( library *Library ) Start( every time.Duration ) ( stop chan struct{} ) {
	stop = make( chan struct{} )
	go func() {
		ticker := time.NewTicker( every )
		defer ticker.Stop()
		for {
			if changed , err := library.Refresh( context.Background() ); err != nil {
				log.Printf( "[puzzles] refresh failed: %v" , err )
			} else if changed {
				log.Printf( "[puzzles] updated: %s" , library.Summary() )
			}
			select {
			case <-stop:
				return
			case <-ticker.C:
			}
		}
	}()
	return
}

// Refresh downloads the archive if it changed since the last download, and
// swaps it in when it is valid and no shorter than what is loaded. changed
// reports whether the live list moved.
func ( library *Library ) Refresh( ctx context.Context ) ( changed bool , err error ) {
	parsed , parse_err := url.Parse( library.url )
	if parse_err != nil || parsed.Scheme != "https" {
		err = fmt.Errorf( "puzzles url must be https: %q" , library.url )
		return
	}

	request , err := http.NewRequestWithContext( ctx , http.MethodGet , library.url , nil )
	if err != nil { return }
	// The ETag only means something if the file it describes is still on
	// disk; otherwise a 304 would leave the newer list nowhere.
	if _ , stat_err := os.Stat( library.file ); stat_err == nil {
		if etag , read_err := os.ReadFile( library.etagFile ); read_err == nil {
			request.Header.Set( "If-None-Match" , strings.TrimSpace( string( etag ) ) )
		}
	}

	response , err := library.client.Do( request )
	if err != nil { return }
	defer response.Body.Close()

	if response.StatusCode == http.StatusNotModified { return }
	if response.StatusCode != http.StatusOK {
		err = fmt.Errorf( "%s answered %s" , parsed.Host , response.Status )
		return
	}

	raw , err := io.ReadAll( io.LimitReader( response.Body , maxDownloadBytes + 1 ) )
	if err != nil { return }
	if len( raw ) > maxDownloadBytes {
		err = fmt.Errorf( "download is larger than %d bytes" , maxDownloadBytes )
		return
	}

	next , err := Parse( raw )
	if err != nil { return }
	current := library.Current()
	if next.Count() < current.Count() {
		err = fmt.Errorf( "download has %d puzzles, fewer than the %d loaded; keeping the current list" , next.Count() , current.Count() )
		return
	}

	if err = writeAtomic( library.file , raw ); err != nil { return }
	if etag := response.Header.Get( "ETag" ); etag != "" {
		if write_err := writeAtomic( library.etagFile , []byte( etag + "\n" ) ); write_err != nil {
			log.Printf( "[puzzles] could not save etag: %v" , write_err )
		}
	}

	changed = next.Count() != current.Count() || next.Latest() != current.Latest() || bytes.Equal( next.index , current.index ) == false
	library.current.Store( next )
	return
}

// writeAtomic replaces path in one step, so a crash mid-write leaves the old
// file rather than half of a new one.
func writeAtomic( path string , data []byte ) ( err error ) {
	temp , err := os.CreateTemp( filepath.Dir( path ) , "." + filepath.Base( path ) + ".*" )
	if err != nil { return }
	temp_name := temp.Name()
	defer os.Remove( temp_name )

	if _ , err = temp.Write( data ); err != nil {
		temp.Close()
		return
	}
	if err = temp.Chmod( 0o600 ); err != nil {
		temp.Close()
		return
	}
	if err = temp.Close(); err != nil { return }
	err = os.Rename( temp_name , path )
	return
}
