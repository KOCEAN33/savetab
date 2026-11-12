// Package api is the server's HTTP surface. The plan's "HTTP API" section is its contract.
package api

import (
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/KOCEAN33/savetab/apps/server/internal/store"
)

const (
	maxOpsPerRequest = 500
	maxBodyBytes     = 8 << 20
)

var uuidPattern = regexp.MustCompile(`^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$`)

type server struct {
	store *store.Store
}

func New(s *store.Store) http.Handler {
	srv := &server{store: s}
	mux := http.NewServeMux()
	mux.HandleFunc("GET /healthz", srv.health)
	mux.HandleFunc("POST /v1/ops", srv.authed(srv.pushOps))
	mux.HandleFunc("GET /v1/ops", srv.authed(srv.pullOps))
	return mux
}

func writeJSON(w http.ResponseWriter, status int, body any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	if err := json.NewEncoder(w).Encode(body); err != nil {
		slog.Warn("write response", "err", err)
	}
}

func writeError(w http.ResponseWriter, status int, code string) {
	writeJSON(w, status, map[string]string{"error": code})
}

func internalError(w http.ResponseWriter, r *http.Request, err error) {
	slog.Error("request failed", "method", r.Method, "path", r.URL.Path, "err", err)
	writeError(w, http.StatusInternalServerError, "internal")
}

func (s *server) health(w http.ResponseWriter, r *http.Request) {
	if err := s.store.Ping(r.Context()); err != nil {
		internalError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func (s *server) authed(next func(http.ResponseWriter, *http.Request, store.Caller)) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		token, ok := strings.CutPrefix(r.Header.Get("Authorization"), "Bearer ")
		if !ok || token == "" {
			writeError(w, http.StatusUnauthorized, "unauthorized")
			return
		}
		caller, err := s.store.Authenticate(r.Context(), token)
		if errors.Is(err, store.ErrNoSession) {
			writeError(w, http.StatusUnauthorized, "unauthorized")
			return
		}
		if err != nil {
			internalError(w, r, err)
			return
		}
		next(w, r, caller)
	}
}

type pushedOp struct {
	ID   string `json:"id"`
	Data []byte `json:"data"`
}

func (s *server) pushOps(w http.ResponseWriter, r *http.Request, c store.Caller) {
	var body struct {
		Ops []pushedOp `json:"ops"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, maxBodyBytes)).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "bad_request")
		return
	}
	if len(body.Ops) > maxOpsPerRequest {
		writeError(w, http.StatusBadRequest, "too_many_ops")
		return
	}
	ops := make([]store.NewOp, len(body.Ops))
	for i, op := range body.Ops {
		if !uuidPattern.MatchString(op.ID) || len(op.Data) == 0 {
			writeError(w, http.StatusBadRequest, "bad_request")
			return
		}
		ops[i] = store.NewOp{ID: op.ID, Ciphertext: op.Data}
	}
	if err := s.store.AppendOps(r.Context(), c, ops); err != nil {
		internalError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]int64{"serverTime": time.Now().UnixMilli()})
}

type pulledOp struct {
	Seq        int64  `json:"seq"`
	ID         string `json:"id"`
	DeviceID   string `json:"deviceId"`
	Data       []byte `json:"data"`
	ReceivedAt int64  `json:"receivedAt"`
}

func (s *server) pullOps(w http.ResponseWriter, r *http.Request, c store.Caller) {
	q := r.URL.Query()
	after, limit := int64(0), maxOpsPerRequest
	var err error
	if v := q.Get("after"); v != "" {
		if after, err = strconv.ParseInt(v, 10, 64); err != nil || after < 0 {
			writeError(w, http.StatusBadRequest, "bad_request")
			return
		}
	}
	if v := q.Get("limit"); v != "" {
		if limit, err = strconv.Atoi(v); err != nil || limit < 1 || limit > maxOpsPerRequest {
			writeError(w, http.StatusBadRequest, "bad_request")
			return
		}
	}
	stored, more, err := s.store.OpsAfter(r.Context(), c.UserID, after, limit)
	if err != nil {
		internalError(w, r, err)
		return
	}
	ops := make([]pulledOp, len(stored))
	for i, op := range stored {
		ops[i] = pulledOp{Seq: op.Seq, ID: op.ID, DeviceID: op.DeviceID, Data: op.Ciphertext, ReceivedAt: op.ReceivedAt.UnixMilli()}
	}
	writeJSON(w, http.StatusOK, map[string]any{"ops": ops, "more": more, "serverTime": time.Now().UnixMilli()})
}
