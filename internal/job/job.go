// Package job turns a configuration file into runnable sync jobs.
package job

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"github.com/robfig/cron/v3"

	"github.com/junkerderprovinz/arrowloop/internal/engine"
	"github.com/junkerderprovinz/arrowloop/internal/filter"
	"github.com/junkerderprovinz/arrowloop/internal/plan"
)

// Config is the whole file.
type Config struct {
	Jobs []Job `json:"jobs"`

	// History is where run records go. Empty means alongside the config file.
	History string `json:"history,omitempty"`

	// BwLimit is process-wide because rclone's token bucket is. It takes
	// rclone's syntax, so "1M" or a timetable like "08:00,512k 19:00,off".
	BwLimit string `json:"bwlimit,omitempty"`

	// HistoryKeep is how long a run record is kept. Empty means ninety days,
	// and "0" keeps them for ever.
	HistoryKeep string `json:"historyKeep,omitempty"`

	// ParallelJobs is how many jobs may run at once. The default is one,
	// because two jobs share one line and one disk and mostly slow each other
	// down.
	ParallelJobs int `json:"parallelJobs,omitempty"`

	Notify Notify `json:"notify,omitempty"`

	// Retry is what happens after a scheduled run fails.
	Retry Retry `json:"retry,omitempty"`

	// Defaults fill in per-job settings that a job does not set for itself.
	// They are applied once at load, so everything downstream sees resolved
	// jobs.
	Defaults Defaults `json:"defaults,omitempty"`

	// ExcludeSets are reusable pattern lists that a job asks for by name.
	ExcludeSets map[string][]string `json:"excludeSets,omitempty"`

	// dir is where the file was read from, so relative paths inside it are
	// relative to the file.
	dir string
	// path and raw let the editor write the file back without losing anything
	// it did not touch.
	path string
	raw  []byte

	// retired lists field names in the file that this program no longer
	// understands, so a caller can say what was ignored.
	retired []string
}

// Retry is what a scheduled run does after it fails: a few more tries, each
// after a longer wait, and then the job waits for its next scheduled time.
//
// Without the limit a failed job stays due and runs at every tick, which on a
// phone spends a night's battery on a remote that is still down. It is
// engine-wide because patience after a failure depends on the machine, not on
// a folder pair.
type Retry struct {
	// Attempts is how many further tries a failed job gets before it waits for
	// its next scheduled time. Zero means none; nil means the default.
	Attempts *int `json:"attempts,omitempty"`

	// Wait is how long to wait before the first further try. Each try after
	// that waits twice as long. Empty means the default.
	Wait string `json:"wait,omitempty"`
}

// Defaults for the retry policy. Three tries starting at five minutes are over
// inside forty minutes, so a nightly job still has the night to finish in.
const (
	DefaultRetryAttempts = 3
	DefaultRetryWait     = 5 * time.Minute
)

// RetryCap stops the doubling from putting the last try days out.
const RetryCap = 6 * time.Hour

// AttemptCount is Retry.Attempts with the default applied. A negative number
// means none rather than an error, so the program still starts over it.
func (r Retry) AttemptCount() int {
	if r.Attempts == nil {
		return DefaultRetryAttempts
	}
	if *r.Attempts < 0 {
		return 0
	}
	return *r.Attempts
}

// WaitFor is how long to wait before try number n, counting from one. The wait
// doubles up to RetryCap, and an unparseable or non-positive wait falls back to
// the default.
func (r Retry) WaitFor(n int) time.Duration {
	base := DefaultRetryWait
	if raw := strings.TrimSpace(r.Wait); raw != "" {
		if d, err := time.ParseDuration(raw); err == nil && d > 0 {
			base = d
		}
	}
	if n < 1 {
		n = 1
	}
	wait := base
	for i := 1; i < n; i++ {
		wait *= 2
		if wait >= RetryCap {
			return RetryCap
		}
	}
	return wait
}

// KeepHistoryFor is HistoryKeep as a duration, with the default applied. The
// second value is false for "keep for ever", which a zero duration could not
// tell apart from unset.
func (c *Config) KeepHistoryFor() (time.Duration, bool) {
	raw := strings.TrimSpace(c.HistoryKeep)
	if raw == "" {
		return 90 * 24 * time.Hour, true
	}
	d, err := time.ParseDuration(raw)
	if err != nil || d < 0 {
		// A typo must not switch off pruning.
		return 90 * 24 * time.Hour, true
	}
	if d == 0 {
		return 0, false
	}
	return d, true
}

