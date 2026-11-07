package job

import "testing"

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
