// Command savetab-server serves the savetab sync API.
package main

import (
	"os"

	"github.com/KOCEAN33/savetab/apps/server/internal/wire"
)

// Set at link time by the Dockerfile.
var (
	version = "dev"
	commit  = "unknown"
)

func main() { os.Exit(wire.Main(version, commit)) }
