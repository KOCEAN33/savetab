package api

import (
	"context"

	"github.com/KOCEAN33/savetab/apps/server/internal/platform/errs"
)

func (h *Handlers) GetKey(ctx context.Context, _ GetKeyRequestObject) (GetKeyResponseObject, error) {
	wrapped, err := h.bus.Key(ctx, callerOf(ctx).UserID)
	if err != nil {
		return nil, err
	}
	return GetKey200JSONResponse{Data: wrapped}, nil
}

func (h *Handlers) PutKey(ctx context.Context, req PutKeyRequestObject) (PutKeyResponseObject, error) {
	// The contract bounds the base64 text, which can hold two bytes more.
	if len(req.Body.Data) > maxMessageBytes {
		return nil, errs.New(errs.Invalid, "put key", "data is over 1024 bytes")
	}
	if err := h.bus.PutKey(ctx, callerOf(ctx).UserID, req.Body.Data); err != nil {
		return nil, err
	}
	return PutKey204Response{}, nil
}
