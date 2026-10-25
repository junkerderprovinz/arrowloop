package remotes

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"maps"
	"sort"
	"strings"
	"sync"
	"time"

	rclonefs "github.com/rclone/rclone/fs"
	"github.com/rclone/rclone/fs/config/configmap"
)

// Question is a choice rclone's own setup of a backend leaves to the person
// setting it up, such as which of several drives a sign-in opens. The answer
// goes back as the setting Name.
type Question struct {
	Name    string    `json:"name"`
	Choices []Example `json:"choices"`
}

// setupStep is the part of rclone's interactive setup that a form cannot
// replace with fields, for one backend.
type setupStep struct {
	// due says whether the settings still need the step.
	due func(settings map[string]string) bool
	// answers are the questions answered without asking.
	answers map[string]string
	// asked maps a question of the setup to the setting that answers it. That
	// setting stays out of what the setup starts from, since the setup writes
	// its own value under the name.
	asked map[string]string
}

// newToken is a token typed into the form rather than one kept from a saved
// target, which comes back as the placeholder and has had its setup.
func newToken(s map[string]string) bool {
	token := strings.TrimSpace(s["token"])
	return token != "" && token != Placeholder
}

var setupSteps = map[string]setupStep{
	// Jottacloud signs in with a personal login token from its security page,
	// which only its setup trades for an OAuth token and the client it
	// belongs to. The login token works once.
	"jottacloud": {
		due: func(s map[string]string) bool {
			return newToken(s) && !strings.HasPrefix(strings.TrimSpace(s["token"]), "{")
		},
		answers: map[string]string{"config_type": "standard", "config_non_standard": "false"},
		asked:   map[string]string{"config_login_token": "token"},
	},
	// OneDrive needs the drive a token opens, which only the setup looks up.
	"onedrive": {
		due: func(s map[string]string) bool {
			return newToken(s) && (s["drive_id"] == "" || s["drive_type"] == "")
		},
		answers: map[string]string{"config_refresh_token": "false", "config_type": "onedrive", "config_drive_ok": "true"},
	},
	// Zoho WorkDrive needs the workspace to work in.
	"zoho": {
		due:     func(s map[string]string) bool { return newToken(s) && s["root_folder_id"] == "" },
		answers: map[string]string{"config_refresh_token": "false"},
	},
}

// findBackend is where Setup looks up a backend's setup, so a test can walk
// one without the network.
var findBackend = rclonefs.Find

// setupName is the remote name rclone's setup is told it configures. Nothing
// is written under it: the setup runs on a map.
const setupName = "arrowloop-setup"

