package job

import (
	"fmt"
	"testing"
)

func transfersOf(t *testing.T, j Job) int {
	t.Helper()
	opt, err := j.Options()
	if err != nil {
		t.Fatalf("options: %v", err)
	}
	return opt.Compare.Transfers
}

func TestAJobOnAnFTPServerMovesFewerFilesAtOnceThanItMayConnect(t *testing.T) {
	targets(t,
		"phone: type=ftp host=192.168.1.20",
		"tight: type=ftp host=192.168.1.21 concurrency=2",
		"open: type=ftp host=192.168.1.22 concurrency=0",
		"nas: type=sftp host=192.168.1.30",
	)
	here := t.TempDir()
	for _, c := range []struct {
		left string
		want int
	}{
		// One connection stays free for what a transfer looks up on the side.
		{"phone:DCIM", FTPConnections - 1},
		{"tight:DCIM", 1},
		{"open:DCIM", 10},
		{"nas:photos", 10},
		{here, 10},
	} {
		if got := transfersOf(t, Job{Left: c.left, Right: here, Transfers: 10}); got != c.want {
			t.Errorf("%s: %d transfers at once, want %d", c.left, got, c.want)
		}
	}
}

func TestAnFTPSideOnTheRightCountsToo(t *testing.T) {
	targets(t, "phone: type=ftp host=192.168.1.20")
	if got := transfersOf(t, Job{Left: t.TempDir(), Right: "phone:DCIM", Transfers: 10}); got != FTPConnections-1 {
		t.Errorf("%d transfers at once, want %d", got, FTPConnections-1)
	}
}

func TestAJobAskingForFewerTransfersKeepsItsNumber(t *testing.T) {
	targets(t, "phone: type=ftp host=192.168.1.20")
	if got := transfersOf(t, Job{Left: "phone:DCIM", Right: t.TempDir(), Transfers: 1}); got != 1 {
		t.Errorf("%d transfers at once, want 1", got)
	}
}

func TestAnFTPServerThatTurnedALoginAwayIsOpenedWithHalfAsMany(t *testing.T) {
	targets(t, "phone: type=ftp host=192.168.1.40")
	for _, want := range []int{2, 1} {
		got, ok := StepDown("phone:DCIM")
		if !ok || got != want {
			t.Fatalf("stepped down to %d (%v), want %d", got, ok, want)
		}
		if side := Narrow("phone:DCIM"); side != fmt.Sprintf("phone,concurrency=%d:DCIM", want) {
			t.Errorf("opened as %q", side)
		}
		if got := transfersOf(t, Job{Left: "phone:DCIM", Right: t.TempDir(), Transfers: 10}); got != max(want-1, 1) {
			t.Errorf("%d transfers at once on %d connections", got, want)
		}
	}
	if got, ok := StepDown("phone:DCIM"); ok {
		t.Errorf("stepped down to %d from one connection", got)
	}
}

func TestATargetsOwnConcurrencyIsNeverSteppedDown(t *testing.T) {
	targets(t, "tight: type=ftp host=192.168.1.41 concurrency=3")
	if got, ok := StepDown("tight:DCIM"); ok {
		t.Errorf("stepped down to %d", got)
	}
	if side := Narrow("tight:DCIM"); side != "tight:DCIM" {
		t.Errorf("opened as %q", side)
	}
}

func TestAnFTPServerReachedWithoutATargetIsSteppedDownToo(t *testing.T) {
	side := ":ftp,host=192.168.1.42,user=me:DCIM"
	if got, ok := StepDown(side); !ok || got != 2 {
		t.Fatalf("stepped down to %d (%v), want 2", got, ok)
	}
	if got := Narrow(side); got != ":ftp,host=192.168.1.42,user=me,concurrency=2:DCIM" {
		t.Errorf("opened as %q", got)
	}
}

// The cap is the server's, so a second target on the same account knows it.
func TestTargetsOnOneFTPAccountShareWhatWasFound(t *testing.T) {
	targets(t,
		"photos: type=ftp host=192.168.1.43 user=me",
		"music: type=ftp host=192.168.1.43 user=me",
		"guest: type=ftp host=192.168.1.43 user=guest",
	)
	if _, ok := StepDown("photos:DCIM"); !ok {
		t.Fatal("not stepped down")
	}
	if got := Narrow("music:Music"); got != "music,concurrency=2:Music" {
		t.Errorf("the other target is opened as %q", got)
	}
	if got := Narrow("guest:Music"); got != "guest:Music" {
		t.Errorf("another account is opened as %q", got)
	}
}

func TestOnlyFTPSidesAreSteppedDown(t *testing.T) {
	targets(t, "nas: type=sftp host=192.168.1.44")
	for _, side := range []string{"nas:photos", t.TempDir()} {
		if got, ok := StepDown(side); ok {
			t.Errorf("%s stepped down to %d", side, got)
		}
		if got := Narrow(side); got != side {
			t.Errorf("%s opened as %q", side, got)
		}
	}
}
