package api

import (
	"context"
	"crypto/sha256"

	"github.com/KOCEAN33/savetab/apps/server/internal/bus"
	"github.com/KOCEAN33/savetab/apps/server/internal/platform/errs"
)

func pairingOf(p bus.Pairing) Pairing {
	out := Pairing{
		Id: p.ID, NewDeviceId: p.NewDeviceID, NewDeviceName: p.NewDeviceName,
		Commitment: p.Commitment, ExpiresAt: p.ExpiresAt.UTC(),
	}
	// A message not yet sent is absent, never an empty string.
	if len(p.OldPublic) > 0 {
		out.OldPublic = &p.OldPublic
	}
	if len(p.NewPublic) > 0 {
		out.NewPublic = &p.NewPublic
	}
	if len(p.WrappedKey) > 0 {
		out.WrappedKey = &p.WrappedKey
	}
	return out
}

func (h *Handlers) CreatePairing(ctx context.Context, req CreatePairingRequestObject) (CreatePairingResponseObject, error) {
	// The contract bounds the base64 text, which 31 and 33 bytes also fit.
	if len(req.Body.Commitment) != sha256.Size {
		return nil, errs.New(errs.Invalid, "create pairing", "commitment is not 32 bytes")
	}
	p, err := h.bus.StartPairing(ctx, callerOf(ctx), req.Body.Id, req.Body.Commitment)
	if err != nil {
		return nil, err
	}
	return CreatePairing201JSONResponse(pairingOf(p)), nil
}

func (h *Handlers) ListPairings(ctx context.Context, req ListPairingsRequestObject) (ListPairingsResponseObject, error) {
	c := callerOf(ctx)
	after, err := cursorOf(req.Params.PageToken, "pairings", c.UserID)
	if err != nil {
		return nil, err
	}
	stored, next, err := h.bus.Pairings(ctx, c.UserID, after, h.pairingsPage.of(req.Params.PageSize))
	if err != nil {
		return nil, err
	}
	pairings := make([]Pairing, len(stored))
	for i, p := range stored {
		pairings[i] = pairingOf(p)
	}
	return ListPairings200JSONResponse{Pairings: pairings, NextPageToken: nextToken(next, "pairings", c.UserID)}, nil
}

func (h *Handlers) GetPairing(ctx context.Context, req GetPairingRequestObject) (GetPairingResponseObject, error) {
	p, err := h.bus.Pairing(ctx, callerOf(ctx).UserID, req.PairingId)
	if err != nil {
		return nil, err
	}
	return GetPairing200JSONResponse(pairingOf(p)), nil
}

func (h *Handlers) PutPairingMessage(ctx context.Context, req PutPairingMessageRequestObject) (PutPairingMessageResponseObject, error) {
	var message bus.PairingMessage
	var value []byte
	switch body := req.Body; {
	case body.OldPublic != nil:
		message, value = bus.OldPublic, *body.OldPublic
	case body.NewPublic != nil:
		message, value = bus.NewPublic, *body.NewPublic
	case body.WrappedKey != nil:
		message, value = bus.WrappedKey, *body.WrappedKey
	}
	// The contract bounds the base64 text, which can hold two bytes more.
	if len(value) == 0 || len(value) > maxMessageBytes {
		return nil, errs.New(errs.Invalid, "put pairing message", "the message is not 1 to 1024 bytes")
	}
	if err := h.bus.SetPairingMessage(ctx, callerOf(ctx), req.PairingId, message, value); err != nil {
		return nil, err
	}
	return PutPairingMessage204Response{}, nil
}
