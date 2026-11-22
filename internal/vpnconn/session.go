package vpnconn

import (
	"cmp"
	"context"
	"encoding/base64"
	"errors"
	"net"
	"net/netip"
	"os"
	"strings"
	"time"

	"github.com/junkerderprovinz/arrowloop/internal/vpn"
	"github.com/junkerderprovinz/arrowloop/internal/vpn/hideme"
)

// Login is what a provider's form was filled in with, by field name. It is
// sealed as one secret per provider.
type Login map[string]string

// accessTokenField keeps hide.me's access token beside the login it was
// fetched with, so a connect does not send the password every time.
const accessTokenField = "accessToken"

// session is one connection a provider opened.
type session struct {
	cfg vpn.Config
	// end tells the provider the session is over.
	end func(ctx context.Context)
	// login is the login as it stands after opening, when that changed it.
	login Login
	// keep runs while the tunnel stands, for a provider that wants its
	// session renewed.
	keep func(ctx context.Context, logf func(string, ...any))
}

type opener func(ctx context.Context, login Login) (*session, error)

// Codes the settings page words itself (web/src/lib/vpn.ts).
const (
	CodeConfigInvalid = "vpn-config-invalid"
	CodeLoginRefused  = "vpn-login-refused"
	CodeTimeout       = "vpn-timeout"
	// CodeNameUnresolved is an endpoint whose host name no name server
	// answered for.
	CodeNameUnresolved = "vpn-name-unresolved"
	// CodeDeviceLimit is an account that has all the devices or keys it
	// allows registered already.
	CodeDeviceLimit = "vpn-device-limit"
	// CodeAccountExpired is an account with no time left.
	CodeAccountExpired = "vpn-account-expired"
	// CodeLocationUnknown is a location the provider has no server at.
	CodeLocationUnknown = "vpn-location-unknown"
	// CodeStartFailed is a configuration that reads on a system that did
	// not let WireGuard come up.
	CodeStartFailed = "vpn-start-failed"
)

// failure is a connect that did not work, with the code the page words it by.
type failure struct {
	code string
	err  error
}

func (f *failure) Error() string { return f.err.Error() }
func (f *failure) Unwrap() error { return f.err }

func openConfig(_ context.Context, login Login) (*session, error) {
	cfg, err := vpn.ParseConfig(login["config"])
	if err != nil {
		return nil, &failure{CodeConfigInvalid, err}
	}
	return &session{cfg: cfg}, nil
}

// defaultHideMeServer is used when the form leaves the location empty.
const defaultHideMeServer = "nl"

func openHideMe(ctx context.Context, login Login) (*session, error) {
	c := &hideme.Client{
		Host:        cmp.Or(strings.TrimSpace(login["location"]), defaultHideMeServer),
		Username:    strings.TrimSpace(login["username"]),
		Password:    login["password"],
		LookupNetIP: lookupServer,
	}
	if b, err := base64.StdEncoding.DecodeString(login[accessTokenField]); err == nil {
		c.AccessToken = b
	}
	cfg, s, err := c.Connect(ctx)
	if refused(err) && len(c.AccessToken) > 0 {
		// A token from another server or one that ran out; the password
		// fetches a new one.
		c.AccessToken = nil
		cfg, s, err = c.Connect(ctx)
	}
	if err != nil {
		if refused(err) {
			return nil, &failure{CodeLoginRefused, err}
		}
		return nil, unknownServer(err)
	}
	if s.StaleAccessToken {
		c.FetchAccessToken(ctx)
	}
	next := Login{}
	for k, v := range login {
		next[k] = v
	}
	next[accessTokenField] = base64.StdEncoding.EncodeToString(c.AccessToken)
	return &session{
		cfg:   cfg,
		login: next,
		end:   func(ctx context.Context) { c.Disconnect(ctx, s) },
	}, nil
}

func refused(err error) bool {
	var se *hideme.StatusError
	return errors.Is(err, hideme.ErrUpdateRequired) || errors.As(err, &se) && se.Code >= 400 && se.Code < 500
}

// lookupServer resolves the server of a provider whose location is a server
// name, the system's resolver when nil; tests answer for it.
var lookupServer func(ctx context.Context, network, host string) ([]netip.Addr, error)

// unknownServer gives a server name that does not exist the code of an
// unknown location, for a provider whose location names the server. A lookup
// that timed out or failed for now stays an error worth trying again.
func unknownServer(err error) error {
	var de *net.DNSError
	if errors.As(err, &de) && de.IsNotFound {
		return &failure{CodeLocationUnknown, err}
	}
	return err
}

// classify gives an error of opening a session or setting the tunnel up its
// code, where it has one.
func classify(err error) *failure {
	var f *failure
	if errors.As(err, &f) {
		return f
	}
	var ne net.Error
	if errors.Is(err, context.DeadlineExceeded) || errors.Is(err, os.ErrDeadlineExceeded) || errors.As(err, &ne) {
		return &failure{CodeTimeout, err}
	}
	return &failure{"", err}
}

// endSoon ends a session without holding up whoever let go of it.
func endSoon(s *session) {
	if s == nil || s.end == nil {
		return
	}
	go func() {
		ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
		defer cancel()
		s.end(ctx)
	}()
}
