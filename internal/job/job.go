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

	"github.com/junkerderprovinz/arrowloop/internal/engine"
	"github.com/junkerderprovinz/arrowloop/internal/filter"
	"github.com/junkerderprovinz/arrowloop/internal/plan"
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

	// HistoryKeep is how long a run record is kept. Empty means ninety days,
	// and "0" keeps them for ever.
	//
	// It exists because the log only used to be pruned at STARTUP, from a
	// command-line flag. That is fine for a desktop install somebody restarts
	// and useless for the case this program is mostly used in: a container that
	// runs for months. A job watching a folder writes a record on every change
	// and on every scheduled turn besides, so the file grows without limit and
	// the one thing that would trim it never runs. Now the runner prunes on a
	// daily turn of its own, and the setting lives in the file where the rest of
	// the engine's settings are rather than in a flag nobody passes twice.
	HistoryKeep string `json:"historyKeep,omitempty"`

	// ParallelJobs is how many jobs may run at once. One by default, and that
	// is a deliberate default rather than a limitation: two jobs running at the
	// same time share one line and one disk, so they mostly slow each other
	// down while making the log harder to read.
	ParallelJobs int `json:"parallelJobs,omitempty"`

	Notify Notify `json:"notify,omitempty"`

	// Defaults fill in per-job settings that a job does not set for itself.
	// Applied once at load, so everything downstream sees a job whose fields
	// are already resolved and no code has to remember to ask twice.
	Defaults Defaults `json:"defaults,omitempty"`

	// ExcludeSets are reusable pattern lists, by name. A job asks for them by
	// name instead of carrying its own copy of the same twenty lines.
	ExcludeSets map[string][]string `json:"excludeSets,omitempty"`

	// dir is where the file was read from, so relative paths inside it mean
	// what the person writing it expected.
	dir string
	// path is the file itself, and raw is its exact content, both kept so the
	// editor can write the file back without losing anything it did not touch.
	path string
	raw  []byte
}

