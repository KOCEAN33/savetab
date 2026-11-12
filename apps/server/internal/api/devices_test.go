package api_test

import (
	"net/http"
	"testing"
	"time"
)

type listedDevice struct {
	ID        string `json:"id"`
	Name      string `json:"name"`
	CreatedAt int64  `json:"createdAt"`
	Current   bool   `json:"current"`
}

type deviceList struct {
	Devices []listedDevice `json:"devices"`
}

func listDevices(t *testing.T, d device) []listedDevice {
	t.Helper()
	res := request(t, "GET", "/v1/devices", d.token, nil)
	if res.StatusCode != http.StatusOK {
		t.Fatalf("list devices: status %d, want 200", res.StatusCode)
	}
	return decode[deviceList](t, res).Devices
}

func revokeDevice(t *testing.T, d device, id string) *http.Response {
	t.Helper()
	return request(t, "DELETE", "/v1/devices/"+id, d.token, nil)
}

func TestDevicesListsTheUsersDevicesOldestFirst(t *testing.T) {
	subject := "gina-" + randomString(t)
	before := time.Now()
	desktop := logIn(t, subject, "desktop")
	phone := logIn(t, subject, "phone")
	after := time.Now()
	logIn(t, "hank-"+randomString(t), "stranger's laptop")

	got := listDevices(t, phone.device())
	want := []listedDevice{
		{ID: desktop.DeviceID, Name: "desktop", Current: false},
		{ID: phone.DeviceID, Name: "phone", Current: true},
	}
	if len(got) != len(want) {
		t.Fatalf("devices = %+v, want %+v", got, want)
	}
	// The database stamps the time, so allow for its clock differing from this machine's.
	low, high := before.Add(-5*time.Second).UnixMilli(), after.Add(5*time.Second).UnixMilli()
	for i, d := range got {
		if d.ID != want[i].ID || d.Name != want[i].Name || d.Current != want[i].Current {
			t.Errorf("device %d = %+v, want %+v", i, d, want[i])
		}
		if d.CreatedAt < low || d.CreatedAt > high {
			t.Errorf("device %d createdAt %d, want within [%d, %d]", i, d.CreatedAt, low, high)
		}
	}
	if current := listDevices(t, desktop.device()); len(current) != 2 || !current[0].Current || current[1].Current {
		t.Errorf("listed by the desktop: %+v, want only the desktop current", current)
	}
}

func TestRevokingAnotherDeviceEndsItsTokens(t *testing.T) {
	subject := "ivy-" + randomString(t)
	desktop, phone := logIn(t, subject, "desktop"), logIn(t, subject, "phone")

	expect(t, "revoke the phone", revokeDevice(t, desktop.device(), phone.DeviceID), http.StatusNoContent, "")
	expect(t, "the phone's access token", request(t, "GET", "/v1/ops", phone.AccessToken, nil), http.StatusUnauthorized, "unauthorized")
	expect(t, "the phone's refresh token", refresh(t, phone.RefreshToken), http.StatusUnauthorized, "unauthorized")
	if got := listDevices(t, desktop.device()); len(got) != 1 || got[0].ID != desktop.DeviceID {
		t.Errorf("devices after the revoke = %+v, want only the desktop %s", got, desktop.DeviceID)
	}
	expect(t, "the desktop's access token", request(t, "GET", "/v1/ops", desktop.AccessToken, nil), http.StatusOK, "")
}

func TestADeviceRevokesItselfToSignOut(t *testing.T) {
	got := logIn(t, "jack-"+randomString(t), "desktop")

	expect(t, "revoke itself", revokeDevice(t, got.device(), got.DeviceID), http.StatusNoContent, "")
	expect(t, "the same access token", request(t, "GET", "/v1/devices", got.AccessToken, nil), http.StatusUnauthorized, "unauthorized")
	expect(t, "its refresh token", refresh(t, got.RefreshToken), http.StatusUnauthorized, "unauthorized")
}

func TestRevokingADeviceOutsideTheUsersLiveDevicesGets404(t *testing.T) {
	subject := "kate-" + randomString(t)
	desktop, phone := logIn(t, subject, "desktop"), logIn(t, subject, "phone")
	stranger := logIn(t, "leo-"+randomString(t), "desktop")

	expect(t, "another user's device", revokeDevice(t, desktop.device(), stranger.DeviceID), http.StatusNotFound, "not_found")
	expect(t, "the other user's device still works", request(t, "GET", "/v1/ops", stranger.AccessToken, nil), http.StatusOK, "")
	expect(t, "an unknown uuid", revokeDevice(t, desktop.device(), opID(1)), http.StatusNotFound, "not_found")
	expect(t, "not a uuid", revokeDevice(t, desktop.device(), "nope"), http.StatusNotFound, "not_found")
	expect(t, "first revoke", revokeDevice(t, desktop.device(), phone.DeviceID), http.StatusNoContent, "")
	expect(t, "second revoke", revokeDevice(t, desktop.device(), phone.DeviceID), http.StatusNotFound, "not_found")
}
