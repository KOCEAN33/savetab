//go:build ignore

package main

import (
	"context"
	"net"
	"net/http"

	"github.com/gin-gonic/gin"
)

type runner struct{}

func (runner) Run(context.Context) error { return nil }

func main() {
	srv := &http.Server{}
	engine := gin.New()
	var l net.Listener
	// ruleid: serve-through-wire
	http.ListenAndServe(":8080", nil)
	// ruleid: serve-through-wire
	srv.ListenAndServe()
	// ruleid: serve-through-wire
	engine.Run(":8080")
	// ruleid: serve-through-wire
	engine.RunListener(l)
	// ok: serve-through-wire
	srv.Serve(l)
	// ok: serve-through-wire
	runner{}.Run(context.Background())
}
