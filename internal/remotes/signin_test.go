package remotes

import (
	"context"
	"errors"
	"slices"
	"testing"

	"github.com/rclone/rclone/backend/memory"
	rclonefs "github.com/rclone/rclone/fs"
	"github.com/rclone/rclone/fs/config"
	"github.com/rclone/rclone/fs/config/configmap"
)

// fakeBackend registers a backend for one test, kept out of the tests that
// walk every backend.
func fakeBackend(t *testing.T, info *rclonefs.RegInfo) {
	t.Helper()
	rclonefs.Register(info)
	t.Cleanup(func() {
		rclonefs.Registry = slices.DeleteFunc(rclonefs.Registry, func(r *rclonefs.RegInfo) bool { return r == info })
	})
}

// refreshing is a backend that trades its token for a new one on every
// connection, as Box and Jottacloud do once the access token has run out: the
// token it was given is spent from then on.
const refreshing = "arrowloop-test-refreshing"

func refreshingBackend(t *testing.T) {
	fakeBackend(t, &rclonefs.RegInfo{
		Name: refreshing,
		NewFs: func(ctx context.Context, name, root string, m configmap.Mapper) (rclonefs.Fs, error) {
			token, _ := m.Get("token")
			m.Set("token", token+"+1")
			return memory.NewFs(ctx, name, root, m)
		},
		Options: []rclonefs.Option{{Name: "token", Sensitive: true}},
	})
}

func TestATestOfASavedTargetKeepsTheTokenItRefreshed(t *testing.T) {
	refreshingBackend(t)
	saved(t, "box", refreshing, map[string]string{"token": "first"})

	if err := Try(context.Background(), "box", refreshing, map[string]string{"token": Placeholder}); err != nil {
		t.Fatalf("try: %v", err)
	}
	if got, _ := config.LoadedData().GetValue("box", "token"); got != "first+1" {
		t.Fatalf("the saved token is %q, want the refreshed first+1", got)
	}
}

func TestSavingATestedFormKeepsTheTokenTheTestRefreshed(t *testing.T) {
	refreshingBackend(t)
	ownConfig(t)
	form := map[string]string{"token": "pasted"}

	if err := Try(context.Background(), "", refreshing, form); err != nil {
		t.Fatalf("try: %v", err)
	}
	if err := Save("box", refreshing, form); err != nil {
		t.Fatalf("save: %v", err)
	}
	if got, _ := config.LoadedData().GetValue("box", "token"); got != "pasted+1" {
		t.Fatalf("the saved token is %q, want the refreshed pasted+1", got)
	}
}

// A token typed into the form is the one somebody means to save, so a test
// of it leaves the saved target's own token alone until the form is saved.
func TestATestOfATypedTokenLeavesTheSavedOneAlone(t *testing.T) {
	refreshingBackend(t)
	saved(t, "box", refreshing, map[string]string{"token": "first"})

	if err := Try(context.Background(), "box", refreshing, map[string]string{"token": "other"}); err != nil {
		t.Fatalf("try: %v", err)
	}
	if got, _ := config.LoadedData().GetValue("box", "token"); got != "first" {
		t.Fatalf("the saved token is %q, want first", got)
	}
}

// coded is a backend that signs in with a two-factor code once and keeps the
// session it opened, as Mega and Proton Drive do.
const coded = "arrowloop-test-coded"

func codedBackend(t *testing.T) {
	used := map[string]bool{}
	fakeBackend(t, &rclonefs.RegInfo{
		Name: coded,
		NewFs: func(ctx context.Context, name, root string, m configmap.Mapper) (rclonefs.Fs, error) {
			if session, _ := m.Get("session_id"); session == "" {
				code, _ := m.Get(oneTimeCode)
				if code == "" || used[code] {
					return nil, errors.New("the two-factor code was refused")
				}
				used[code] = true
				m.Set("session_id", "opened-by-"+code)
			}
			return memory.NewFs(ctx, name, root, m)
		},
		Options: []rclonefs.Option{
			{Name: "user"},
			{Name: "pass", IsPassword: true},
			{Name: oneTimeCode},
			{Name: "session_id", Sensitive: true},
		},
	})
	sessionKey[coded] = "session_id"
	t.Cleanup(func() { delete(sessionKey, coded) })
}

func TestOneCodeServesTheTestTheSaveAndTheCheckAfter(t *testing.T) {
	codedBackend(t)
	ownConfig(t)
	form := map[string]string{"user": "someone", "pass": "letmein", oneTimeCode: "123456"}

	if err := Try(context.Background(), "", coded, form); err != nil {
		t.Fatalf("try: %v", err)
	}
	if err := Save("cloud", coded, form); err != nil {
		t.Fatalf("save: %v", err)
	}
	if err := Check(context.Background(), "cloud"); err != nil {
		t.Fatalf("the check after saving asked for the code again: %v", err)
	}
	if code, _ := config.LoadedData().GetValue("cloud", oneTimeCode); code != "" {
		t.Fatalf("the used code %q was saved", code)
	}
}

// Signing in again after a session ran out takes a fresh code, and nothing
// else about the target changes.
func TestAFreshCodeInTheEditFormSignsInWithTheSavedPassword(t *testing.T) {
	codedBackend(t)
	saved(t, "cloud", coded, map[string]string{"user": "someone", "pass": "letmein"})

	got := WithSavedSecrets("cloud", coded, map[string]string{"user": "someone", oneTimeCode: "654321"})
	if got["pass"] != "letmein" {
		t.Fatalf("pass = %q, want the saved password", got["pass"])
	}
}