// Notify says where a run reports to.
type Notify struct {
	Matrix  *Matrix `json:"matrix,omitempty"`
	Webhook string  `json:"webhook,omitempty"`

	// OnSuccess sends a message for every run, not only for failures. It is
	// off by default, because regular success messages teach people to ignore
	// all of them.
	OnSuccess bool `json:"onSuccess,omitempty"`
}

// Matrix is a room to post into.
type Matrix struct {
	Homeserver string `json:"homeserver"`
	Room       string `json:"room"`
	Token      string `json:"token"`
}

// Job is one pairing of two ends.
type Job struct {
	Name  string `json:"name"`
	Left  string `json:"left"`
	Right string `json:"right"`
	State string `json:"state"`

	// Schedule is a cron expression. Empty means the job only runs when
	// somebody asks for it by name.
	Schedule string `json:"schedule,omitempty"`

	// Watch runs the job when a local side changes. It does not replace the
	// schedule: a watcher that misses an event cannot know it did, and the
	// schedule catches what it missed.
	Watch bool `json:"watch,omitempty"`

	// WatchSettle is how long the tree must stay quiet before a change counts,
	// so copying a folder in starts one run rather than one per file.
	WatchSettle string `json:"watchSettle,omitempty"`

	// RunAtStart runs the job once when the program starts, so a machine that
	// was off overnight does not wait for the next scheduled turn. It fires
	// once per program start, never on a configuration reload.
	RunAtStart bool `json:"runAtStart,omitempty"`

	Disabled bool `json:"disabled,omitempty"`

	// KeepVersions keeps the last N contents of a file that gets overwritten,
	// under the same reserved directory the trash uses. It is off by default,
	// since most trees are never edited in place and a copy of every overwrite
	// would double them.
	KeepVersions int `json:"keepVersions,omitempty"`

	// ReportOnly plans on every automatic turn and writes the result to the
	// run log without applying anything. A run started by hand applies
	// normally.
	ReportOnly bool `json:"reportOnly,omitempty"`

	// NoTrash deletes outright instead of moving into the side's own trash, so
	// no .arrowloop folder appears inside the synced tree. It is negative so
	// that the zero value keeps the trash. With it on, a deletion and the
	// losing side of a conflict are final.
	NoTrash bool `json:"noTrash,omitempty"`

	Exclude           []string `json:"exclude,omitempty"`
	NoDefaultExcludes bool     `json:"noDefaultExcludes,omitempty"`

	// ExcludeSets names reusable pattern lists defined at the top of the file.
	// Their patterns are added to Exclude rather than replacing it. An
	// undefined name is an error at load, because a filter that silently
	// matches nothing syncs what it was meant to keep out.
	ExcludeSets []string `json:"excludeSets,omitempty"`

	// Direction says which way this job may write: "both" (the default),
	// "leftToRight" or "rightToLeft". A one-way job still compares both sides
	// to know what changed.
	Direction string `json:"direction,omitempty"`

	// Mode is what a one-way job does beyond copying: "sync" (the default,
	// which deletes nothing), "mirror" (the destination becomes an exact copy)
	// or "move" (a file leaves the source once it has landed on the other
	// side). It is separate from Direction because it answers a separate
	// question.
	Mode string `json:"mode,omitempty"`

	QuietPeriod string `json:"quietPeriod,omitempty"`
	ModWindow   string `json:"modWindow,omitempty"`
	Transfers   int    `json:"transfers,omitempty"`

	// EmptyDirs and Metadata are pointers so that a job can switch off what
	// the defaults switch on.
	EmptyDirs *bool `json:"emptyDirs,omitempty"`
	Metadata  *bool `json:"metadata,omitempty"`

	// BrakePercent and BrakeFloor are pointers because "0" switches the
	// mass-delete brake off, and that has to be typed on purpose.
	BrakePercent *int `json:"brakePercent,omitempty"`
	BrakeFloor   *int `json:"brakeFloor,omitempty"`

	// FoldCase overrides the backends' answer about case sensitivity for this
	// job. See Defaults.FoldCase.
	FoldCase *bool `json:"foldCase,omitempty"`
}

