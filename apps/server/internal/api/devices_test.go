package api_test

import (
	"fmt"
	"net/http"
	"net/url"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/KOCEAN33/savetab/apps/server/internal/api"
)

func listDevicePage(t *testing.T, s *server, m member, query string) api.DeviceList {
	t.Helper()
	return readJSON[api.DeviceList](t, must(t, "list devices"+query, call(t, s, "GET", "/v2/devices"+query, m.access, nil), http.StatusOK))
}

// deviceFixture is a user signed in on n devices, in the order they signed in.
func deviceFixture(t *testing.T, s *server, n int) []member {
	t.Helper()
	devices := []member{newMember(t, s)}
	for i := 1; i < n; i++ {
		devices = append(devices, devices[0].another(t, s, fmt.Sprintf("device %d", i)))
	}
	return devices
}

func TestDevicesListsTheUsersDevicesOldestFirstMarkingTheCaller(t *testing.T) {
	t.Parallel()
	s := newServer(t)
	before := time.Now()
	first := newMember(t, s)
	second := first.another(t, s, "phone")
	newMember(t, s)

	got := listDevicePage(t, s, second, "").Devices
	if len(got) != 2 {
		t.Fatalf("listed %+v, want the user's 2 devices", got)
	}
	want := []struct {
		id, name string
		current  bool
	}{{first.device, "first device", false}, {second.device, "phone", true}}
	for i, w := range want {
		g := got[i]
		if g.Id.String() != w.id || g.Name != w.name || g.Current != w.current {
			t.Errorf("device %d = %+v, want id %s name %q current %v", i, g, w.id, w.name, w.current)
		}
		if g.CreatedAt.Before(before.Add(-5*time.Second)) || g.CreatedAt.After(time.Now().Add(5*time.Second)) {
			t.Errorf("device %d created_at %v is not within 5 s of the sign-in", i, g.CreatedAt)
		}
	}
}

func TestDeletingADeviceRevokesItsTokens(t *testing.T) {
	t.Parallel()
	s := newServer(t)
	keeper := newMember(t, s)
	gone := keeper.another(t, s, "lost phone")

	wantStatus(t, "delete", call(t, s, "DELETE", "/v2/devices/"+gone.device, keeper.access, nil), http.StatusNoContent)
	wantProblem(t, "the deleted device's access token", call(t, s, "GET", "/v2/devices", gone.access, nil), http.StatusUnauthorized)
	wantProblem(t, "the deleted device's refresh token", createTokens(t, s, refreshGrant(gone.refresh)), http.StatusUnauthorized)
	wantStatus(t, "the deleting device's access token", call(t, s, "GET", "/v2/devices", keeper.access, nil), http.StatusOK)
}

func TestADeviceDeletesItselfToSignOut(t *testing.T) {
	t.Parallel()
	s := newServer(t)
	m := newMember(t, s)
	wantStatus(t, "delete itself", call(t, s, "DELETE", "/v2/devices/"+m.device, m.access, nil), http.StatusNoContent)
	wantProblem(t, "its access token after", call(t, s, "GET", "/v2/devices", m.access, nil), http.StatusUnauthorized)
}

func TestDeletingADeviceOutsideTheUsersIsNotFound(t *testing.T) {
	t.Parallel()
	s := newServer(t)
	owner, other := newMember(t, s), newMember(t, s)
	wantProblem(t, "another user's device", call(t, s, "DELETE", "/v2/devices/"+owner.device, other.access, nil), http.StatusNotFound)
	wantStatus(t, "the owner's token after", call(t, s, "GET", "/v2/devices", owner.access, nil), http.StatusOK)
	wantProblem(t, "an unknown device", call(t, s, "DELETE", "/v2/devices/"+uuid.NewString(), other.access, nil), http.StatusNotFound)
	wantProblem(t, "device id is not a uuid", call(t, s, "DELETE", "/v2/devices/nope", other.access, nil), http.StatusBadRequest)
}

func TestDevicePagesHoldEveryDeviceOnceOldestFirst(t *testing.T) {
	t.Parallel()
	s := newServer(t)
	devices := deviceFixture(t, s, 7)
	var want, got []string
	for _, d := range devices {
		want = append(want, d.device)
	}
	query := url.Values{"page_size": {"3"}}
	for pages := 1; ; pages++ {
		if pages > len(want) {
			t.Fatal("the pages do not end")
		}
		page := listDevicePage(t, s, devices[0], "?"+query.Encode())
		if len(page.Devices) > 3 {
			t.Errorf("page %d holds %d devices, more than page_size 3", pages, len(page.Devices))
		}
		for _, d := range page.Devices {
			got = append(got, d.Id.String())
		}
		holdsLast := len(got) >= len(want)
		if (page.NextPageToken == nil) != holdsLast {
			t.Fatalf("page %d: next_page_token %v with %d of %d devices read, want it absent only on the last page", pages, page.NextPageToken, len(got), len(want))
		}
		if page.NextPageToken == nil {
			break
		}
		query.Set("page_token", *page.NextPageToken)
	}
	if fmt.Sprint(got) != fmt.Sprint(want) {
		t.Errorf("the pages hold %v, want %v", got, want)
	}
}

func TestListingDevicesRunsTheSameStatementsForAnyNumberOfDevices(t *testing.T) {
	t.Parallel()
	s := newServer(t)
	devices := deviceFixture(t, s, 7)
	// One statement finds the token's session and one lists the devices.
	wantQueryCount(t, s, "/v2/devices", devices[0].access, 2)
	wantQueryCount(t, s, "/v2/devices?page_size=3", devices[0].access, 2)
}

func TestDevicePageSizeDefaultsTo50AndIsLoweredTo100(t *testing.T) {
	t.Parallel()
	s := newServer(t)
	devices := deviceFixture(t, s, 101)
	for query, want := range map[string]int{"": 50, "?page_size=0": 50, "?page_size=101": 100, "?page_size=2147483647": 100} {
		page := listDevicePage(t, s, devices[0], query)
		if len(page.Devices) != want || page.NextPageToken == nil {
			t.Errorf("%q: %d devices, next_page_token %v, want %d and a token", query, len(page.Devices), page.NextPageToken, want)
			continue
		}
		for i, d := range page.Devices {
			if d.Id.String() != devices[i].device {
				t.Errorf("%q: device %d is %s, want %s", query, i, d.Id, devices[i].device)
				break
			}
		}
	}
}

func TestDevicePageRequestsThatDoNotHoldAreInvalid(t *testing.T) {
	t.Parallel()
	s := newServer(t)
	mine := deviceFixture(t, s, 2)
	page := listDevicePage(t, s, mine[0], "?page_size=1")
	if page.NextPageToken == nil {
		t.Fatal("the first of two pages has no next_page_token")
	}
	theirs := deviceFixture(t, s, 2)
	for name, c := range map[string]struct {
		query string
		as    member
	}{
		"negative page_size":        {"?page_size=-1", mine[0]},
		"page_size not a number":    {"?page_size=x", mine[0]},
		"garbage page_token":        {"?page_token=garbage", mine[0]},
		"another user's page_token": {"?" + url.Values{"page_token": {*page.NextPageToken}}.Encode(), theirs[0]},
	} {
		wantProblem(t, name, call(t, s, "GET", "/v2/devices"+c.query, c.as.access, nil), http.StatusBadRequest)
	}
}
