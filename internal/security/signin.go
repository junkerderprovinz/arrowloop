package security

import (
	"cmp"
	"context"
	"crypto/sha256"
	"encoding/base32"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net"
	"net/netip"
	"net/url"
	"path/filepath"
	"strings"
	"time"

	"github.com/junkerderprovinz/parleyport/kit/signin"
	"github.com/junkerderprovinz/parleyport/kit/signin/filestore"
)

// SignInFileName is the file beside the configuration that keeps the
// sign-in: the password, two-factor, passkeys, sessions, API tokens and
// sign-in services, sealed with the install's key.
const SignInFileName = "signin.json"

// PublicEnv names the environment variable that says where people reach
// ArrowLoop, such as https://arrowloop.example.com. Passkeys and sign-in
// services need it, since the address a request names can be anything its
// sender likes.
const PublicEnv = "ARROWLOOP_PUBLIC_URL"

// ownerID is the id of the one account ArrowLoop had before the sign-in
// package, and ownerName its name, the name the package gives an owner.
const (
	ownerID   = "owner"
	ownerName = "admin"
)

// SignIn is what OpenSignIn needs.
type SignIn struct {
	ConfigPath string
	Key        []byte
	// PasswordHash is ARROWLOOP_PASSWORD_HASH. Where it is set it is the
	// password, whatever was set in the interface.
	PasswordHash string
	// Public is PublicEnv as it was set.
	Public  string
	Proxies []netip.Prefix
	Logf    func(format string, args ...any)
	// CodeLog gets the reset code, set apart from the other lines.
	CodeLog io.Writer
	Now     func() time.Time
}

// OpenSignIn opens the sign-in on signin.json. On its first start it takes
// over what security.json held, so an upgrade signs nobody out of their
// password, second factor, passkeys or read tokens.
func OpenSignIn(o SignIn) (*signin.Auth, error) {
	seal, err := signin.NewSealer(o.Key)
	if err != nil {
		return nil, err
	}
	dir := filepath.Dir(o.ConfigPath)
	file, err := filestore.Open(filepath.Join(dir, SignInFileName), seal)
	if err != nil {
		return nil, err
	}
	old, err := Open(o.ConfigPath, o.Key)
	if err != nil {
		return nil, err
	}
	public, err := o.publicURL(context.Background(), file, old.Get())
	if err != nil {
		return nil, err
	}
	logf := o.Logf
	if logf == nil {
		logf = func(string, ...any) {}
	}
	return signin.Open(signin.Config{
		Domain:      "arrowloop",
		Name:        "ArrowLoop",
		Store:       file,
		Seal:        seal,
		Owner:       true,
		TokenPrefix: "al",
		Public:      func() *url.URL { return public },
		Proxies:     o.Proxies,
		PinnedPassword: signin.PinnedPassword{
			Hash:  o.PasswordHash,
			Check: func(hash, pw string) bool { return VerifyPassword(o.Key, pw, hash) },
		},
		Import: func(context.Context) ([]signin.Imported, error) { return imported(old.Get(), o.PasswordHash) },
		Legacy: signin.Legacy{
			Password: func(_ context.Context, hash, pw string) (bool, error) { return VerifyPassword(o.Key, pw, hash), nil },
			Recovery: func(hash, code string) bool { return MatchRecoveryCode(code, []string{hash}) == 0 },
			Token: func(raw string) (string, bool) {
				if !strings.HasPrefix(raw, readTokenPrefix) {
					return "", false
				}
				return ReadTokenDigest(o.Key, raw), true
			},
			Drop: func(context.Context, string, signin.Ending) error { return old.Drop() },
		},
		Logger: slog.New(&logHandler{logf: logf, codes: o.CodeLog}),
		Now:    o.Now,
	})
}

// imported is the owner as security.json kept it. An install that set
// nothing there hands over nothing, and the package makes the owner when the
// first password is set. The password from ARROWLOOP_PASSWORD_HASH stays
// outside, as the pinned one, and the passkeys and the second factor came
// under whichever password was in force.
func imported(st State, envHash string) ([]signin.Imported, error) {
	inForce := cmp.Or(envHash, st.PasswordHash)
	if inForce == "" && len(st.ReadTokens) == 0 {
		return nil, nil
	}
	acc := signin.Imported{ID: ownerID, Name: ownerName, Role: ownerName, Owner: true, Password: st.PasswordHash}
	if inForce != "" && st.TOTP.Enabled {
		secret, err := base32.StdEncoding.WithPadding(base32.NoPadding).DecodeString(strings.ToUpper(strings.TrimSpace(st.TOTP.Secret)))
		if err != nil {
			return nil, fmt.Errorf("the second factor in %s: %w", FileName, err)
		}
		acc.TOTP, acc.TOTPLast, acc.Recovery = secret, int64(st.TOTP.LastStep), st.TOTP.Recovery
	}
	if keys := passkeysUnder(st, inForce); len(keys) > 0 {
		acc.Handle = st.PasskeyUser
		for _, p := range keys {
			acc.Passkeys = append(acc.Passkeys, signin.ImportedPasskey{
				Name: p.Name, ID: p.CredentialID, PublicKey: p.PublicKey, SignCount: p.SignCount, AAGUID: p.AAGUID,
				Transports: transports(p.Transports), BackupEligible: p.BackedUp, BackupState: p.BackedUp,
				RPID: p.RPID, Created: unix(p.CreatedAt), Used: unix(p.LastUsedAt),
			})
		}
	}
	for _, t := range st.ReadTokens {
		acc.Tokens = append(acc.Tokens, signin.ImportedToken{Name: t.Name, Scopes: []string{"read"}, Digest: t.Hash, Created: unix(t.CreatedAt)})
	}
	return []signin.Imported{acc}, nil
}

