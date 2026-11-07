package failure_test

import (
	"errors"
	"fmt"
	"reflect"
	"testing"

	"github.com/junkerderprovinz/arrowloop/internal/daemon"
	"github.com/junkerderprovinz/arrowloop/internal/failure"
	"github.com/junkerderprovinz/arrowloop/internal/hook"
)

// The space finding as precheck words it; precheck_test.go holds the template
// to the same words.
const tooFull = "the right side reports 16384 bytes free and this job would write at least 31649416331"

func TestTheEnginesOwnSentencesCarryTheirFigures(t *testing.T) {
	cases := []struct {
		text string
		want failure.Failure
	}{
		{
			fmt.Errorf("%w: %s", daemon.ErrNotEnoughSpace, tooFull).Error(),
			failure.Failure{Code: failure.NotEnoughSpace, Params: map[string]string{"side": "right", "free": "16384", "needed": "31649416331"}},
		},
		{
			fmt.Errorf("%w: left side USB disk (label Photos)", daemon.ErrVolumeMissing).Error(),
			failure.Failure{Code: failure.VolumeMissing, Params: map[string]string{"side": "left"}},
		},
		{
			fmt.Errorf("right side %q: %w", "/storage/emulated/0/DCIM", daemon.ErrNoFileAccess).Error(),
			failure.Failure{Code: failure.NoFileAccess, Params: map[string]string{"side": "right"}},
		},
		{
			fmt.Sprintf("%s: exit status 2: mount: no medium", hook.BeforeFailed),
			failure.Failure{Code: failure.BeforeFailed, Params: map[string]string{"output": "exit status 2: mount: no medium"}},
		},
		{
			fmt.Sprintf("%s: exit status 1", hook.AfterFailed),
			failure.Failure{Code: failure.AfterFailed, Params: map[string]string{"output": "exit status 1"}},
		},
	}
	for _, c := range cases {
		got := failure.Of(c.text)
		if got == nil || !reflect.DeepEqual(*got, c.want) {
			t.Errorf("Of(%q) = %+v, want %+v", c.text, got, c.want)
		}
	}
}

func TestBackendErrorsAreNamedWithTheirSide(t *testing.T) {
	cases := map[string]failure.Failure{
		`right side ":sftp,host=127.0.0.1,port=1,user=demo:/x": couldn't connect to ssh-agent: SSH agent requested, but could not detect Pageant`: {
			Code: failure.SignInFailed, Params: map[string]string{"side": "right"},
		},
		`left side "nas:photos": dial tcp 192.168.1.20:22: connect: connection refused`: {
			Code: failure.Unreachable, Params: map[string]string{"side": "left"},
		},
		`left side "D:\\Fotos": list D:\Fotos: open D:\Fotos: The system cannot find the path specified.`: {
			Code: failure.NotFound, Params: map[string]string{"side": "left"},
		},
		`right side "/mnt/backup": mkdir /mnt/backup/x: permission denied`: {
			Code: failure.PermissionDenied, Params: map[string]string{"side": "right"},
		},
		"googleapi: Error 403: The user's Drive storage quota has been exceeded., storageQuotaExceeded": {
			Code: failure.QuotaExceeded,
		},
		`the right side could not be opened: couldn't connect to ssh-agent: SSH agent requested, but could not detect Pageant`: {
			Code: failure.SignInFailed, Params: map[string]string{"side": "right"},
		},
		"the drive the left side lives on is not attached: USB disk (label Photos)": {
			Code: failure.VolumeMissing, Params: map[string]string{"side": "left"},
		},
		`left side "box:": couldn't connect SSH: ssh: handshake failed: sftp: host key mismatch for 127.0.0.1:2222: server offered ssh-ed25519 key with fingerprint SHA256:abc`: {
			Code: failure.HostKeyChanged, Params: map[string]string{"side": "left"},
		},
		"no answer within 1m0s: the right side could not be opened: read metadata failed: context deadline exceeded": {
			Code: failure.Unreachable, Params: map[string]string{"side": "right"},
		},
		"429 Too Many Requests": {Code: failure.RateLimited},
		"context canceled":      {Code: failure.Stopped},
	}
	for text, want := range cases {
		got := failure.Of(text)
		if got == nil || !reflect.DeepEqual(*got, want) {
			t.Errorf("Of(%q) = %+v, want %+v", text, got, want)
		}
	}
}

