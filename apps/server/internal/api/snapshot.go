package api

import (
	"errors"
	"net/http"

	"github.com/KOCEAN33/savetab/apps/server/internal/db"
)

type snapshotBody struct {
	Seq  int64  `json:"seq"`
	Data []byte `json:"data"`
}

func (s *server) getSnapshot(w http.ResponseWriter, r *http.Request, c db.Caller) {
	snap, err := s.store.Snapshot(r.Context(), c.UserID)
	if errors.Is(err, db.ErrNotFound) {
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
	err := s.store.PutSnapshot(r.Context(), c.UserID, db.Snapshot{Seq: body.Seq, Ciphertext: body.Data})
	switch {
	case errors.Is(err, db.ErrSnapshotAhead):
		writeError(w, http.StatusConflict, "snapshot_ahead")
	case errors.Is(err, db.ErrStaleSnapshot):
		writeError(w, http.StatusConflict, "stale_snapshot")
	case err != nil:
		internalError(w, r, err)
	default:
		w.WriteHeader(http.StatusNoContent)
	}
}
