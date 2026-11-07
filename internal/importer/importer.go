// Package importer turns the setup of another sync program into ArrowLoop jobs
// and targets: a FolderSync configuration export and a luckyBackup profile.
// It reads and maps only; the caller shows the plan and saves it.
package importer

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"path"
	"strconv"
	"strings"
	"unicode"

	"github.com/junkerderprovinz/arrowloop/internal/filter"
)

// The programs a file can come from.
const (
	ArrowLoop   = "ArrowLoop"
	FolderSync  = "FolderSync"
	LuckyBackup = "luckyBackup"
)

// What a target needs typed in again, as Note.What in Plan.FillIn.
const (
	SignIn    = "signIn"
	Password  = "password"
	SecretKey = "secretKey"
)

var (
	ErrUnknown    = errors.New("ArrowLoop cannot read this file. It takes its own backups, a FolderSync configuration export and a luckyBackup profile")
	ErrOldProfile = errors.New("this luckyBackup profile is in the old binary format. Open it in luckyBackup 0.4.2 or newer, save it once and import it again")
)

// Plan is what a file becomes: the jobs and targets to add, what has to be
// typed in again, and what had nowhere to go.
type Plan struct {
	Source  string           `json:"source"`
	Jobs    []map[string]any `json:"jobs"`
	Targets []Target         `json:"targets"`
	FillIn  []Note           `json:"fillIn"`
	Skipped []Note           `json:"skipped"`
}

// Target is an rclone remote to create. Settings never hold a secret.
type Target struct {
	Name     string            `json:"name"`
	Type     string            `json:"type"`
	Settings map[string]string `json:"settings"`
}

// Note is about one job or target. In Plan.Skipped, What quotes the setting as
// the file spells it, so it can be found there.
type Note struct {
	Subject string `json:"subject"`
	What    string `json:"what"`
}

// Read recognises a file by its content and maps it.
func Read(data []byte) (Plan, error) {
	p := Plan{Jobs: []map[string]any{}, Targets: []Target{}, FillIn: []Note{}, Skipped: []Note{}}
	trimmed := bytes.TrimSpace(bytes.TrimPrefix(data, []byte("\xef\xbb\xbf")))
	switch {
	case bytes.HasPrefix(trimmed, []byte("{")):
		var doc map[string]json.RawMessage
		if json.Unmarshal(trimmed, &doc) != nil {
			return p, ErrUnknown
		}
		if isFolderSync(doc) {
			p.Source = FolderSync
			return p, readFolderSync(trimmed, &p)
		}
		if isArrowLoop(doc) {
			p.Source = ArrowLoop
			return p, nil
		}
	case bytes.HasPrefix(trimmed, []byte(profileWarning)):
		p.Source = LuckyBackup
		return p, readLuckyBackup(string(trimmed), &p)
	case bytes.Contains(data, utf16("appName")) && bytes.Contains(data, utf16("luckyBackup")):
		return p, ErrOldProfile
	}
	return p, ErrUnknown
}

func isArrowLoop(doc map[string]json.RawMessage) bool {
	for key := range doc {
		if strings.EqualFold(key, "jobs") {
			return true
		}
	}
	return string(doc["kind"]) == `"arrowloop-settings"`
}

// utf16 spells s the way Qt's QDataStream writes a QString.
func utf16(s string) []byte {
	out := make([]byte, 0, 2*len(s))
	for _, r := range s {
		out = append(out, byte(r>>8), byte(r))
	}
	return out
}

// Settle renames the jobs and targets whose names are taken, here or among
// those the plan already holds, and carries a target's new name into the
// sides and notes that use it.
func Settle(p *Plan, jobTaken, targetTaken func(string) bool) {
	used := map[string]bool{}
	for i, t := range p.Targets {
		name := free(t.Name, "-", func(n string) bool { return used[n] || targetTaken(n) })
		used[name] = true
		if name == t.Name {
			continue
		}
		p.Targets[i].Name = name
		for _, j := range p.Jobs {
			for _, side := range []string{"left", "right"} {
				if s, _ := j[side].(string); strings.HasPrefix(s, t.Name+":") {
					j[side] = name + s[len(t.Name):]
				}
			}
		}
		for k := range p.FillIn {
			if p.FillIn[k].Subject == t.Name {
				p.FillIn[k].Subject = name
			}
		}
	}

	used = map[string]bool{}
	for _, j := range p.Jobs {
		was := j["name"].(string)
		name := free(was, " ", func(n string) bool { return used[n] || jobTaken(n) })
		used[name] = true
		j["name"] = name
	}
}

// free returns name, or name with the first number from 2 that is not taken.
func free(name, sep string, taken func(string) bool) string {
	if !taken(name) {
		return name
	}
	for n := 2; ; n++ {
		next := name + sep + strconv.Itoa(n)
		if !taken(next) {
			return next
		}
	}
}

// targetName makes a name rclone accepts as a remote, from whatever the other
// program called the account.
func targetName(name, fallback string) string {
	var b strings.Builder
	for _, r := range strings.TrimSpace(name) {
		switch {
		case unicode.IsLetter(r), unicode.IsDigit(r), strings.ContainsRune("_.+@-", r):
			b.WriteRune(r)
		default:
			b.WriteRune('-')
		}
	}
	out := strings.Trim(b.String(), "-")
	if out == "" {
		return fallback
	}
	return out
}

// jobName keeps a name to what a job may be called: it ends up in the state
// database's file name.
func jobName(name, fallback string) string {
	name = strings.TrimSpace(strings.Map(func(r rune) rune {
		if r == '/' || r == '\\' || unicode.IsControl(r) {
			return '-'
		}
		return r
	}, name))
	if name == "" || name == "." || name == ".." {
		return fallback
	}
	return name
}

// newJob starts a job with what every imported job shares. It is paused,
// since its folders come from another machine and a mirror pointed at the
// wrong one deletes.
func newJob(name, left, right, direction, mode string) map[string]any {
	return map[string]any{
		"name":      name,
		"left":      left,
		"right":     right,
		"direction": direction,
		"mode":      mode,
		"disabled":  true,
	}
}

// cleanLocal drops a trailing slash, which the other programs use to mean
// "the contents of".
func cleanLocal(p string) string {
	if len(p) > 1 {
		return strings.TrimRight(p, "/")
	}
	return p
}

// onTarget writes a side on a target. rooted keeps a leading slash for the
// backends where it means the server's root rather than the account's.
func onTarget(target, p string, rooted bool) string {
	p = strings.TrimRight(path.Clean("/"+p), "/")
	if !rooted {
		p = strings.TrimPrefix(p, "/")
	}
	return target + ":" + p
}

// addExclude appends a pattern if ArrowLoop's filter takes it and reports
// whether it did.
func addExclude(j map[string]any, pattern string) bool {
	if _, err := filter.New([]string{pattern}); err != nil {
		return false
	}
	list, _ := j["exclude"].([]string)
	j["exclude"] = append(list, pattern)
	return true
}

func (p *Plan) skip(subject, format string, args ...any) {
	p.Skipped = append(p.Skipped, Note{Subject: subject, What: fmt.Sprintf(format, args...)})
}

func (p *Plan) fillIn(target, what string) {
	p.FillIn = append(p.FillIn, Note{Subject: target, What: what})
}