// Defaults fill in the per-job settings a job does not set for itself, so a
// job carries only what makes it different. The pointer fields let a job
// switch off what a default switches on.
type Defaults struct {
	Direction string `json:"direction,omitempty"`
	Mode      string `json:"mode,omitempty"`

	// Watch and NoTrash have no default: they are plain bools on the job, so a
	// default that switched one on could not be switched off for a single job.
	Schedule string `json:"schedule,omitempty"`

	ModWindow    string `json:"modWindow,omitempty"`
	Transfers    int    `json:"transfers,omitempty"`
	EmptyDirs    *bool  `json:"emptyDirs,omitempty"`
	Metadata     *bool  `json:"metadata,omitempty"`
	BrakePercent *int   `json:"brakePercent,omitempty"`
	BrakeFloor   *int   `json:"brakeFloor,omitempty"`
	QuietPeriod  string `json:"quietPeriod,omitempty"`

	// KeepVersions applies to every job that leaves it at zero. See applyTo
	// for why a job cannot turn it off.
	KeepVersions int `json:"keepVersions,omitempty"`

	// FoldCase overrides what the two backends say about case sensitivity.
	// The engine folds when either side cannot tell "Bild.jpg" from
	// "bild.jpg", but a Windows share mounted on Linux reports itself
	// case-sensitive and is not, and the pair then grows by one file per run.
	// It is decided per pair, because one folding side against a matching that
	// does not fold makes the engine oscillate.
	FoldCase *bool `json:"foldCase,omitempty"`
}

// applyTo fills in what a job left unset. A job that states a value keeps it,
// including when what it states is the zero one.
func (d Defaults) applyTo(j *Job) {
	if j.Direction == "" {
		j.Direction = d.Direction
	}
	if j.Mode == "" {
		j.Mode = d.Mode
	}
	if j.Schedule == "" {
		j.Schedule = d.Schedule
	}
	if j.ModWindow == "" {
		j.ModWindow = d.ModWindow
	}
	if j.Transfers == 0 {
		j.Transfers = d.Transfers
	}
	if j.QuietPeriod == "" {
		j.QuietPeriod = d.QuietPeriod
	}
	if j.EmptyDirs == nil {
		j.EmptyDirs = d.EmptyDirs
	}
	if j.Metadata == nil {
		j.Metadata = d.Metadata
	}
	if j.BrakePercent == nil {
		j.BrakePercent = d.BrakePercent
	}
	if j.BrakeFloor == nil {
		j.BrakeFloor = d.BrakeFloor
	}
	if j.FoldCase == nil {
		j.FoldCase = d.FoldCase
	}
	// Zero means both off and unset here, so a job cannot turn versioning off
	// against a default that turns it on. Setting 1 keeps only the version
	// about to be overwritten.
	if j.KeepVersions == 0 {
		j.KeepVersions = d.KeepVersions
	}
}

// retiredFields names fields that older versions wrote and this one does not
// understand. Load strips them before the strict decoder, which would
// otherwise refuse a file the program wrote itself. The list is closed so the
// unknown-field check still catches a typo such as "excludes" for "exclude".
var retiredFields = map[string]bool{
	// A per-job choice of which side wins the very first run.
	"firstRun": true,
}

// withoutRetired removes retired field names anywhere in a raw configuration
// and reports which ones it found. An unparseable document comes back
// untouched, so the decoder reports the real error.
func withoutRetired(data []byte) ([]byte, []string) {
	var doc any
	if err := json.Unmarshal(data, &doc); err != nil {
		return data, nil
	}
	var found []string
	var walk func(any) any
	walk = func(node any) any {
		switch v := node.(type) {
		case map[string]any:
			for key := range v {
				if retiredFields[key] {
					delete(v, key)
					found = append(found, key)
					continue
				}
				v[key] = walk(v[key])
			}
			return v
		case []any:
			for i := range v {
				v[i] = walk(v[i])
			}
			return v
		}
		return node
	}
	walk(doc)
	if len(found) == 0 {
		return data, nil
	}
	out, err := json.Marshal(doc)
	if err != nil {
		return data, nil
	}
	sort.Strings(found)
	return out, found
}

