package api

import "context"

func (h *Handlers) CreateShare(ctx context.Context, req CreateShareRequestObject) (CreateShareResponseObject, error) {
	sh, err := h.bus.CreateShare(ctx, callerOf(ctx).UserID, req.Body.Id, req.Body.Data)
	if err != nil {
		return nil, err
	}
	return CreateShare201JSONResponse{Id: sh.ID, ExpiresAt: sh.ExpiresAt.UTC()}, nil
}

// GetShare takes no token: the share's URL is the only credential, and its key stays in the
// fragment, so the server hands out ciphertext only.
func (h *Handlers) GetShare(ctx context.Context, req GetShareRequestObject) (GetShareResponseObject, error) {
	sh, err := h.bus.Share(ctx, req.ShareId)
	if err != nil {
		return nil, err
	}
	return GetShare200JSONResponse{Data: sh.Ciphertext, ExpiresAt: sh.ExpiresAt.UTC()}, nil
}

func (h *Handlers) DeleteShare(ctx context.Context, req DeleteShareRequestObject) (DeleteShareResponseObject, error) {
	if err := h.bus.DeleteShare(ctx, callerOf(ctx).UserID, req.ShareId); err != nil {
		return nil, err
	}
	return DeleteShare204Response{}, nil
}
