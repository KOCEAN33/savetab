package api

import (
	"net/http"

	"github.com/KOCEAN33/savetab/apps/server/internal/bus"
	"github.com/KOCEAN33/savetab/apps/server/internal/platform/errs"
)

type keyBody struct {
	Data []byte `json:"data"`
}

func (s *server) getKey(w http.ResponseWriter, r *http.Request, c bus.Caller) {
	wrapped, err := s.bus.Key(r.Context(), c.UserID)
	if errs.KindOf(err) == errs.NotFound {
		writeError(w, http.StatusNotFound, "no_key")
		return
	}
	if err != nil {
		internalError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, keyBody{Data: wrapped})
}

func (s *server) putKey(w http.ResponseWriter, r *http.Request, c bus.Caller) {
	var body keyBody
	if !readJSON(w, r, smallBodyBytes, &body) {
		return
	}
	if len(body.Data) == 0 || len(body.Data) > maxMessageBytes {
		writeError(w, http.StatusBadRequest, "bad_request")
		return
	}
	err := s.bus.PutKey(r.Context(), c.UserID, body.Data)
	if errs.KindOf(err) == errs.Conflict {
		writeError(w, http.StatusConflict, "key_exists")
		return
	}
	if err != nil {
		internalError(w, r, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
