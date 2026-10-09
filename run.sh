#!/usr/bin/env bash
# Run the app. Rebuilds dist/connections first, but only when something that goes
# into it has changed -- Go code, go.mod/go.sum, static/, language.yaml --
# otherwise it starts straight away. If an older copy of this server already
# holds the port (a previous ./run.sh, or `go run .`), it is stopped first, so
# ./run.sh is also how you restart.
#
#   ./run.sh               build if needed, then run the server
#   ./run.sh manage ...    the same binary's admin commands
#   ./run.sh version
#   FORCE=1 ./run.sh       rebuild even if nothing changed
#
# For local use: SECURE_COOKIES defaults to false here so logging in works
# over plain http://localhost. Set SECURE_COOKIES=true behind HTTPS.
set -euo pipefail
cd "$( dirname "${BASH_SOURCE[0]}" )"

BIN="dist/connections"
STAMP="dist/.connections.stamp"

# Go is not always on PATH.
GO="$( command -v go || true )"
if [ -z "$GO" ] && [ -x /usr/local/go/bin/go ]; then GO=/usr/local/go/bin/go; fi
if [ -z "$GO" ]; then
  echo "Go is not installed (looked on PATH and in /usr/local/go/bin)." >&2
  exit 1
fi
export GOTOOLCHAIN="${GOTOOLCHAIN:-local}"

if command -v sha256sum >/dev/null 2>&1; then SUM="sha256sum"; else SUM="shasum -a 256"; fi

VERSION="$( git describe --tags --always 2>/dev/null || echo "dev" )"
COMMIT="$( git rev-parse --short HEAD 2>/dev/null || echo "unknown" )"

# Every file the binary is built from (the frontend and language.yaml are
# compiled in), plus the Go and app versions. If none of it changed since the
# last build, there is nothing to rebuild.
inputs() {
  {
    find . \( -path ./dist -o -path ./.git -o -path ./guide -o -path ./data \) -prune -o \
      -type f \( -name '*.go' -o -name 'go.mod' -o -name 'go.sum' \) -print
    find ./static -type f -print
    echo ./language.yaml
    echo ./connections.json
  } | LC_ALL=C sort
}

fingerprint() {
  {
    "$GO" version
    echo "$VERSION $COMMIT"
    inputs | tr '\n' '\0' | xargs -0 $SUM
  } | $SUM | cut -d' ' -f1
}

NOW="$( fingerprint )"
if [ "${FORCE:-}" = "1" ] || [ ! -x "$BIN" ] || [ "$( cat "$STAMP" 2>/dev/null )" != "$NOW" ]; then
  echo "Building $BIN ($VERSION)..."
  mkdir -p dist
  CGO_ENABLED=0 "$GO" build -trimpath \
    -ldflags "-s -w -X main.version=$VERSION -X main.commit=$COMMIT -X main.buildDate=$( date -u +%Y-%m-%dT%H:%M:%SZ )" \
    -o "$BIN.tmp" .
  mv "$BIN.tmp" "$BIN"
  echo "$NOW" > "$STAMP"
else
  echo "$BIN is up to date."
fi

# Anything other than plain "run the server" (manage, version) needs no port.
if [ $# -gt 0 ]; then
  exec "./$BIN" "$@"
fi

# The port: PORT, else config.yaml's, else 8081.
if [ -z "${PORT:-}" ]; then
  CONFIG="${APP_DIR:-${XDG_CONFIG_HOME:-$HOME/.config}/connections}/config.yaml"
  PORT="$( sed -n 's/^port:[[:space:]]*\([0-9][0-9]*\).*/\1/p' "$CONFIG" 2>/dev/null | head -n 1 || true )"
  PORT="${PORT:-8081}"
fi
export PORT
export SECURE_COOKIES="${SECURE_COOKIES:-false}"

listener() {
  if command -v ss >/dev/null 2>&1; then
    ss -Hltnp "sport = :$PORT" 2>/dev/null | sed -n 's/.*pid=\([0-9][0-9]*\).*/\1/p' | head -n 1 || true
  elif command -v lsof >/dev/null 2>&1; then
    lsof -t -iTCP:"$PORT" -sTCP:LISTEN 2>/dev/null | head -n 1 || true
  fi
}

PID="$( listener )"
if [ -n "$PID" ]; then
  COMMAND="$( ps -o args= -p "$PID" 2>/dev/null || true )"
  case "$COMMAND" in
    *connections*)
      echo "Stopping the server already on :$PORT (pid $PID)."
      PARENT="$( ps -o ppid= -p "$PID" 2>/dev/null | tr -d ' ' || true )"
      kill "$PID" 2>/dev/null || true
      # `go run .` sits above the server it built; stop that too.
      if [ -n "$PARENT" ] && ps -o args= -p "$PARENT" 2>/dev/null | grep -q "go run"; then
        kill "$PARENT" 2>/dev/null || true
      fi
      for _ in $( seq 50 ); do
        kill -0 "$PID" 2>/dev/null || break
        sleep 0.1
      done
      if kill -0 "$PID" 2>/dev/null; then kill -9 "$PID" 2>/dev/null || true; fi
      sleep 0.3
      # Starting while the old one lives would just sit waiting for its
      # database lock, so say so instead.
      if [ -n "$( listener )" ]; then
        echo "Could not stop pid $PID (no permission from this shell?)." >&2
        echo "Stop it yourself (Ctrl+C in its terminal, or: kill $PID), then run ./run.sh again." >&2
        exit 1
      fi
      ;;
    *)
      echo "Port $PORT is taken by something else: $COMMAND" >&2
      echo "Stop it, or pick another port: PORT=8082 ./run.sh" >&2
      exit 1
      ;;
  esac
fi

echo "Starting on http://localhost:$PORT"
exec "./$BIN"
