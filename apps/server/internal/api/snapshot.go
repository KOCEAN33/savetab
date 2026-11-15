package api

import (
	"net/http"

	"github.com/KOCEAN33/savetab/apps/server/internal/bus"
	"github.com/KOCEAN33/savetab/apps/server/internal/db"
	"github.com/KOCEAN33/savetab/apps/server/internal/platform/errs"
)

type snapshotBody struct {
	Seq  int64  `json:"seq"`
	Data []byte `json:"data"`
}

func (s *server) getSnapshot(w http.ResponseWriter, r *http.Request, c db.Caller) {
	snap, err := s.bus.Snapshot(r.Context(), c.UserID)
	if errs.KindOf(err) == errs.NotFound {
		writeError(w, http.StatusNotFound, "no_snapshot")
		return
	}
	if err != nil {
		internalError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, snapshotBody{Seq: snap.Seq, Data: snap.Ciphertext})
}

func (s *server) putSnapshot(w http.ResponseWriter, r *http.Request, c db.Caller) {
	var body snapshotBody
	if !readJSON(w, r, maxSnapshotBytes, &body) {
		return
	}
	if body.Seq < 1 || len(body.Data) == 0 {
		writeError(w, http.StatusBadRequest, "bad_request")
		return
	}
	err := s.bus.PutSnapshot(r.Context(), c.UserID, bus.Snapshot{Seq: body.Seq, Ciphertext: body.Data})
	switch {
	case errs.KindOf(err) == errs.Invalid:
		writeError(w, http.StatusConflict, "snapshot_ahead")
	case errs.KindOf(err) == errs.Conflict:
		writeError(w, http.StatusConflict, "stale_snapshot")
	case err != nil:
		internalError(w, r, err)
	default:
		w.WriteHeader(http.StatusNoContent)
	}
}
