// Command savetab-server serves the savetab sync API.
package main

import (
	"context"
	"fmt"
	"os"

	"github.com/caarlos0/env/v11"

	"github.com/KOCEAN33/savetab/apps/server/internal/platform/config"
	"github.com/KOCEAN33/savetab/apps/server/internal/wire"
)

// Set at link time by the Dockerfile.
var (
	version = "dev"
	commit  = "unknown"
)

func main() {
	cfg, err := config.Load(env.Options{})
	if err != nil {
		// The log format is itself configuration, so a bad configuration has no logger yet.
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	// Run's stop line holds its error.
	if wire.Run(context.Background(), cfg, wire.Options{Version: version, Commit: commit}) != nil {
		os.Exit(1)
	}
}
