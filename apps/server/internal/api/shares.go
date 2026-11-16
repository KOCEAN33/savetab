package api

import (
	"context"
	"strings"
)

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

// ViewShare answers the viewer page. It reads no share: the page's script does, with the key
// only the browser holds.
func (h *Handlers) ViewShare(context.Context, ViewShareRequestObject) (ViewShareResponseObject, error) {
	return ViewShare200TexthtmlResponse{
		Body:          strings.NewReader(viewerPage),
		ContentLength: int64(len(viewerPage)),
		Headers: ViewShare200ResponseHeaders{
			ContentSecurityPolicy: viewerCSP, ReferrerPolicy: "no-referrer", XRobotsTag: "noindex",
		},
	}, nil
}

func (h *Handlers) DeleteShare(ctx context.Context, req DeleteShareRequestObject) (DeleteShareResponseObject, error) {
	if err := h.bus.DeleteShare(ctx, callerOf(ctx).UserID, req.ShareId); err != nil {
		return nil, err
	}
	return DeleteShare204Response{}, nil
}
