package api

import (
	"errors"
	"net/http"

	"github.com/KOCEAN33/savetab/apps/server/internal/store"
)

type deviceBody struct {
	ID        string `json:"id"`
	Name      string `json:"name"`
	CreatedAt int64  `json:"createdAt"`
	Current   bool   `json:"current"`
}

func (s *server) listDevices(w http.ResponseWriter, r *http.Request, c store.Caller) {
	stored, err := s.store.Devices(r.Context(), c.UserID)
	if err != nil {
		internalError(w, r, err)
		return
	}
	devices := make([]deviceBody, len(stored))
	for i, d := range stored {
		devices[i] = deviceBody{ID: d.ID, Name: d.Name, CreatedAt: d.CreatedAt.UnixMilli(), Current: d.ID == c.DeviceID}
	}
	writeJSON(w, http.StatusOK, map[string]any{"devices": devices})
}

func (s *server) revokeDevice(w http.ResponseWriter, r *http.Request, c store.Caller) {
	id := r.PathValue("id")
	if !uuidPattern.MatchString(id) {
		writeError(w, http.StatusNotFound, "not_found")
		return
	}
	err := s.store.RevokeDevice(r.Context(), c.UserID, id)
	switch {
	case errors.Is(err, store.ErrNotFound):
		writeError(w, http.StatusNotFound, "not_found")
	case err != nil:
		internalError(w, r, err)
	default:
		w.WriteHeader(http.StatusNoContent)
	}
}
