package api

import (
	"context"

	"github.com/KOCEAN33/savetab/apps/server/internal/bus"
)

func (h *Handlers) GetSnapshot(ctx context.Context, _ GetSnapshotRequestObject) (GetSnapshotResponseObject, error) {
	snap, err := h.bus.Snapshot(ctx, callerOf(ctx).UserID)
	if err != nil {
		return nil, err
	}
	return GetSnapshot200JSONResponse{Seq: snap.Seq, Data: snap.Ciphertext}, nil
}

func (h *Handlers) PutSnapshot(ctx context.Context, req PutSnapshotRequestObject) (PutSnapshotResponseObject, error) {
	err := h.bus.PutSnapshot(ctx, callerOf(ctx).UserID, bus.Snapshot{Seq: req.Body.Seq, Ciphertext: req.Body.Data})
	if err != nil {
		return nil, err
	}
	return PutSnapshot204Response{}, nil
}
