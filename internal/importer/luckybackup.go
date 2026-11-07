package importer

import (
	"path"
	"strconv"
	"strings"
)

// profileWarning is the first line luckyBackup writes into a text profile
// (saveProfile in its global.cpp) and the line its loader looks for.
const profileWarning = "***************************** WARNING *****************************"

// lbTask holds one task's lines. Most keys appear once; the lists repeat.
type lbTask map[string][]string

func (t lbTask) get(key string) string {
	if v := t[key]; len(v) > 0 {
		return v[0]
	}
	return ""
}

func (t lbTask) on(key string) bool { return t.get(key) == "1" }

func readLuckyBackup(text string, p *Plan) error {
	global := lbTask{}
	var tasks []lbTask
	var current lbTask
	for _, line := range strings.Split(strings.ReplaceAll(text, "\r\n", "\n"), "\n") {
		switch {
		case strings.HasPrefix(line, "[Task_end]"):
			if current != nil {
				tasks = append(tasks, current)
			}
			current = nil
			continue
		case strings.HasPrefix(line, "[Task]"):
			current = lbTask{}
			continue
		}
		key, value, ok := strings.Cut(line, "=")
		if !ok {
			continue
		}
		into := global
		if current != nil {
			into = current
		}
		into[key] = append(into[key], value)
	}
	if global.get("appName") != "luckyBackup" {
		return ErrUnknown
	}

	profile := firstOf(global.get("ProfileDescription"), LuckyBackup)
	if global.get("emailNever") == "0" {
		for _, key := range []string{"emailError", "emailSchedule"} {
			if global.on(key) {
				p.skip(profile, "%s", key)
			}
		}
		if !global.on("emailError") && !global.on("emailSchedule") {
			p.skip(profile, "emailNever: 0")
		}
	}

	targets := map[string]string{}
	for i, t := range tasks {
		p.lbTask(t, i, targets)
	}
	return nil
}

func (p *Plan) lbTask(t lbTask, i int, targets map[string]string) {
	name := jobName(t.get("Name"), "luckyBackup "+strconv.Itoa(i+1))
	if t.on("Remote") && t.on("RemoteModule") {
		p.skip(name, "RemoteModule")
		return
	}

	source := cleanLocal(t.get("Source"))
	dest := cleanLocal(t.get("Destination"))
	direction, mode := "leftToRight", "sync"
	switch {
	case t.on("TypeSync"):
		direction = "both"
	case t.on("TypeDirName"):
		// The folder itself goes across, not only what is in it.
		dest = strings.TrimRight(dest, "/") + "/" + path.Base(source)
	}
	if t.on("OptionsDelete") && direction != "both" {
		mode = "mirror"
	}

	if t.on("Remote") {
		remote := p.lbTarget(t, targets)
		if t.on("RemoteSource") {
			source = onTarget(remote, source, true)
		} else {
			dest = onTarget(remote, dest, true)
		}
	}
	j := newJob(name, source, dest, direction, mode)
	if keep, _ := strconv.Atoi(t.get("KeepSnapshots")); keep > 1 && direction != "both" {
		// A snapshot holds the run's state; the newest one is the
		// destination itself, so the older ones are the versions to keep.
		j["keepVersions"] = keep - 1
	}

	for _, set := range lbTemplates {
		if t.on(set.key) {
			for _, pattern := range set.patterns {
				addExclude(j, rsyncPattern(pattern))
			}
		}
	}
	for _, pattern := range t["ExcludeListItem"] {
		if converted := rsyncPattern(pattern); converted == "" || !addExclude(j, converted) {
			p.skip(name, "ExcludeListItem: %s", pattern)
		}
	}
	if t.on("ExcludeFromFile") {
		p.skip(name, "ExcludeFile: %s", t.get("ExcludeFile"))
	}
	for _, pattern := range t["IncludeListItem"] {
		p.skip(name, "IncludeListItem: %s", pattern)
	}
	if t.on("IncludeFromFile") {
		p.skip(name, "IncludeFile: %s", t.get("IncludeFile"))
	}
	for _, option := range t["OptionsListItem"] {
		p.skip(name, "OptionsListItem: %s", option)
	}
	p.lbCommands(t, name, "ExecuteBeforeListItem")
	p.lbCommands(t, name, "ExecuteAfterListItem")
	for _, key := range []string{"OptionsCVS", "OptionsHardLinks", "OptionsDevices", "OptionsSuper", "OptionsVss", "OptionsRestorent"} {
		if t.on(key) {
			p.skip(name, "%s", key)
		}
	}
	// Args is not listed: luckyBackup writes it out from the options above.
	p.Jobs = append(p.Jobs, j)
}

// lbCommands lists the commands a task runs around itself. ArrowLoop takes
// such a command only from its own file, typed there by hand.
func (p *Plan) lbCommands(t lbTask, name, key string) {
	states := t[key+"State"]
	for i, command := range t[key] {
		if i < len(states) && states[i] == "0" {
			continue
		}
		p.skip(name, "%s: %s", key, command)
	}
}

// lbTarget returns the SFTP target for a task's SSH host, making it the
// first time that host, user, port and key come up.
func (p *Plan) lbTarget(t lbTask, made map[string]string) string {
	host := t.get("RemoteHost")
	s := map[string]string{"host": host}
	if user := t.get("RemoteUser"); user != "" {
		s["user"] = user
	}
	if port := t.get("RemoteSSHPort"); port != "" && port != "0" && port != "22" {
		s["port"] = port
	}
	if key := t.get("RemoteSSHPassword"); key != "" {
		s["key_file"] = key
	}
	id := s["host"] + "|" + s["user"] + "|" + s["port"] + "|" + s["key_file"]
	if name, ok := made[id]; ok {
		return name
	}
	name := p.addTarget(Target{Name: targetName(host, "sftp"), Type: "sftp", Settings: s})
	if s["key_file"] == "" || t.get("RemoteSSHPasswordStr") != "" {
		p.fillIn(name, Password)
	}
	made[id] = name
	return name
}

// lbTemplates are the exclusions behind luckyBackup's check boxes, as it hands
// them to rsync.
var lbTemplates = []struct {
	key      string
	patterns []string
}{
	{"ExcludeTemp", []string{"**/*tmp*/"}},
	{"ExcludeCache", []string{"**/*cache*/", "**/*Cache*/"}},
	{"ExcludeBackup", []string{"**~"}},
	{"ExcludeMount", []string{"/mnt/*/**", "/media/*/**"}},
	{"ExcludeLostFound", []string{"**/lost+found*/"}},
	{"ExcludeSystem", []string{"/var/run/**", "/run/**", "/proc/**", "/dev/**", "/sys/**"}},
	{"ExcludeTrash", []string{"**/*Trash*/", "**/*trash*/"}},
	{"ExcludeGVFS", []string{"**/.gvfs/"}},
}

// rsyncPattern rewrites an rsync exclude for ArrowLoop's filter. In rsync a
// leading slash anchors a pattern at the top of the transfer, a trailing one
// means a folder, and a pattern with a slash in it can still match at any
// depth. Here a pattern with a slash is matched from the top.
func rsyncPattern(pattern string) string {
	p := strings.TrimSpace(pattern)
	anchored := strings.HasPrefix(p, "/")
	p = strings.TrimPrefix(p, "/")
	folder := strings.HasSuffix(p, "/")
	p = strings.TrimSuffix(p, "/")
	if p == "" {
		return ""
	}
	if folder {
		p += "/**"
	}
	if !anchored && strings.Contains(p, "/") && !strings.HasPrefix(p, "**") {
		p = "**/" + p
	}
	return p
}