// Retired reports the retired fields found in the file this was loaded from.
func (c *Config) Retired() []string { return c.retired }

// Load reads and validates a configuration file. Everything is checked here,
// so a bad cron expression fails at start rather than when the job first runs.
func Load(path string) (*Config, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("read config: %w", err)
	}
	var cfg Config
	cleaned, dropped := withoutRetired(data)
	dec := json.NewDecoder(strings.NewReader(string(cleaned)))
	dec.DisallowUnknownFields()
	if err := dec.Decode(&cfg); err != nil {
		return nil, fmt.Errorf("parse %s: %w", path, err)
	}
	cfg.retired = dropped
	abs, err := filepath.Abs(path)
	if err != nil {
		return nil, err
	}
	cfg.dir = filepath.Dir(abs)
	cfg.path = abs
	cfg.raw = data
	if cfg.History == "" {
		cfg.History = filepath.Join(cfg.dir, "history.db")
	} else {
		cfg.History = cfg.resolve(cfg.History)
	}
	// Checked here as well as where it is applied, so the settings page cannot
	// save a value that stops the next start.
	if err := engine.ValidateBwLimit(cfg.BwLimit); err != nil {
		return nil, err
	}
	if cfg.ParallelJobs <= 0 {
		cfg.ParallelJobs = 1
	}

	// No jobs at all is valid: it is the state before the first job is created
	// and after the last one is deleted.
	seen := map[string]bool{}
	for i := range cfg.Jobs {
		j := &cfg.Jobs[i]
		// Defaults are applied before validation, so a value from the defaults
		// is checked by the same rules as one written on the job.
		cfg.Defaults.applyTo(j)
		if j.Name == "" {
			return nil, fmt.Errorf("job %d has no name", i+1)
		}
		if seen[j.Name] {
			return nil, fmt.Errorf("two jobs are both called %q; names are how a job is asked for by hand and how its history is kept apart", j.Name)
		}
		seen[j.Name] = true
		// Two of the modes delete, so an unknown spelling is refused rather
		// than quietly run as a plain copy.
		switch j.Mode {
		case "", "sync", "mirror", "move":
		default:
			return nil, fmt.Errorf("job %q says mode %q; it has to be sync, mirror or move", j.Name, j.Mode)
		}
		// Mirror and move decide which side is right, so neither can run both
		// ways, and guessing one direction would delete something.
		if j.Mode != "" && j.Mode != "sync" && plan.ParseDirection(j.Direction) == plan.Both {
			return nil, fmt.Errorf(
				"job %q is set to %s and runs both ways; %s needs a one-way direction, because it decides which side is right",
				j.Name, j.Mode, j.Mode)
		}
		// Sets are folded into the job's own list here, so nothing downstream
		// needs to know they exist.
		for _, name := range j.ExcludeSets {
			patterns, ok := cfg.ExcludeSets[name]
			if !ok {
				return nil, fmt.Errorf("job %q asks for the exclude set %q, and no set of that name is defined", j.Name, name)
			}
			j.Exclude = append(j.Exclude, patterns...)
		}
		// A disabled job may be half written, and a job with no sides at all
		// is a draft, which is what the editor's "add a job" button creates.
		// A job with only one side is refused.
		draft := j.Left == "" && j.Right == ""
		if !j.Disabled && !draft && (j.Left == "" || j.Right == "") {
			return nil, fmt.Errorf("job %q needs both a left and a right side", j.Name)
		}
		// Both sides naming the same place would scan one tree as two, and a
		// mirror or move job would act on its own source. Only the same
		// spelling is caught: a side nested in the other, or one place spelled
		// two ways by different remotes, cannot be settled by comparing
		// strings.
		if !draft && sameSide(j.Left, j.Right) {
			return nil, fmt.Errorf(
				"job %q has both sides pointing at %s, so it would be a snake eating its own tail: every file would be its own copy, and in mirror or move mode the job would act on the very place it read from",
				j.Name, j.Left)
		}
		if j.State == "" {
			return nil, fmt.Errorf("job %q needs a state database path; without one it can never tell a new file from a deleted one", j.Name)
		}
		j.State = cfg.resolve(j.State)
		if _, err := j.Options(); err != nil {
			return nil, fmt.Errorf("job %q: %w", j.Name, err)
		}
		if j.Schedule != "" {
			if _, err := ParseSchedule(j.Schedule); err != nil {
				return nil, fmt.Errorf("job %q schedule %q: %w", j.Name, j.Schedule, err)
			}
		}
		if j.WatchSettle != "" {
			if _, err := time.ParseDuration(j.WatchSettle); err != nil {
				return nil, fmt.Errorf("job %q watchSettle %q: %w", j.Name, j.WatchSettle, err)
			}
		}
		if j.Watch && j.Schedule == "" {
			return nil, fmt.Errorf("job %q watches but has no schedule; watching can miss an event and never know it did, so it needs a schedule behind it", j.Name)
		}
	}
	sort.SliceStable(cfg.Jobs, func(a, b int) bool { return cfg.Jobs[a].Name < cfg.Jobs[b].Name })
	return &cfg, nil
}

