package web

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"runtime"
	"strconv"
	"strings"
	"time"

	"github.com/rclone/rclone/fs"

	"github.com/junkerderprovinz/arrowloop/internal/anomaly"
	"github.com/junkerderprovinz/arrowloop/internal/boot"
	"github.com/junkerderprovinz/arrowloop/internal/failure"
	"github.com/junkerderprovinz/arrowloop/internal/history"
	"github.com/junkerderprovinz/arrowloop/internal/releasenotes"
	"github.com/junkerderprovinz/arrowloop/internal/scrub"
)

// releaseAPI is where the update check asks when the server names nothing else.
const releaseAPI = "https://api.github.com"

const releaseRepo = "junkerderprovinz/arrowloop"

// The reasons an update check could not run, as codes the page translates.
const (
	checkDevBuild    = "dev-build"
	checkOffline     = "offline"
	checkRateLimited = "rate-limited"
	checkBadResponse = "bad-response"
)

type versions struct {
	ArrowLoop string `json:"arrowloop"`
	Rclone    string `json:"rclone"`
	Go        string `json:"go"`
}

func currentVersions() versions {
	// VersionTag rather than Version, which carries a "-DEV" suffix whenever
	// rclone is built as a library.
	return versions{ArrowLoop: boot.Version, Rclone: fs.VersionTag, Go: runtime.Version()}
}

func (s *Server) versions(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, currentVersions())
}

func (s *Server) releaseNotes(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{"notes": releasenotes.UpTo(boot.Version)})
}

// updateCheck is the answer to one press of "Check for updates".
type updateCheck struct {
	Current         string `json:"current"`
	Latest          string `json:"latest"`
	UpdateAvailable bool   `json:"updateAvailable"`
	ReleaseURL      string `json:"releaseUrl"`
}

