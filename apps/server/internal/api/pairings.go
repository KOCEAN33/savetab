package api

import (
	"crypto/sha256"
	"net/http"

	"github.com/KOCEAN33/savetab/apps/server/internal/bus"
	"github.com/KOCEAN33/savetab/apps/server/internal/db"
	"github.com/KOCEAN33/savetab/apps/server/internal/platform/errs"
)

type pairingBody struct {
	ID            string `json:"id"`
	NewDeviceID   string `json:"newDeviceId"`
	NewDeviceName string `json:"newDeviceName"`
	Commitment    []byte `json:"commitment"`
	OldPublic     []byte `json:"oldPublic,omitempty"`
	NewPublic     []byte `json:"newPublic,omitempty"`
	WrappedKey    []byte `json:"wrappedKey,omitempty"`
	ExpiresAt     int64  `json:"expiresAt"`
}

func pairingView(p bus.Pairing) pairingBody {
	return pairingBody{
		ID: p.ID, NewDeviceID: p.NewDeviceID, NewDeviceName: p.NewDeviceName,
		Commitment: p.Commitment, OldPublic: p.OldPublic, NewPublic: p.NewPublic, WrappedKey: p.WrappedKey,
		ExpiresAt: p.ExpiresAt.UnixMilli(),
	}
}

func (s *server) startPairing(w http.ResponseWriter, r *http.Request, c db.Caller) {
	var body struct {
		Commitment []byte `json:"commitment"`
	}
	if !readJSON(w, r, smallBodyBytes, &body) {
		return
	}
	if len(body.Commitment) != sha256.Size {
		writeError(w, http.StatusBadRequest, "bad_request")
		return
	}
	p, err := s.bus.StartPairing(r.Context(), bus.Caller(c), body.Commitment)
	if err != nil {
		internalError(w, r, err)
		return
	}
	writeJSON(w, http.StatusCreated, pairingView(p))
}

func (s *server) listPairings(w http.ResponseWriter, r *http.Request, c db.Caller) {
	stored, err := s.bus.Pairings(r.Context(), c.UserID)
	if err != nil {
		internalError(w, r, err)
		return
	}
	pairings := make([]pairingBody, len(stored))
	for i, p := range stored {
		pairings[i] = pairingView(p)
	}
	writeJSON(w, http.StatusOK, map[string]any{"pairings": pairings})
}

func (s *server) getPairing(w http.ResponseWriter, r *http.Request, c db.Caller) {
	id := r.PathValue("id")
	if !uuidPattern.MatchString(id) {
		writeError(w, http.StatusNotFound, "not_found")
		return
	}
	p, err := s.bus.Pairing(r.Context(), c.UserID, id)
	if errs.KindOf(err) == errs.NotFound {
		writeError(w, http.StatusNotFound, "not_found")
		return
	}
	if err != nil {
		internalError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, pairingView(p))
}

func (s *server) putPairing(w http.ResponseWriter, r *http.Request, c db.Caller) {
	id := r.PathValue("id")
	if !uuidPattern.MatchString(id) {
		writeError(w, http.StatusNotFound, "not_found")
		return
	}
	var body struct {
		OldPublic  []byte `json:"oldPublic"`
		NewPublic  []byte `json:"newPublic"`
		WrappedKey []byte `json:"wrappedKey"`
	}
	if !readJSON(w, r, smallBodyBytes, &body) {
		return
	}
	var message bus.PairingMessage
	var value []byte
	sent := 0
	for m, v := range map[bus.PairingMessage][]byte{
		bus.OldPublic: body.OldPublic, bus.NewPublic: body.NewPublic, bus.WrappedKey: body.WrappedKey,
	} {
		if len(v) > 0 {
			message, value = m, v
			sent++
		}
	}
	if sent != 1 || len(value) > maxMessageBytes {
		writeError(w, http.StatusBadRequest, "bad_request")
		return
	}
	err := s.bus.SetPairingMessage(r.Context(), bus.Caller(c), id, message, value)
	switch {
	case errs.KindOf(err) == errs.NotFound:
		writeError(w, http.StatusNotFound, "not_found")
	case errs.KindOf(err) == errs.Forbidden:
		writeError(w, http.StatusForbidden, "forbidden")
	case errs.KindOf(err) == errs.Conflict:
		writeError(w, http.StatusConflict, "pairing_conflict")
	case err != nil:
		internalError(w, r, err)
	default:
		w.WriteHeader(http.StatusNoContent)
	}
}
