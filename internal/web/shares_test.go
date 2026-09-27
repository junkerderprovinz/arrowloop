package web

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestAConnectedShareIsReadFromItsAddress(t *testing.T) {
	cases := []struct {
		letter, remote, account string
		want                    share
		ok                      bool
	}{
		{"Z:", `\\nas\photos`, `NAS\jdp`,
			share{Letter: "Z:", Path: `\\nas\photos`, Host: "nas", Share: "photos", User: "jdp", Domain: "NAS"}, true},
		{"", `\\192.168.1.20\backup\`, "jdp@example.org",
			share{Path: `\\192.168.1.20\backup`, Host: "192.168.1.20", Share: "backup", User: "jdp@example.org"}, true},
		{"Y:", `\\nas\media\films`, "",
			share{Letter: "Y:", Path: `\\nas\media\films`, Host: "nas", Share: "media"}, true},
		// A WebDAV folder mapped to a letter is no share.
		{"W:", "https://cloud.example.org/remote.php/webdav", "", share{}, false},
		{"", `\\nas`, "", share{}, false},
	}
	for _, c := range cases {
		got, ok := shareFrom(c.letter, c.remote, c.account)
		if ok != c.ok || got != c.want {
			t.Errorf("shareFrom(%q, %q, %q) = %+v, %v; want %+v, %v", c.letter, c.remote, c.account, got, ok, c.want, c.ok)
		}
	}
}

func TestTheSharesWindowsReportsReachThePage(t *testing.T) {
	was := listShares
	t.Cleanup(func() { listShares = was })
	listShares = func() ([]share, error) {
		return []share{{Letter: "Z:", Path: `\\nas\photos`, Host: "nas", Share: "photos", User: "jdp"}}, nil
	}

	rec := httptest.NewRecorder()
	(&Server{}).listSharesHandler(rec, httptest.NewRequest(http.MethodGet, "/api/shares", nil))
	if rec.Code != http.StatusOK {
		t.Fatalf("the shares answered %d", rec.Code)
	}
	var got struct {
		Shares []share `json:"shares"`
	}
	if err := json.NewDecoder(rec.Body).Decode(&got); err != nil {
		t.Fatal(err)
	}
	if len(got.Shares) != 1 || got.Shares[0].Host != "nas" || got.Shares[0].Letter != "Z:" {
		t.Errorf("the page received %+v", got.Shares)
	}
}

func TestAskingWindowsForItsSharesDoesNotFail(t *testing.T) {
	// A machine with no shares, which is every CI runner, must answer with
	// none rather than an error.
	if _, err := connectedShares(); err != nil {
		t.Fatalf("listing the connected shares failed: %v", err)
	}
}
