package api

import "context"

func (h *Handlers) ListDevices(ctx context.Context, req ListDevicesRequestObject) (ListDevicesResponseObject, error) {
	c := callerOf(ctx)
	after, err := cursorOf(req.Params.PageToken, "devices", c.UserID)
	if err != nil {
		return nil, err
	}
	stored, next, err := h.bus.Devices(ctx, c.UserID, after, h.devicesPage.of(req.Params.PageSize))
	if err != nil {
		return nil, err
	}
	devices := make([]Device, len(stored))
	for i, d := range stored {
		devices[i] = Device{Id: d.ID, Name: d.Name, CreatedAt: d.CreatedAt.UTC(), Current: d.ID == c.DeviceID}
	}
	return ListDevices200JSONResponse{Devices: devices, NextPageToken: nextToken(next, "devices", c.UserID)}, nil
}

func (h *Handlers) DeleteDevice(ctx context.Context, req DeleteDeviceRequestObject) (DeleteDeviceResponseObject, error) {
	if err := h.bus.RevokeDevice(ctx, callerOf(ctx).UserID, req.DeviceId); err != nil {
		return nil, err
	}
	return DeleteDevice204Response{}, nil
}