// Each FTP server words its cap on logins its own way: Apache FtpServer, which
// many phone apps are built on, vsftpd, pure-ftpd, ProFTPD, FileZilla and IIS.
func TestAnFTPServerOutOfLoginsIsNamed(t *testing.T) {
	cases := map[string]failure.Failure{
		`list FTP: list: failed to make FTP connection to "192.168.1.5:2221": 421 "Maximum login limit has been reached."`: {
			Code: failure.TooManyLogins,
		},
		`left side "FTP:SICS": NewFs: failed to make FTP connection to "192.168.1.5:21": 421 "There are too many connected users, please try later."`: {
			Code: failure.TooManyLogins, Params: map[string]string{"side": "left"},
		},
		`failed to make FTP connection to "nas:21": 421 "Too many connections (8) from this IP"`: {
			Code: failure.TooManyLogins,
		},
		`failed to make FTP connection to "nas:21": 530 "Sorry, the maximum number of clients (3) for this user are already connected."`: {
			Code: failure.TooManyLogins,
		},
		`failed to make FTP connection to "pc:21": 421 "Too many users are connected, please try again later."`: {
			Code: failure.TooManyLogins,
		},
		`failed to make FTP connection to "phone:2121": 421 "I can't accept more than 2 connections as the same user"`: {
			Code: failure.TooManyLogins,
		},
		`failed to make FTP connection to "nas:21": 421 "10 users (the maximum) are already logged in, sorry"`: {
			Code: failure.TooManyLogins,
		},
		`failed to make FTP connection to "nas:21": 421 "There are too many connections from your internet address."`: {
			Code: failure.TooManyLogins,
		},
		`failed to make FTP connection to "nas:21": 421 "Sorry, the maximum number of allowed clients (5) are already connected."`: {
			Code: failure.TooManyLogins,
		},
		`failed to make FTP connection to "nas:21": 421 "Sorry, the maximum number of hosts (1) for this user are already connected."`: {
			Code: failure.TooManyLogins,
		},
		`failed to make FTP connection to "nas:21": 530 "Sorry, the maximum number of connections (2) for your host are already connected."`: {
			Code: failure.TooManyLogins,
		},
		`failed to make FTP connection to "nas:21": 421 "Maximum IP login limit has been reached."`: {
			Code: failure.TooManyLogins,
		},
		`failed to make FTP connection to "nas:21": 421 "Too many sessions"`: {
			Code: failure.TooManyLogins,
		},
		`failed to make FTP connection to "pc:21": 421 "Too many users, try later."`: {
			Code: failure.TooManyLogins,
		},
	}
	for text, want := range cases {
		got := failure.Of(text)
		if got == nil || !reflect.DeepEqual(*got, want) {
			t.Errorf("Of(%q) = %+v, want %+v", text, got, want)
		}
	}
}

// pure-ftpd refuses a plain login with the same code as a full server, and a
// server busy with requests is not out of logins.
func TestOtherRefusalsAreNotTakenForTooManyLogins(t *testing.T) {
	for _, text := range []string{
		`failed to make FTP connection to "nas:21": 421 "Sorry, cleartext sessions and weak ciphers are not accepted on this server."`,
		"429 Too Many Requests",
		`failed to make FTP connection to "nas:21": 530 "Login authentication failed"`,
	} {
		if got := failure.Of(text); got != nil && got.Code == failure.TooManyLogins {
			t.Errorf("Of(%q) = %+v, want another failure", text, got)
		}
	}
}

func TestAFailureAfterAJobsNameIsStillNamed(t *testing.T) {
	text := "photos: " + fmt.Errorf("%w: %s", daemon.ErrNotEnoughSpace, tooFull).Error()
	if got := failure.Of(text); got == nil || got.Code != failure.NotEnoughSpace {
		t.Errorf("Of(%q) = %+v, want the space failure", text, got)
	}
	text = "photos: " + fmt.Sprintf("%s: exit status 1", hook.BeforeFailed)
	if got := failure.Of(text); got == nil || got.Params["output"] != "exit status 1" {
		t.Errorf("Of(%q) = %+v, want the command's output alone", text, got)
	}
}

func TestAnUnknownErrorIsLeftAsItIs(t *testing.T) {
	for _, text := range []string{"", "something nobody planned for", errors.New("bandwidth limit \"x\": bad").Error()} {
		if got := failure.Of(text); got != nil {
			t.Errorf("Of(%q) = %+v, want nil", text, got)
		}
	}
}
