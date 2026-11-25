package volume

import (
	"bufio"
	"io"
	"path"
	"sort"
	"strings"
)

// mountEscapes undoes what the kernel writes in mountinfo for a space, a tab,
// a newline and a backslash in a mount point.
var mountEscapes = strings.NewReplacer(`\040`, " ", `\011`, "\t", `\012`, "\n", `\134`, `\`)

// mountPoints reads the mount points out of /proc/self/mountinfo, each once.
func mountPoints(r io.Reader) []string {
	var out []string
	seen := map[string]bool{}
	sc := bufio.NewScanner(r)
	for sc.Scan() {
		fields := strings.Fields(sc.Text())
		if len(fields) < 5 {
			continue
		}
		p := mountEscapes.Replace(fields[4])
		if !seen[p] {
			seen[p] = true
			out = append(out, p)
		}
	}
	return out
}

// offered keeps the mount points a removable disk or a share is put on: those
// directly in /media, /mnt or the home folder, and one level deeper in /media
// and /run/media, where udisks mounts per user. Hidden folders are where
// desktops mount their own plumbing, so they are left out.
func offered(points []string, home string) []string {
	var out []string
	for _, p := range points {
		if strings.HasPrefix(path.Base(p), ".") {
			continue
		}
		parent := path.Dir(p)
		switch {
		case parent == "/media", parent == "/mnt", home != "" && parent == home:
		case path.Dir(parent) == "/media", path.Dir(parent) == "/run/media":
		default:
			continue
		}
		out = append(out, p)
	}
	sort.Strings(out)
	return out
}