// sameSide reports whether two sides name the same place by the same name.
// Trailing separators are ignored, since /fotos and /fotos/ are the same folder
// to every backend. Case is not folded, because the job's fold-case answer is
// not known this early.
func sameSide(left, right string) bool {
	trim := func(s string) string {
		s = strings.TrimSpace(s)
		// A lone separator is a real path (`/`), so it keeps its character.
		for len(s) > 1 && (strings.HasSuffix(s, "/") || strings.HasSuffix(s, `\`)) {
			s = s[:len(s)-1]
		}
		return s
	}
	left, right = trim(left), trim(right)
	return left != "" && left == right
}

// resolve makes a relative path in the file relative to the file itself, not
// to the directory the daemon started in.
func (c *Config) resolve(p string) string {
	if p == "" || filepath.IsAbs(p) {
		return p
	}
	return filepath.Join(c.dir, p)
}

// Dir is the directory the configuration was read from.
func (c *Config) Dir() string { return c.dir }

// Find returns the job with this name.
func (c *Config) Find(name string) (Job, bool) {
	for _, j := range c.Jobs {
		if j.Name == name {
			return j, true
		}
	}
	return Job{}, false
}

// ParseSchedule accepts standard five-field cron and the @every and @daily
// shorthands. Seconds are not enabled: a job that has to react within seconds
// wants file watching, not a faster cron.
func ParseSchedule(spec string) (cron.Schedule, error) {
	return cron.ParseStandard(spec)
}

// Options turns a job's settings into what the engine takes, filling in the
// defaults for everything left out.
func (j Job) Options() (engine.Options, error) {
	compare := plan.DefaultOptions()
	compare.Direction = plan.ParseDirection(j.Direction)
	compare.Mode = plan.ParseMode(j.Mode)

	if j.QuietPeriod != "" {
		d, err := time.ParseDuration(j.QuietPeriod)
		if err != nil {
			return engine.Options{}, fmt.Errorf("quietPeriod %q: %w", j.QuietPeriod, err)
		}
		compare.QuietPeriod = d
	}
	if j.ModWindow != "" {
		d, err := time.ParseDuration(j.ModWindow)
		if err != nil {
			return engine.Options{}, fmt.Errorf("modWindow %q: %w", j.ModWindow, err)
		}
		compare.ModWindow = d
	}
	if j.Transfers > 0 {
		compare.Transfers = j.Transfers
	}
	if j.BrakePercent != nil {
		compare.BrakePercent = *j.BrakePercent
	}
	if j.BrakeFloor != nil {
		compare.BrakeFloor = *j.BrakeFloor
	}

	// Named sets were merged into Exclude at load, so this also works on a Job
	// built without a Config.
	patterns := append([]string(nil), j.Exclude...)
	if !j.NoDefaultExcludes {
		patterns = append(patterns, filter.InProgress...)
	}
	excl, err := filter.New(patterns)
	if err != nil {
		return engine.Options{}, err
	}

	return engine.Options{
		Compare:   compare,
		Exclude:   excl,
		EmptyDirs: j.EmptyDirs != nil && *j.EmptyDirs,
		Metadata:  j.Metadata != nil && *j.Metadata,
		// Nil means ask the backends.
		ForceFoldCase: j.FoldCase,
	}, nil
}

// SettleFor returns how long this job's watcher waits for quiet.
func (j Job) SettleFor() time.Duration {
	if j.WatchSettle == "" {
		return 2 * time.Second
	}
	d, err := time.ParseDuration(j.WatchSettle)
	if err != nil {
		return 2 * time.Second
	}
	return d
}

// Raw returns the configuration file exactly as it was read. The editor works
// on these bytes, so unknown fields survive and relative paths stay relative.
func (c *Config) Raw() []byte { return append([]byte(nil), c.raw...) }

// Path is where the configuration was read from.
func (c *Config) Path() string { return c.path }

// SaveJobs writes a new set of jobs back over the configuration file. The
// result goes through Load before it replaces anything, so the editor cannot
// save a file the daemon would refuse.
func (c *Config) SaveJobs(jobs []map[string]any) (*Config, error) {
	return c.save(func(doc map[string]any) { doc["jobs"] = jobs })
}

// SaveSettings writes the top-level keys other than the job list, such as the
// bandwidth limit, parallelism, history and notifications. A key whose value
// arrives empty is deleted rather than written as "", so it cannot override a
// default later.
func (c *Config) SaveSettings(settings map[string]any) (*Config, error) {
	return c.save(func(doc map[string]any) {
		for k, v := range settings {
			if k == "jobs" {
				// A caller handing back the whole document would otherwise
				// drop a job added in another window.
				continue
			}
			if isBlank(v) {
				delete(doc, k)
				continue
			}
			doc[k] = v
		}
	})
}

// isBlank reports whether a value carries no setting at all.
func isBlank(v any) bool {
	switch t := v.(type) {
	case nil:
		return true
	case string:
		return t == ""
	case float64:
		return t == 0
	case map[string]any:
		return len(t) == 0
	}
	return false
}

// Replace writes a whole configuration document over this one, to restore a
// backup. It takes bytes so keys this build does not know survive, and the
// result is validated by Load like every other write.
func (c *Config) Replace(doc []byte) (*Config, error) {
	// Parsed here only to give a clear error for something that is not JSON.
	var probe map[string]any
	if err := json.Unmarshal(doc, &probe); err != nil {
		return nil, fmt.Errorf("this is not a configuration file: %w", err)
	}
	return c.save(func(into map[string]any) {
		for k := range into {
			delete(into, k)
		}
		for k, v := range probe {
			into[k] = v
		}
	})
}

// SettingsAsMap returns the file's top-level keys apart from the jobs.
func (c *Config) SettingsAsMap() (map[string]any, error) {
	var doc map[string]any
	if err := json.Unmarshal(c.raw, &doc); err != nil {
		return nil, fmt.Errorf("re-read the configuration: %w", err)
	}
	delete(doc, "jobs")
	if doc == nil {
		doc = map[string]any{}
	}
	return doc, nil
}

// save applies one edit to the document, writes the result beside the real
// file, validates it with Load and only then renames it into place, so a crash
// or a refused edit leaves the old file intact.
func (c *Config) save(edit func(map[string]any)) (*Config, error) {
	var doc map[string]any
	if err := json.Unmarshal(c.raw, &doc); err != nil {
		return nil, fmt.Errorf("re-read the configuration: %w", err)
	}
	if doc == nil {
		doc = map[string]any{}
	}
	edit(doc)

	next, err := json.MarshalIndent(doc, "", "  ")
	if err != nil {
		return nil, fmt.Errorf("write the configuration: %w", err)
	}
	next = append(next, '\n')

	tmp := c.path + ".checking"
	if err := os.WriteFile(tmp, next, 0o644); err != nil {
		return nil, fmt.Errorf("write %s: %w", tmp, err)
	}
	defer os.Remove(tmp)

	if _, err := Load(tmp); err != nil {
		return nil, err
	}

	if err := os.Rename(tmp, c.path); err != nil {
		return nil, fmt.Errorf("replace %s: %w", c.path, err)
	}
	return Load(c.path)
}

// JobsAsMaps returns the jobs as they stand in the file, for editing.
func (c *Config) JobsAsMaps() ([]map[string]any, error) {
	var doc struct {
		Jobs []map[string]any `json:"jobs"`
	}
	if err := json.Unmarshal(c.raw, &doc); err != nil {
		return nil, fmt.Errorf("re-read the configuration: %w", err)
	}
	return doc.Jobs, nil
}
