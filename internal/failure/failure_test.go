package failure_test

import (
	"errors"
	"fmt"
	"reflect"
	"testing"

	"github.com/junkerderprovinz/arrowloop/internal/daemon"
	"github.com/junkerderprovinz/arrowloop/internal/failure"
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
			fmt.Sprintf("%s: exit status 2: mount: no medium", daemon.BeforeFailed),
			failure.Failure{Code: failure.BeforeFailed, Params: map[string]string{"output": "exit status 2: mount: no medium"}},
		},
		{
			fmt.Sprintf("%s: exit status 1", daemon.AfterFailed),
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

func TestAFailureAfterAJobsNameIsStillNamed(t *testing.T) {
	text := "photos: " + fmt.Errorf("%w: %s", daemon.ErrNotEnoughSpace, tooFull).Error()
	if got := failure.Of(text); got == nil || got.Code != failure.NotEnoughSpace {
		t.Errorf("Of(%q) = %+v, want the space failure", text, got)
	}
	text = "photos: " + fmt.Sprintf("%s: exit status 1", daemon.BeforeFailed)
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
