// Package job turns a configuration file into runnable sync jobs.
//
// Up to here the engine had one job, described entirely by command-line flags.
// That is the right shape for proving an engine and the wrong shape for using
// one: a person with a photo folder, a documents folder and a server backup has
// three jobs with different schedules, different filters and different ideas
// about what may be deleted, and none of that survives in a shell history.
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

	"github.com/junkerderprovinz/reeveroll/internal/engine"
	"github.com/junkerderprovinz/reeveroll/internal/filter"
	"github.com/junkerderprovinz/reeveroll/internal/plan"
)

// Config is the whole file.
type Config struct {
	Jobs []Job `json:"jobs"`

	// History is where run records go. Empty means alongside the config file.
	History string `json:"history,omitempty"`

	// BwLimit is process-wide and not per job, because rclone's token bucket
	// is. Two jobs on one machine share one uplink, so a per-job limit would be
	// a promise the mechanism underneath cannot keep. rclone's own syntax, so
	// "1M" or a timetable like "08:00,512k 19:00,off".
	BwLimit string `json:"bwlimit,omitempty"`

	// ParallelJobs is how many jobs may run at once. One by default, and that
	// is a deliberate default rather than a limitation: two jobs running at the
	// same time share one line and one disk, so they mostly slow each other
	// down while making the log harder to read.
	ParallelJobs int `json:"parallelJobs,omitempty"`

	Notify Notify `json:"notify,omitempty"`

	// dir is where the file was read from, so relative paths inside it mean
	// what the person writing it expected.
	dir string
}

// Notify says where a run reports to.
type Notify struct {
	Matrix  *Matrix `json:"matrix,omitempty"`
	Webhook string  `json:"webhook,omitempty"`

	// OnSuccess sends a message for every run, not only for failures. Off by
	// default: a sync tool that reports success every fifteen minutes trains
	// its user to ignore it, and then the one message that mattered is ignored
	// too.
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

	// Schedule is a cron expression. Empty means the job only ever runs when
	// somebody asks for it by name.
	Schedule string `json:"schedule,omitempty"`

	// Watch runs the job when a local side changes, instead of waiting for the
	// next tick. It does NOT replace the schedule and is not meant to: only a
	// local side can be watched at all, and a watcher that missed an event has
	// no way to know it did. The schedule stays as the thing that eventually
	// notices what the watcher did not.
	Watch bool `json:"watch,omitempty"`

	// WatchSettle is how long the tree must go quiet before a change counts.
	// Copying a folder in produces one event per file, and a run per event
	// would be a thousand runs for one action.
	WatchSettle string `json:"watchSettle,omitempty"`

	Disabled bool `json:"disabled,omitempty"`

	Exclude           []string `json:"exclude,omitempty"`
	NoDefaultExcludes bool     `json:"noDefaultExcludes,omitempty"`

	QuietPeriod string `json:"quietPeriod,omitempty"`
	ModWindow   string `json:"modWindow,omitempty"`
	Transfers   int    `json:"transfers,omitempty"`
	EmptyDirs   bool   `json:"emptyDirs,omitempty"`
	Metadata    bool   `json:"metadata,omitempty"`

	// BrakePercent and BrakeFloor are pointers so that "0" can be told apart
	// from "not set". Zero switches the mass-delete brake off entirely, and
	// that has to be something somebody typed on purpose rather than something
	// they got by leaving a field out.
	BrakePercent *int `json:"brakePercent,omitempty"`
	BrakeFloor   *int `json:"brakeFloor,omitempty"`
}

// Load reads and validates a configuration file.
//
// Everything is checked here rather than when a job first runs. A typo in a
// cron expression that only surfaces at three in the morning, on the one job
// that mattered, is the kind of failure a daemon must not have.
func Load(path string) (*Config, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("read config: %w", err)
	}
	var cfg Config
	dec := json.NewDecoder(strings.NewReader(string(data)))
	dec.DisallowUnknownFields()
	if err := dec.Decode(&cfg); err != nil {
		return nil, fmt.Errorf("parse %s: %w", path, err)
	}
	abs, err := filepath.Abs(path)
	if err != nil {
		return nil, err
	}
	cfg.dir = filepath.Dir(abs)
	if cfg.History == "" {
		cfg.History = filepath.Join(cfg.dir, "history.db")
	} else {
		cfg.History = cfg.resolve(cfg.History)
	}
	if cfg.ParallelJobs <= 0 {
		cfg.ParallelJobs = 1
	}

	if len(cfg.Jobs) == 0 {
		return nil, fmt.Errorf("%s defines no jobs", path)
	}
	seen := map[string]bool{}
	for i := range cfg.Jobs {
		j := &cfg.Jobs[i]
		if j.Name == "" {
			return nil, fmt.Errorf("job %d has no name", i+1)
		}
		if seen[j.Name] {
			return nil, fmt.Errorf("two jobs are both called %q; names are how a job is asked for by hand and how its history is kept apart", j.Name)
		}
		seen[j.Name] = true
		if j.Left == "" || j.Right == "" {
			return nil, fmt.Errorf("job %q needs both a left and a right side", j.Name)
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
			// Not fatal, but worth refusing: a watch-only job on a tree the
			// watcher cannot fully cover would look like it was running and
			// quietly not be. The schedule is the backstop that makes watching
			// an optimisation rather than the only mechanism.
			return nil, fmt.Errorf("job %q watches but has no schedule; watching can miss an event and never know it did, so it needs a schedule behind it", j.Name)
		}
	}
	sort.SliceStable(cfg.Jobs, func(a, b int) bool { return cfg.Jobs[a].Name < cfg.Jobs[b].Name })
	return &cfg, nil
}

// resolve makes a path in the file mean what its author meant: relative to the
// file itself, not to whatever directory the daemon happened to start in.
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

// ParseSchedule accepts standard five-field cron, the usual @every and @daily
// shorthands, and nothing else.
//
// Seconds are deliberately not enabled. A sync job that runs every few seconds
// is not a schedule, it is a busy loop over two filesystems, and the answer to
// wanting one is file watching rather than a faster cron.
func ParseSchedule(spec string) (cron.Schedule, error) {
	return cron.ParseStandard(spec)
}

// Options turns a job's settings into what the engine takes, filling in the
// defaults for everything left out.
func (j Job) Options() (engine.Options, error) {
	compare := plan.DefaultOptions()

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
		EmptyDirs: j.EmptyDirs,
		Metadata:  j.Metadata,
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