// Setup readies a target's settings the way rclone config would: it unpacks
// what `rclone authorize` printed with a config blob and runs the part of the
// backend's own setup the settings still need. Answers to an earlier Question
// come in as settings named after it and do not come out. Where the setup
// needs a choice with more than one way to go, it returns that as a Question.
func Setup(ctx context.Context, backend string, settings map[string]string) (map[string]string, *Question, error) {
	out := make(map[string]string, len(settings))
	picked := map[string]string{}
	for k, v := range settings {
		if _, isOption := optionOf(backend, k); !isOption && strings.HasPrefix(k, "config_") {
			picked[k] = v
			continue
		}
		out[k] = v
	}
	unpackAuthorize(out)

	step, ok := setupSteps[backend]
	if !ok || !step.due(out) {
		return out, nil, nil
	}
	key := setupKey(backend, settings)
	if done, ok := setups.recall(key); ok {
		return done, nil, nil
	}
	info, err := findBackend(backend)
	if err != nil {
		return nil, nil, fmt.Errorf("this build does not include the %q backend: %w", backend, err)
	}

	choices := configmap.Simple(maps.Clone(step.answers))
	m := configmap.Simple{}
	for k, v := range out {
		m[k] = forConnection(backend, k, v)
	}
	for question, setting := range step.asked {
		choices[question] = out[setting]
		delete(m, setting)
	}
	maps.Copy(choices, picked)

	ctx, stop := context.WithTimeout(ctx, CheckWait)
	defer stop()
	in := rclonefs.ConfigIn{}
	// A choice with one way to go is taken, so a person with one drive is
	// never asked which.
	for range 8 {
		next, err := rclonefs.BackendConfig(ctx, setupName, m, info, choices, in)
		if err != nil {
			return nil, nil, checkErr(ctx, err)
		}
		switch {
		case next == nil || next.State == "":
			done := learned(backend, m)
			setups.keep(key, done)
			return done, nil, nil
		case next.Error != "":
			return nil, nil, errors.New(firstLine(next.Error))
		case next.Option == nil:
			return nil, nil, fmt.Errorf("rclone's setup of %s stopped at %q", backend, next.State)
		case len(next.Option.Examples) == 1:
			in = rclonefs.ConfigIn{State: next.State, Result: next.Option.Examples[0].Value}
		case len(next.Option.Examples) == 0:
			return nil, nil, fmt.Errorf("rclone's setup asks for %s, which this form cannot answer: %s", next.Option.Name, firstLine(next.Option.Help))
		default:
			q := &Question{Name: next.Option.Name}
			for _, e := range next.Option.Examples {
				q.Choices = append(q.Choices, Example{Value: e.Value, Help: firstLine(e.Help)})
			}
			return nil, q, nil
		}
	}
	return nil, nil, fmt.Errorf("rclone's setup of %s kept asking", backend)
}

// learned is what the setup left in m, as a form would type it. Its own
// inputs, named config_ by rclone's convention, are no settings.
func learned(backend string, m configmap.Simple) map[string]string {
	out := make(map[string]string, len(m))
	for k, v := range m {
		if _, isOption := optionOf(backend, k); !isOption && strings.HasPrefix(k, "config_") {
			continue
		}
		out[k] = typedForm(backend, k, v)
	}
	return out
}

// unpackAuthorize replaces a token that holds what `rclone authorize` prints
// when it is given a config blob with the settings the blob carries: ShareFile
// puts its address there and Zoho its region. A setting the form already has
// wins over the blob's, the token aside.
func unpackAuthorize(settings map[string]string) {
	raw := strings.TrimSpace(settings["token"])
	if raw == "" || raw == Placeholder || strings.HasPrefix(raw, "{") {
		return
	}
	blob := configmap.Simple{}
	if blob.Decode(raw) != nil || blob["token"] == "" {
		return
	}
	for k, v := range blob {
		if k == "token" || strings.TrimSpace(settings[k]) == "" {
			settings[k] = v
		}
	}
}

// setupKey names one set of settings without holding its secrets.
func setupKey(backend string, settings map[string]string) string {
	keys := make([]string, 0, len(settings))
	for k, v := range settings {
		if v != "" {
			keys = append(keys, k)
		}
	}
	sort.Strings(keys)
	h := sha256.New()
	fmt.Fprintf(h, "%s\x00", backend)
	for _, k := range keys {
		fmt.Fprintf(h, "%s=%s\x00", k, settings[k])
	}
	return hex.EncodeToString(h.Sum(nil))
}

// setups remembers what a setup found for a while, so the save after a test
// gets the same result. Jottacloud's login token cannot be traded twice.
var setups = &setupMemory{done: map[string]remembered{}}

const setupKept = 30 * time.Minute

type remembered struct {
	settings map[string]string
	at       time.Time
}

type setupMemory struct {
	mu   sync.Mutex
	done map[string]remembered
}

func (s *setupMemory) recall(key string) (map[string]string, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	r, ok := s.done[key]
	if !ok || time.Since(r.at) > setupKept {
		return nil, false
	}
	return maps.Clone(r.settings), true
}

func (s *setupMemory) keep(key string, settings map[string]string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	for k, r := range s.done {
		if time.Since(r.at) > setupKept {
			delete(s.done, k)
		}
	}
	s.done[key] = remembered{settings: maps.Clone(settings), at: time.Now()}
}
