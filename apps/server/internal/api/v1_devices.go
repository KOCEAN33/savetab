package api

import (
	"net/http"

	"github.com/KOCEAN33/savetab/apps/server/internal/bus"
	"github.com/KOCEAN33/savetab/apps/server/internal/platform/errs"
	"github.com/google/uuid"
)

type deviceBody struct {
	ID        uuid.UUID `json:"id"`
	Name      string    `json:"name"`
	CreatedAt int64     `json:"createdAt"`
	Current   bool      `json:"current"`
}

func (s *server) listDevices(w http.ResponseWriter, r *http.Request, c bus.Caller) {
	// /v1 answers the whole list, so it reads every page.
	devices := []deviceBody{}
	for after := (&bus.Cursor{}); after != nil; {
		stored, next, err := s.bus.Devices(r.Context(), c.UserID, *after, v1PageRows)
		if err != nil {
			internalError(w, r, err)
			return
		}
		for _, d := range stored {
			devices = append(devices, deviceBody{ID: d.ID, Name: d.Name, CreatedAt: d.CreatedAt.UnixMilli(), Current: d.ID == c.DeviceID})
		}
		after = next
	}
	writeJSON(w, http.StatusOK, map[string]any{"devices": devices})
}

func (s *server) revokeDevice(w http.ResponseWriter, r *http.Request, c bus.Caller) {
	id, ok := parseID(r.PathValue("id"))
	if !ok {
		writeError(w, http.StatusNotFound, "not_found")
		return
	}
	err := s.bus.RevokeDevice(r.Context(), c.UserID, id)
	switch {
	case errs.KindOf(err) == errs.NotFound:
		writeError(w, http.StatusNotFound, "not_found")
	case err != nil:
		internalError(w, r, err)
	default:
		w.WriteHeader(http.StatusNoContent)
	}
}
