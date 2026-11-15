package api

import (
	"context"
	"time"

	"github.com/KOCEAN33/savetab/apps/server/internal/bus"
)

func (h *Handlers) PushOps(ctx context.Context, req PushOpsRequestObject) (PushOpsResponseObject, error) {
	ops := make([]bus.NewOp, len(req.Body.Ops))
	for i, op := range req.Body.Ops {
		ops[i] = bus.NewOp{ID: op.Id, Ciphertext: op.Data}
	}
	if err := h.bus.PushOps(ctx, callerOf(ctx), ops); err != nil {
		return nil, err
	}
	return PushOps200JSONResponse{ServerTime: time.Now().UTC()}, nil
}

func (h *Handlers) ListOps(ctx context.Context, req ListOpsRequestObject) (ListOpsResponseObject, error) {
	var after int64
	if req.Params.After != nil {
		after = *req.Params.After
	}
	stored, more, err := h.bus.PullOps(ctx, callerOf(ctx).UserID, after, h.opsPage.of(req.Params.PageSize))
	if err != nil {
		return nil, err
	}
	ops := make([]Op, len(stored))
	for i, op := range stored {
		ops[i] = Op{Seq: op.Seq, Id: op.ID, DeviceId: op.DeviceID, Data: op.Ciphertext, ReceivedAt: op.ReceivedAt.UTC()}
	}
	return ListOps200JSONResponse{Ops: ops, More: more, ServerTime: time.Now().UTC()}, nil
}