// checkUpdate runs only when somebody presses the button, so the engine asks
// the outside about itself at no other time.
func (s *Server) checkUpdate(w http.ResponseWriter, r *http.Request) {
	api := s.Releases
	if api == "" {
		api = releaseAPI
	}
	got, code, err := latestRelease(r.Context(), api, boot.Version)
	if err != nil {
		s.logf("update check: %v", err)
		writeJSON(w, http.StatusBadGateway, map[string]string{"code": code, "error": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, got)
}

var releaseClient = &http.Client{Timeout: 10 * time.Second}

func latestRelease(ctx context.Context, api, running string) (updateCheck, string, error) {
	current, ok := releaseVersion(running)
	if !ok {
		return updateCheck{}, checkDevBuild, fmt.Errorf("this build carries no release version (%q)", running)
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, api+"/repos/"+releaseRepo+"/releases/latest", nil)
	if err != nil {
		return updateCheck{}, checkOffline, err
	}
	req.Header.Set("Accept", "application/vnd.github+json")
	req.Header.Set("User-Agent", "ArrowLoop/"+strings.TrimPrefix(running, "v"))
	resp, err := releaseClient.Do(req)
	if err != nil {
		return updateCheck{}, checkOffline, fmt.Errorf("GitHub could not be reached: %w", err)
	}
	defer resp.Body.Close()

	if rateLimited(resp) {
		return updateCheck{}, checkRateLimited, fmt.Errorf("GitHub is limiting this address (HTTP %d)", resp.StatusCode)
	}
	if resp.StatusCode != http.StatusOK {
		return updateCheck{}, checkBadResponse, fmt.Errorf("GitHub answered HTTP %d", resp.StatusCode)
	}
	var release struct {
		TagName string `json:"tag_name"`
		HTMLURL string `json:"html_url"`
	}
	if err := json.NewDecoder(io.LimitReader(resp.Body, 1<<20)).Decode(&release); err != nil {
		return updateCheck{}, checkBadResponse, fmt.Errorf("GitHub's answer is not a release: %w", err)
	}
	// The tag ends up in a link on the page, so only a plain version is taken.
	latest, ok := releaseVersion(release.TagName)
	if !ok {
		return updateCheck{}, checkBadResponse, fmt.Errorf("the newest release carries no version (%q)", release.TagName)
	}
	return updateCheck{
		Current:         running,
		Latest:          release.TagName,
		UpdateAvailable: compareVersions(latest, current) > 0,
		ReleaseURL:      "https://github.com/" + releaseRepo + "/releases/tag/" + release.TagName,
	}, "", nil
}

// rateLimited tells GitHub's rate limit from any other refusal; GitHub answers
// 403 for both.
func rateLimited(resp *http.Response) bool {
	switch resp.StatusCode {
	case http.StatusTooManyRequests:
		return true
	case http.StatusForbidden:
		return resp.Header.Get("X-RateLimit-Remaining") == "0" || resp.Header.Get("Retry-After") != ""
	}
	return false
}

// releaseVersion reads "v1.2.3" or "1.2.3". A pre-release, a commit hash and
// "dev" are not releases and compare with nothing.
func releaseVersion(s string) ([3]int, bool) {
	var v [3]int
	parts := strings.Split(strings.TrimPrefix(s, "v"), ".")
	if len(parts) != 3 {
		return v, false
	}
	for i, p := range parts {
		n, err := strconv.Atoi(p)
		if err != nil || n < 0 {
			return v, false
		}
		v[i] = n
	}
	return v, true
}

func compareVersions(a, b [3]int) int {
	for i := range a {
		if a[i] != b[i] {
			if a[i] > b[i] {
				return 1
			}
			return -1
		}
	}
	return 0
}

// reportJob is a job as the bug report shows it: what it syncs and when, and
// none of its hooks, whose commands can carry a password.
type reportJob struct {
	Name      string `json:"name"`
	Left      string `json:"left"`
	Right     string `json:"right"`
	Direction string `json:"direction,omitempty"`
	Mode      string `json:"mode,omitempty"`
	Schedule  string `json:"schedule,omitempty"`
	Watch     bool   `json:"watch,omitempty"`
	Disabled  bool   `json:"disabled,omitempty"`
}

// reportFinding is a finding without the names of its files, which are
// somebody's own. How many there are is what a bug needs.
type reportFinding struct {
	anomaly.Finding
	Files int `json:"files,omitempty"`
}

type report struct {
	Made     time.Time       `json:"made"`
	Versions versions        `json:"versions"`
	System   string          `json:"system"`
	Desktop  bool            `json:"desktop"`
	Settings map[string]any  `json:"settings"`
	Jobs     []reportJob     `json:"jobs"`
	Runs     []history.Run   `json:"runs"`
	Findings []reportFinding `json:"findings"`
}

// reportRuns is how far back the report reaches. A failure that matters is
// almost always among the last runs, and the file stays small enough to attach.
const reportRuns = 100

// diagnostics hands out one file for a bug report: the versions, the settings
// and jobs without their secrets, the last runs and the open findings. The
// file goes into a public issue, so every free text in it is scrubbed.
func (s *Server) diagnostics(w http.ResponseWriter, r *http.Request) {
	cfg := s.Runner.Config()
	settings, err := cfg.SettingsAsMap()
	if err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	runs, err := s.History.Recent(r.Context(), "", history.ShowAll, reportRuns)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	open, _ := s.Runner.Findings(r.Context())
	clean := scrub.Knowing(cfg.Jobs)

	out := report{
		Made:     time.Now().UTC(),
		Versions: currentVersions(),
		System:   runtime.GOOS + "/" + runtime.GOARCH,
		Desktop:  s.Window != nil,
		Settings: withoutHomeInSettings(withheld(settings)),
		Jobs:     make([]reportJob, 0, len(cfg.Jobs)),
		Runs:     make([]history.Run, 0, len(runs)),
		Findings: make([]reportFinding, 0, len(open)),
	}
	for _, j := range cfg.Jobs {
		out.Jobs = append(out.Jobs, reportJob{
			Name: j.Name, Left: scrub.Side(j.Left), Right: scrub.Side(j.Right),
			Direction: j.Direction, Mode: j.Mode, Schedule: j.Schedule, Watch: j.Watch, Disabled: j.Disabled,
		})
	}
	for _, run := range runs {
		run.Err = clean(run.Err)
		out.Runs = append(out.Runs, run)
	}
	for _, f := range open {
		files := len(f.Paths)
		f.Paths = nil
		f.Detail = clean(f.Detail)
		if f.Kind == anomaly.Failing {
			f.Failure = failure.Of(f.Detail)
		}
		out.Findings = append(out.Findings, reportFinding{Finding: f, Files: files})
	}

	name := "arrowloop-report-" + out.Made.Format("2006-01-02") + ".json"
	w.Header().Set("Content-Disposition", `attachment; filename="`+name+`"`)
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	enc := json.NewEncoder(w)
	enc.SetIndent("", "  ")
	_ = enc.Encode(out)
}

// withoutHomeInSettings takes the home folder out of the settings that hold
// paths: where the run log is kept and the shared exclude lists.
func withoutHomeInSettings(settings map[string]any) map[string]any {
	for key, value := range settings {
		switch {
		case strings.EqualFold(key, "history"):
			if p, ok := value.(string); ok {
				settings[key] = scrub.Home(p)
			}
		case strings.EqualFold(key, "excludeSets"):
			sets, _ := value.(map[string]any)
			for _, patterns := range sets {
				list, _ := patterns.([]any)
				for i, p := range list {
					if p, ok := p.(string); ok {
						list[i] = scrub.Home(p)
					}
				}
			}
		}
	}
	return settings
}