// passkeysUnder returns the keys registered under the password hash, the
// only ones the version before would still have taken.
func passkeysUnder(st State, hash string) []Passkey {
	if hash == "" || len(st.PasskeyUser) == 0 || (st.PasskeysUnder != "" && st.PasskeysUnder != Fingerprint(hash)) {
		return nil
	}
	return st.Passkeys
}

// Fingerprint is the hex SHA-256 of a password hash, which is how
// security.json remembers the password its passkeys were registered under.
func Fingerprint(hash string) string {
	sum := sha256.Sum256([]byte(hash))
	return hex.EncodeToString(sum[:])
}

func transports(list string) []string {
	var out []string
	for _, t := range strings.Split(list, ",") {
		if t = strings.TrimSpace(t); t != "" {
			out = append(out, t)
		}
	}
	return out
}

func unix(sec int64) time.Time {
	if sec == 0 {
		return time.Time{}
	}
	return time.Unix(sec, 0)
}

// Drop takes away what security.json still held once the sign-in ended one
// of its ways in, so going back to the version before cannot bring it back.
// A password becomes one that matches nothing rather than none, because no
// password would leave that version open to anyone.
func (s *Store) Drop() error {
	return s.Update(func(st *State) error {
		if st.PasswordHash != "" {
			st.PasswordHash = droppedHash
		}
		st.TOTP = TOTP{}
		st.Passkeys, st.PasskeysUnder, st.PasskeyUser, st.ReadTokens = nil, "", nil, nil
		st.Epoch++
		return nil
	})
}

// droppedHash is a password hash in no form any version reads, so it
// refuses every password.
const droppedHash = "moved-to-signin.json"

// The document ArrowLoop keeps beside the package's in the same store.
const (
	appKind  = "arrowloop"
	publicID = "public"
)

// publicURL is PublicEnv, or else the address the passkeys of the version
// before were registered at, which ArrowLoop then remembers. That version
// took the address from each request, so its keys keep working only where
// one name was ever used.
func (o SignIn) publicURL(ctx context.Context, store signin.Store, st State) (*url.URL, error) {
	if raw := strings.TrimSpace(o.Public); raw != "" {
		u, err := ParsePublic(raw)
		if err != nil {
			return nil, fmt.Errorf("%s: %w", PublicEnv, err)
		}
		return u, nil
	}
	var kept struct {
		URL string `json:"url"`
	}
	data, err := store.Get(ctx, appKind, publicID)
	if err == nil && json.Unmarshal(data, &kept) == nil {
		return ParsePublic(kept.URL)
	}
	if err != nil && !errors.Is(err, signin.ErrNotFound) {
		return nil, err
	}
	host := ""
	for _, p := range passkeysUnder(st, st.PasswordHash) {
		if host != "" && p.RPID != host {
			return nil, nil
		}
		host = p.RPID
	}
	if host == "" || host == "localhost" || net.ParseIP(host) != nil {
		return nil, nil
	}
	u := &url.URL{Scheme: "https", Host: host}
	data, _ = json.Marshal(map[string]string{"url": u.String()})
	return u, store.Apply(ctx, signin.Doc{Kind: appKind, ID: publicID, Data: data})
}

// ParsePublic reads an address as browsers write it, with a lower-case host
// and without the default port, since a passkey is bound to exactly that.
func ParsePublic(raw string) (*url.URL, error) {
	u, err := url.Parse(strings.TrimSpace(raw))
	if err != nil || u.Host == "" || (u.Scheme != "https" && u.Scheme != "http") {
		return nil, errors.New("it has to be an address such as https://arrowloop.example.com")
	}
	host, port := strings.ToLower(u.Hostname()), u.Port()
	if (u.Scheme == "https" && port == "443") || (u.Scheme == "http" && port == "80") {
		port = ""
	}
	switch {
	case port != "":
		host = net.JoinHostPort(host, port)
	case strings.Contains(host, ":"):
		host = "[" + host + "]"
	}
	return &url.URL{Scheme: u.Scheme, Host: host}, nil
}

// logHandler writes the package's log through ArrowLoop's, and the reset
// code set apart, the way the ready line stands out.
type logHandler struct {
	logf  func(format string, args ...any)
	codes io.Writer
	attrs []slog.Attr
}

func (h *logHandler) Enabled(_ context.Context, l slog.Level) bool { return l >= slog.LevelInfo }

func (h *logHandler) Handle(_ context.Context, r slog.Record) error {
	var b strings.Builder
	b.WriteString(r.Message)
	code := ""
	add := func(a slog.Attr) bool {
		if a.Key == "code" {
			code = a.Value.String()
			return true
		}
		fmt.Fprintf(&b, " %s=%v", a.Key, a.Value)
		return true
	}
	for _, a := range h.attrs {
		add(a)
	}
	r.Attrs(add)
	if code != "" && h.codes == nil {
		fmt.Fprintf(&b, " code=%s", code)
	}
	h.logf("%s", b.String())
	if code != "" && h.codes != nil {
		_, _ = fmt.Fprintf(h.codes, "\n  \033[1;33m▶ PASSWORD RESET CODE: %s\033[0m\n"+
			"    Valid for 10 minutes. Enter it on the sign-in page.\n"+
			"    If nobody here asked for a reset, ignore this. The password is unchanged.\n\n", code)
	}
	return nil
}

func (h *logHandler) WithAttrs(attrs []slog.Attr) slog.Handler {
	return &logHandler{logf: h.logf, codes: h.codes, attrs: append(append([]slog.Attr{}, h.attrs...), attrs...)}
}

func (h *logHandler) WithGroup(string) slog.Handler { return h }