// KeepHistoryFor is HistoryKeep as a duration, with the default applied.
//
// Zero means for ever, which is why this returns a second value rather than
// using zero as "unset": those are opposite intentions and a single duration
// cannot tell them apart.
func (c *Config) KeepHistoryFor() (time.Duration, bool) {
	raw := strings.TrimSpace(c.HistoryKeep)
	if raw == "" {
		return 90 * 24 * time.Hour, true
	}
	d, err := time.ParseDuration(raw)
	if err != nil || d < 0 {
		// Unparseable is treated as the default rather than as "for ever": a
		// typo must not quietly switch off the thing that keeps the file from
		// growing without limit.
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

	// RunAtStart runs the job once as soon as the program starts, before
	// waiting for the first tick of its schedule.
	//
	// It exists because of what a schedule cannot say. A machine that was off
	// overnight missed every turn a daily job had, and the job's next run is
	// tomorrow: the sides stay apart for a whole day for no reason other than
	// the clock. This is also the setting that makes autostart worth switching
	// on, since a program that starts with the session and then sits there
	// until 03:00 has not helped anybody who just turned their computer on.
	//
	// It fires ONCE per program start, never on a configuration reload, so
	// editing a job in the interface does not set every job in the file running.
	RunAtStart bool `json:"runAtStart,omitempty"`

	Disabled bool `json:"disabled,omitempty"`

	// FirstRun says which side is right the ONE time this job has no record yet.
	//
	// It exists because the first run is the one that decides everything and is
	// the one nobody is asked about. With no record, every file on both sides is
	// new, so the engine merges: everything on the left arrives on the right and
	// the other way round. That is the safe default and it is often not what
	// somebody wanted, and by the time they notice, the other side is full of
	// files they meant to leave behind.
	//
	// Empty is the merge, which is what every job did before this existed.
	// "left" or "right" seeds from that side instead, and it is deliberately the
	// same rule a one-way job follows: the source wins every disagreement, and a
	// file the source never had is LEFT ALONE rather than deleted. Deleting
	// something the chosen side never knew about would not be propagating a
	// decision, it would be making one, on the run somebody understands least.
	//
	// It applies once. The moment a record exists this is ignored, so a setting
	// left in the file cannot quietly turn a two-way job into a one-way one.
	FirstRun string `json:"firstRun,omitempty"`

	// KeepVersions keeps the last N contents of a file that gets overwritten,
	// under the same reserved directory the trash uses.
	//
	// Off by default, and the default is the honest one: most jobs move files
	// that are never edited in place, and keeping a copy of every overwrite on
	// those would quietly double the tree. It exists for the folder somebody
	// edits the same documents in every day, where the bin catches a deletion
	// and catches nothing at all about the version from Tuesday.
	KeepVersions int `json:"keepVersions,omitempty"`

	// ReportOnly plans on every automatic turn and applies nothing.
	//
	// The comparison is the expensive half of a run and the half worth watching:
	// both sides are listed, every difference is worked out, and the result goes
	// into the run log. Nothing moves. A job left like this says what it WOULD
	// do, every quarter of an hour, for as long as you leave it - which is what
	// makes it useful for watching a job at work without letting it work.
	//
	// Automatic turns only. A run somebody starts by hand applies normally,
	// because a person pressing the button has decided, exactly as with the
	// conditions in RunAutomatically. The runner already said this in a comment
	// that pointed at a field which did not exist yet; the interface's own type
	// has been offering `reportOnly` for as long, and the configuration refused
	// it with "unknown field".
	ReportOnly bool `json:"reportOnly,omitempty"`

	// NoTrash deletes outright instead of moving into the side's own trash.
	//
	// Spelled as the NEGATIVE so that the zero value is the safe one. A field
	// called `trash` would be false in every configuration written before it
	// existed and in every one where somebody forgot it, and false would then
	// mean "destroy things" - which is the failure mode a two-way sync can least
	// afford to have as a default.
	//
	// It exists because the trash is visible. It lives inside the synced tree
	// under a reserved prefix, so a shared download folder grows an `.arrowloop`
	// directory that everybody using that share can see, and jdp asked the
	// obvious question about it: "braucht es den .arrowloop ordner im
	// Zielordner? Kann man den nicht weglassen?" With this on, nothing is ever
	// moved under the prefix and the folder is never created.
	//
	// What it costs is stated plainly in the interface rather than softened:
	// with no trash a deletion is final, and so is the losing side of a
	// conflict. That is a reasonable trade for a folder of downloads and a bad
	// one for a folder of documents, which is exactly why it is per job.
	NoTrash bool `json:"noTrash,omitempty"`

	Exclude           []string `json:"exclude,omitempty"`
	NoDefaultExcludes bool     `json:"noDefaultExcludes,omitempty"`

	// ExcludeSets names reusable pattern lists defined once at the top of the
	// file, so "the usual junk" is written in one place instead of being pasted
	// into every job and then drifting apart. A job's own Exclude list is added
	// to whatever the sets bring rather than replacing it: the sets are the
	// shared part and the list is what makes THIS job different.
	//
	// A name that no set defines is an error at load rather than an empty list.
	// A filter that silently matches nothing is the worst possible failure mode
	// here: it does not break anything, it just quietly syncs the thing somebody
	// asked to leave alone.
	ExcludeSets []string `json:"excludeSets,omitempty"`

	// Direction says which way this job is allowed to write: "both" (the
	// default and what this program is for), "leftToRight" or "rightToLeft".
	//
	// A one-way job still compares both sides, because comparing is how it
	// knows what changed. What the direction changes is what it may DO with
	// the answer.
	Direction string `json:"direction,omitempty"`

	// Mode is what a ONE-WAY job does beyond copying: "sync" (the default,
	// which deletes nothing of its own), "mirror" (the destination becomes an
	// exact copy, so a file the source never had is removed there) or "move"
	// (a file leaves the source once it has landed on the other side).
	//
	// It is a second field rather than three more directions because it is a
	// second question. A tool people compare this one against ships seven named
	// modes, which are these two axes wearing seven names; keeping them apart
	// is what stops the list growing to fifteen entries the day a third
	// question turns up.
	Mode string `json:"mode,omitempty"`

	QuietPeriod string `json:"quietPeriod,omitempty"`
	ModWindow   string `json:"modWindow,omitempty"`
	Transfers   int    `json:"transfers,omitempty"`

	// EmptyDirs and Metadata are pointers for the same reason the two brakes
	// below are: a plain bool cannot tell "off" from "not mentioned", and the
	// file now carries defaults that fill in what a job does not say. Left as
	// plain bools, a job that deliberately switched one OFF would have it
	// switched back on by the default, and nothing would say so.
	EmptyDirs *bool `json:"emptyDirs,omitempty"`
	Metadata  *bool `json:"metadata,omitempty"`

	// BrakePercent and BrakeFloor are pointers so that "0" can be told apart
	// from "not set". Zero switches the mass-delete brake off entirely, and
	// that has to be something somebody typed on purpose rather than something
	// they got by leaving a field out.
	BrakePercent *int `json:"brakePercent,omitempty"`
	BrakeFloor   *int `json:"brakeFloor,omitempty"`

	// FoldCase overrides the backends' own answer about case sensitivity for
	// this one job. See Defaults.FoldCase for why a backend's answer is not
	// always to be believed.
	FoldCase *bool `json:"foldCase,omitempty"`
}

// Defaults fill in the per-job settings a job does not set for itself.
//
// They exist because these settings had to become visible and the job form was
// already the thing jdp asked to simplify ("fuer was muessen hier so wahnsinnig
// viele eingabefelder sein"). Both asks are right and they point the same way:
// the answer that is usually the same for every job belongs in one place, and
// the job keeps only what makes IT different.
//
// The brakes are the reason this matters rather than a convenience. They are
// the safety net that stops a run removing more than half of everything it
// knows about, and until now they could not be seen at all, let alone set once
// for every job.
//
// Every field is a pointer or a zero-means-unset type, so "the default says on
// and this job says off" is a sentence the file can express.
type Defaults struct {
	// Direction and Mode are here because they are the pair somebody sets once
	// for a whole phone - "everything goes up, and the space comes back" - and
	// then wants every new job to start from. A job that names either keeps its
	// own answer.
	Direction string `json:"direction,omitempty"`
	Mode      string `json:"mode,omitempty"`

	// Schedule, for the same reason: "every night at three" is a decision
	// about a machine far more often than about one folder.
	//
	// Watch and NoTrash are deliberately NOT here. Both are plain bools on the
	// job, so "off" and "not mentioned" are the same value, and a default that
	// switched either ON could never be switched off again for one job - which
	// on NoTrash means losing the bins on a job that asked to keep them. The
	// fix is to make those two pointers on the Job as well, and that is a
	// change worth making on its own rather than as a side effect of adding
	// defaults.
	Schedule string `json:"schedule,omitempty"`

	ModWindow    string `json:"modWindow,omitempty"`
	Transfers    int    `json:"transfers,omitempty"`
	EmptyDirs    *bool  `json:"emptyDirs,omitempty"`
	Metadata     *bool  `json:"metadata,omitempty"`
	BrakePercent *int   `json:"brakePercent,omitempty"`
	BrakeFloor   *int   `json:"brakeFloor,omitempty"`

	// QuietPeriod is here too, because "wait for a file to stop changing" is
	// almost always one answer for a whole machine rather than per job.
	QuietPeriod string `json:"quietPeriod,omitempty"`

	// KeepVersions is the same setting for every job that does not say
	// otherwise. Zero means off, which is why a job wanting it off while the
	// default is on has to be able to say so, and cannot: see applyTo.
	KeepVersions int `json:"keepVersions,omitempty"`

	// FoldCase overrides what the two backends say about themselves.
	//
	// Normally nothing needs setting: the engine asks each side whether it can
	// tell "Bild.jpg" from "bild.jpg" and folds when EITHER cannot. The override
	// exists for the case where a backend lies, and they do: a network share
	// exported from Windows and mounted on Linux reports itself
	// case-sensitive and is not. Left wrong, the two sides each keep their own
	// copy of one file and the pair grows by one file per run, for ever.
	//
	// It has to be decided per PAIR rather than per side. If one side folds and
	// the matching does not, that side's two files both map onto the one file
	// over there and the engine oscillates between them.
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
	// Said plainly because it is a real limitation rather than an oversight: a
	// job CANNOT turn versioning off against a default that turns it on, since
	// zero is both "off" and "not mentioned" for a plain int. Every other
	// setting here that can be switched off is a pointer for exactly that
	// reason. This one is not, because it is a count and not a switch, and a
	// job that wants none while the default wants three can say 1 and keep the
	// one version it is about to overwrite. Turning it into a pointer is the
	// fix if that is ever not enough.
	if j.KeepVersions == 0 {
		j.KeepVersions = d.KeepVersions
	}
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
	cfg.path = abs
	cfg.raw = data
	if cfg.History == "" {
		cfg.History = filepath.Join(cfg.dir, "history.db")
	} else {
		cfg.History = cfg.resolve(cfg.History)
	}
	// The bandwidth limit is checked here rather than only where it is applied.
	// It used to be neither: a bad value saved cleanly through the settings page
	// and the program then refused to start on the next boot, with the message
	// on a console and the interface that could have shown it gone.
	if err := engine.ValidateBwLimit(cfg.BwLimit); err != nil {
		return nil, err
	}
	if cfg.ParallelJobs <= 0 {
		cfg.ParallelJobs = 1
	}

	// A configuration with no jobs is allowed, and refusing it was a real bug
	// rather than strictness.
	//
	// It is the state you are in before creating your first job and after
	// deleting your last one, and the second of those was impossible: the
	// editor sent a list with the only job removed, the validator refused it,
	// and the job came back on the next read. Reported as "den example auftrag
	// kann ich nicht löschen", which is what a delete that cannot be saved
	// looks like from the outside. The check was defensible when the file was
	// only ever hand-written; it stopped being so the moment the interface
	// could edit it.
	//
	// Nothing downstream needs a non-empty list: the scheduler with nothing to
	// schedule idles, and the interface with nothing to show says so.
	seen := map[string]bool{}
	for i := range cfg.Jobs {
		j := &cfg.Jobs[i]
		// Defaults are applied BEFORE validation, so a value that arrives from
		// the defaults is checked by exactly the same rules a value written on
		// the job is. A default that produces an invalid job must fail here and
		// not at three in the morning on the one job that mattered.
		cfg.Defaults.applyTo(j)
		if j.Name == "" {
			return nil, fmt.Errorf("job %d has no name", i+1)
		}
		if seen[j.Name] {
			return nil, fmt.Errorf("two jobs are both called %q; names are how a job is asked for by hand and how its history is kept apart", j.Name)
		}
		seen[j.Name] = true
		// Checked here rather than trusted at the moment it is used. A value
		// nobody recognises would otherwise fall through to the merge, which is
		// the exact opposite of what somebody typing "links" instead of "left"
		// meant, and they would find out by looking at the other side afterwards.
		switch j.FirstRun {
		case "", "merge", "left", "right":
		default:
			return nil, fmt.Errorf("job %q says firstRun %q; it has to be left, right or merge", j.Name, j.FirstRun)
		}
		// The mode, checked the same way and for a sharper reason: two of the
		// three DELETE. A spelling nobody recognises would fall through to the
		// mode that deletes nothing, which is the safe direction to be wrong in
		// - but somebody who wrote "spiegeln" and got a plain copy would find
		// out weeks later, from a destination full of files they thought had
		// been cleared out.
		switch j.Mode {
		case "", "sync", "mirror", "move":
		default:
			return nil, fmt.Errorf("job %q says mode %q; it has to be sync, mirror or move", j.Name, j.Mode)
		}
		// And neither of the two makes sense both ways. Mirroring both ways
		// asks each side to be the authority on what the other may keep, and
		// moving both ways is a job that empties each side into the other. A
		// job that says both is refused rather than quietly run as one of them,
		// because either guess deletes something.
		if j.Mode != "" && j.Mode != "sync" && plan.ParseDirection(j.Direction) == plan.Both {
			return nil, fmt.Errorf(
				"job %q is set to %s and runs both ways; %s needs a one-way direction, because it decides which side is right",
				j.Name, j.Mode, j.Mode)
		}
		// Named sets are folded into the job's own list here, once, so nothing
		// downstream has to know sets exist. A name nobody defined is refused
		// rather than ignored: a filter that silently matches nothing does not
		// break anything, it just quietly syncs the thing somebody asked to
		// leave alone, and that is the failure this whole feature is about.
		for _, name := range j.ExcludeSets {
			patterns, ok := cfg.ExcludeSets[name]
			if !ok {
				return nil, fmt.Errorf("job %q asks for the exclude set %q, and no set of that name is defined", j.Name, name)
			}
			j.Exclude = append(j.Exclude, patterns...)
		}
		// A job that cannot run is allowed to be half written, and there are two
		// ways to be unable to run.
		//
		// The first is being switched off. That is the state of a duplicate
		// until it is pointed somewhere else, and of any job somebody is holding.
		//
		// The second is having NO sides at all, which is what the editor's own
		// "add a job" button produces and is the reason this rule changed. A new
		// job used to arrive switched off purely so that it could be saved,
		// which meant every job anybody created announced itself as
		// "abgeschaltet" until they found a switch at the bottom of the form
		// (jdp: "das find ich total daemlich. ein auftrag soll standardmaessig
		// aktiviert sein"). A job with neither side is a draft: it has no
		// schedule either, so nothing reaches it, and pressing the button on it
		// gets the same sentence this used to refuse the whole file with.
		//
		// ONE side and not the other is still refused, switched on. That is not
		// a draft, it is a job somebody half filled in, and it is the shape that
		// runs and does something surprising.
		draft := j.Left == "" && j.Right == ""
		if !j.Disabled && !draft && (j.Left == "" || j.Right == "") {
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

	// The job's own patterns, plus whatever its named sets bring. Resolved at
	// load rather than here, so this function keeps working on a Job that was
	// built by a test without a Config around it.
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
		// Nil is "ask the backends", which is what almost every job wants. The
		// override only reaches the engine when somebody set it.
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

// Raw returns the configuration file exactly as it was read.
//
// The editor works on these bytes rather than on the parsed struct, so a field
// this version does not know about survives being edited by it, and a relative
// path stays relative instead of being rewritten as the absolute one Load
// resolved it to.
func (c *Config) Raw() []byte { return append([]byte(nil), c.raw...) }

// Path is where the configuration was read from.
func (c *Config) Path() string { return c.path }

// SaveJobs writes a new set of jobs back over the configuration file.
//
// Validation is not reimplemented here. The new content is written to a
// neighbouring temporary file and put through Load, which is the same function
// that guards a hand-written file, and only a file that survives that is moved
// into place. A second validator would eventually disagree with the first, and
// the disagreement would show up as an editor that accepts something the daemon
// then refuses to start with.
func (c *Config) SaveJobs(jobs []map[string]any) (*Config, error) {
	return c.save(func(doc map[string]any) { doc["jobs"] = jobs })
}

// SaveSettings writes the keys that are NOT the job list: the bandwidth limit,
// how many jobs may run at once, where the history lives, who gets told.
//
// Every one of these was already read by the engine and had nowhere to be set
// except the file itself, which is the reason it needs saying: the program
// could do these things and did not appear to. jdp: "Das programm sieht so
// klein und unfertig aus und wirkt als haette es keine funktionen."
//
// A key whose value arrives empty is DELETED rather than written as "". The
// difference is not cosmetic: an empty bandwidth limit means "no limit" and a
// missing one means the same thing, but an empty string written into the file
// is a value somebody hand-editing it has to wonder about, and the day one of
// these settings grows a non-empty default it would also override it.
func (c *Config) SaveSettings(settings map[string]any) (*Config, error) {
	return c.save(func(doc map[string]any) {
		for k, v := range settings {
			if k == "jobs" {
				// The one key this call may not touch. Sent by a caller that
				// read the whole document and handed it back, it would replace
				// the job list with whatever that caller last saw, which is a
				// way to lose a job added in another window.
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

// Replace writes a whole configuration document over this one.
//
// The restore half of "save your settings somewhere". It goes through the same
// write-beside-then-validate-then-rename path as every other write here, so a
// file somebody edited by hand, or one saved by a different version, fails in
// exactly the words a hand-written file would.
//
// It takes the document as bytes rather than as a parsed struct on purpose: a
// backup is only worth having if it comes back byte for byte, including the
// keys this build has never heard of.
func (c *Config) Replace(doc []byte) (*Config, error) {
	// Parsed once here purely to refuse something that is not JSON at all, with
	// a sentence about THAT rather than whatever Load would say about a file
	// full of HTML. Everything else is Load's business.
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

// save applies one edit to the document and puts the result through Load before
// it replaces anything.
//
// Shared by both callers so that a settings write gets the identical treatment
// a job write already had: written beside the real file, validated by the same
// function that guards a hand-written one, and only then renamed into place. A
// second, simpler path for "just a few small values" is how a configuration
// ends up invalid in a way only the daemon's next start reveals.
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
		// The message is the validator's own, so an editor and a hand-written
		// file fail in the same words.
		return nil, err
	}

	// A crash between these two lines leaves the old file intact, which is the
	// point of writing beside it first: a half-written configuration is a
	// daemon that will not start.
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
