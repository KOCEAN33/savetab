package wire_test

import (
	"log/slog"
	"regexp"
	"slices"
	"testing"

	"github.com/gin-gonic/gin"

	"github.com/KOCEAN33/savetab/apps/server/internal/api"
	"github.com/KOCEAN33/savetab/apps/server/internal/httpserver"
	"github.com/KOCEAN33/savetab/apps/server/internal/wire"
)

// outsideTheSpec are the engine's routes that api/openapi.yaml does not declare: the probes.
var outsideTheSpec = []string{"GET /livez", "GET /readyz"}

var specParam = regexp.MustCompile(`\{([^}]+)\}`)

func TestRoutesAreTheOperationsOfTheSpec(t *testing.T) {
	t.Parallel()
	srv, err := wire.NewServer(httpserver.Config{}, slog.New(slog.DiscardHandler), nil, nil)
	if err != nil {
		t.Fatal(err)
	}
	var routed []string
	for _, r := range srv.Handler.(*gin.Engine).Routes() {
		if slices.Contains(outsideTheSpec, r.Method+" "+r.Path) {
			continue
		}
		routed = append(routed, r.Method+" "+r.Path)
	}
	spec, err := api.GetSpec()
	if err != nil {
		t.Fatal(err)
	}
	var declared []string
	for path, item := range spec.Paths.Map() {
		for method := range item.Operations() {
			declared = append(declared, method+" "+specParam.ReplaceAllString(path, ":$1"))
		}
	}
	if len(declared) == 0 {
		t.Fatal("the spec declares no operation")
	}
	for _, r := range routed {
		if !slices.Contains(declared, r) {
			t.Errorf("the engine routes %s, which the spec does not declare", r)
		}
	}
	for _, d := range declared {
		if !slices.Contains(routed, d) {
			t.Errorf("the spec declares %s, which the engine does not route", d)
		}
	}
}
