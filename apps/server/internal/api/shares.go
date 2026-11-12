package api

import (
	_ "embed"
	"errors"
	"log/slog"
	"net/http"

	"github.com/KOCEAN33/savetab/apps/server/internal/store"
)

// The viewer decrypts in the browser with the key from the URL fragment, which never reaches
// the server. The policy keeps any script but its own off the page that holds that key.
const viewerCSP = "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'"

var (
	//go:embed viewer/share.html
	viewerHTML []byte
	//go:embed viewer/share.js
	viewerJS []byte
	//go:embed viewer/share.css
	viewerCSS []byte
)

type shareBody struct {
	ID        string `json:"id,omitempty"`
	Data      []byte `json:"data,omitempty"`
	ExpiresAt int64  `json:"expiresAt"`
}

func (s *server) createShare(w http.ResponseWriter, r *http.Request, c store.Caller) {
	var body struct {
		Data []byte `json:"data"`
	}
	if !readJSON(w, r, maxBodyBytes, &body) {
		return
	}
	if len(body.Data) == 0 {
		writeError(w, http.StatusBadRequest, "bad_request")
		return
	}
	sh, err := s.store.CreateShare(r.Context(), c.UserID, body.Data, shareTTL)
	if err != nil {
		internalError(w, r, err)
		return
	}
	writeJSON(w, http.StatusCreated, shareBody{ID: sh.ID, ExpiresAt: sh.ExpiresAt.UnixMilli()})
}

// getShare takes no token: the share's URL is the only credential, and its key stays in the
// fragment, so the server hands out ciphertext only.
func (s *server) getShare(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if !uuidPattern.MatchString(id) {
		writeError(w, http.StatusNotFound, "not_found")
		return
	}
	sh, err := s.store.Share(r.Context(), id)
	if errors.Is(err, store.ErrNotFound) {
		writeError(w, http.StatusNotFound, "not_found")
		return
	}
	if err != nil {
		internalError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, shareBody{Data: sh.Ciphertext, ExpiresAt: sh.ExpiresAt.UnixMilli()})
}

func (s *server) deleteShare(w http.ResponseWriter, r *http.Request, c store.Caller) {
	id := r.PathValue("id")
	if !uuidPattern.MatchString(id) {
		writeError(w, http.StatusNotFound, "not_found")
		return
	}
	err := s.store.DeleteShare(r.Context(), c.UserID, id)
	switch {
	case errors.Is(err, store.ErrNotFound):
		writeError(w, http.StatusNotFound, "not_found")
	case err != nil:
		internalError(w, r, err)
	default:
		w.WriteHeader(http.StatusNoContent)
	}
}

// viewerFile answers one file of the viewer, the same bytes for every share.
func viewerFile(contentType string, body []byte) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		h := w.Header()
		h.Set("Content-Type", contentType)
		h.Set("Content-Security-Policy", viewerCSP)
		h.Set("Referrer-Policy", "no-referrer")
		h.Set("X-Robots-Tag", "noindex")
		if _, err := w.Write(body); err != nil {
			slog.Warn("write response", "err", err)
		}
	}
}
