package api

import (
	"errors"
	"net/http"

	"github.com/KOCEAN33/savetab/apps/server/internal/db"
)

type keyBody struct {
	Data []byte `json:"data"`
}

func (s *server) getKey(w http.ResponseWriter, r *http.Request, c db.Caller) {
	wrapped, err := s.store.Key(r.Context(), c.UserID)
	if errors.Is(err, db.ErrNotFound) {
		writeError(w, http.StatusNotFound, "no_key")
		return
	}
	if err != nil {
		internalError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, keyBody{Data: wrapped})
}

func (s *server) putKey(w http.ResponseWriter, r *http.Request, c db.Caller) {
	var body keyBody
	if !readJSON(w, r, smallBodyBytes, &body) {
		return
	}
	if len(body.Data) == 0 || len(body.Data) > maxMessageBytes {
		writeError(w, http.StatusBadRequest, "bad_request")
		return
	}
	err := s.store.PutKey(r.Context(), c.UserID, body.Data)
	if errors.Is(err, db.ErrKeyExists) {
		writeError(w, http.StatusConflict, "key_exists")
		return
	}
	if err != nil {
		internalError(w, r, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
