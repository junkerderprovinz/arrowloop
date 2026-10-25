package remotes

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"maps"
	"slices"
	"sync"
	"time"

	rclonefs "github.com/rclone/rclone/fs"
	"github.com/rclone/rclone/fs/config"
)

// Try checks a target's form before it is saved: the settings as the form
// holds them, with the secrets it withheld filled in from the saved target
// called name. What rclone writes back while it connects, a refreshed token or
// the session a two-factor code opened, cannot be had a second time: Box and
// Jottacloud void the token a refresh used, and a code works once. So it goes
// to the saved target the form edits, and the Save of the same form keeps it.
func Try(ctx context.Context, name, backend string, form map[string]string) error {
	key := formKey(backend, form)
	settings := map[string]string{}
	maps.Copy(settings, WithSavedSecrets(name, backend, form))
	for k, v := range tried.recall(key) {
		settings[k] = typedForm(backend, k, v)
	}

	learned, err := checkSettings(ctx, backend, settings)
	if len(learned) > 0 {
		tried.keep(key, learned)
		carryBack(name, backend, form, learned)
	}
	return err
}

// carryBack writes what a check learned into the saved target the form edits,
// where the form used the target's own sign-in rather than one typed in. A
// form somebody cancels then still leaves the target with a token that works.
func carryBack(name, backend string, form, learned map[string]string) {
	data := config.LoadedData()
	if name == "" || !data.HasSection(name) {
		return
	}
	if stored, _ := data.GetValue(name, "type"); stored != backend || !sameTarget(data, name, backend, form) {
		return
	}
	for k := range learned {
		if typed := form[k]; typed != "" && typed != Placeholder {
			return
		}
	}
	setRaw(data, name, learned)
	dropUsedCode(data, name, backend)
	_ = data.Save()
}

// setRaw writes values as rclone wrote them, so nothing is obscured twice. An
// empty value is one rclone cleared.
func setRaw(data config.Storage, name string, values map[string]string) {
	for k, v := range values {
		if v == "" {
			data.DeleteKey(name, k)
			continue
		}
		data.SetValue(name, k, v)
	}
}

// oneTimeCode is the setting Mega and Proton Drive take a two-factor code in,
// and sessionKey the one that holds the session the code opened. Seafile has
// a setting of the same name that only says two-factor sign-in is on.
const oneTimeCode = "2fa"

var sessionKey = map[string]string{"mega": "session_id", "protondrive": "client_uid"}

// dropUsedCode removes a two-factor code once the session it opened is kept:
// it worked once, and a connection that sent it again would be refused.
func dropUsedCode(data config.Storage, name, backend string) {
	session, coded := sessionKey[backend]
	if !coded {
		return
	}
	if v, _ := data.GetValue(name, session); v != "" {
		data.DeleteKey(name, oneTimeCode)
	}
}

// checking keeps checks to one at a time, since rclone addresses what it
// writes back for a connection string by the backend's name alone.
var checking sync.Mutex

// writeBack catches what rclone saves for the connection string under check.
// rclone drops such a value rather than keep it, so a token it refreshed
// there would be lost with the old one already voided.
var writeBack struct {
	mu      sync.Mutex
	section string
	values  map[string]string
}

var listening sync.Once

// listen routes rclone's saves for the connection string under check to
// writeBack. Every other save goes to the config file as before.
func listen() {
	save := rclonefs.ConfigFileSet
	rclonefs.ConfigFileSet = func(section, key, value string) error {
		writeBack.mu.Lock()
		caught := writeBack.values != nil && section == writeBack.section
		if caught {
			writeBack.values[key] = value
		}
		writeBack.mu.Unlock()
		if caught {
			return nil
		}
		return save(section, key, value)
	}
}

// catch starts or ends catching rclone's saves for section, and returns what
// was caught.
func catch(section string, on bool) map[string]string {
	writeBack.mu.Lock()
	defer writeBack.mu.Unlock()
	caught := writeBack.values
	writeBack.section, writeBack.values = section, nil
	if on {
		writeBack.values = map[string]string{}
	}
	return caught
}

// checkSettings reports whether a target built from settings that have not
// been saved answers, and returns what rclone wrote back while reaching it. It
// goes through an inline connection string, so no remote holding real
// credentials is written.
func checkSettings(ctx context.Context, backend string, settings map[string]string) (map[string]string, error) {
	if backend == "" {
		return nil, fmt.Errorf("a remote needs a type, for example s3 or sftp")
	}
	if _, err := rclonefs.Find(backend); err != nil {
		return nil, fmt.Errorf("this build does not include the %q backend: %w", backend, err)
	}

	listening.Do(listen)
	checking.Lock()
	defer checking.Unlock()
	catch(":"+backend, true)

	ctx, stop := context.WithTimeout(ctx, CheckWait)
	defer stop()

	f, err := rclonefs.NewFs(ctx, connectionString(backend, settings))
	if err == nil {
		err = listRoot(ctx, f, backend)
	} else {
		err = checkErr(ctx, err)
	}
	return catch("", false), err
}

// formKey names a form by its backend and the settings it holds. Try and Save
// receive the same form, empty fields aside.
func formKey(backend string, form map[string]string) string {
	h := sha256.New()
	fmt.Fprintf(h, "%q", backend)
	for _, k := range slices.Sorted(maps.Keys(form)) {
		if k == "type" || form[k] == "" {
			continue
		}
		fmt.Fprintf(h, "\x00%q=%q", k, form[k])
	}
	return hex.EncodeToString(h.Sum(nil))
}

// learnedSignIns keeps what checks of a form learned until the form is saved.
type learnedSignIns struct {
	mu   sync.Mutex
	byID map[string]learnedSignIn
}

type learnedSignIn struct {
	values map[string]string
	at     time.Time
}

const (
	// keepSignIn is how long a form may stay open between its test and its
	// save.
	keepSignIn = 6 * time.Hour
	// keptSignIns bounds the forms remembered at once.
	keptSignIns = 32
)

var tried learnedSignIns

func (l *learnedSignIns) recall(key string) map[string]string {
	l.mu.Lock()
	defer l.mu.Unlock()
	got, ok := l.byID[key]
	if !ok || time.Since(got.at) > keepSignIn {
		return nil
	}
	return maps.Clone(got.values)
}

func (l *learnedSignIns) keep(key string, values map[string]string) {
	l.mu.Lock()
	defer l.mu.Unlock()
	if l.byID == nil {
		l.byID = map[string]learnedSignIn{}
	}
	merged := l.byID[key].values
	if merged == nil {
		merged = map[string]string{}
	}
	maps.Copy(merged, values)
	l.byID[key] = learnedSignIn{values: merged, at: time.Now()}

	for len(l.byID) > keptSignIns {
		oldest := ""
		for k, v := range l.byID {
			if oldest == "" || v.at.Before(l.byID[oldest].at) {
				oldest = k
			}
		}
		delete(l.byID, oldest)
	}
}

func (l *learnedSignIns) forget(key string) {
	l.mu.Lock()
	defer l.mu.Unlock()
	delete(l.byID, key)
}
