package web

import (
	"net/http"
	"strings"
)

// share is a network share this machine is already connected to, the way
// Windows Explorer shows it under "This PC". The SMB form offers these so the
// server's name does not have to be typed again.
type share struct {
	// Letter is the drive it is mapped to, such as "Z:", or empty for a share
	// connected without one.
	Letter string `json:"letter,omitempty"`
	// Path is the address it was connected to, \\server\share or a folder
	// inside one.
	Path  string `json:"path"`
	Host  string `json:"host"`
	Share string `json:"share"`
	// User and Domain are the account the connection was made with, where
	// Windows says. The password never leaves the system.
	User   string `json:"user,omitempty"`
	Domain string `json:"domain,omitempty"`
}

// listShares is swapped in tests, which cannot map a drive.
var listShares = connectedShares

// shareFrom builds a share from what Windows reports about a connection. It
// refuses a remote name that is not a UNC path, which is what a WebDAV folder
// mapped to a letter reports.
func shareFrom(letter, remote, account string) (share, bool) {
	rest, ok := strings.CutPrefix(remote, `\\`)
	if !ok {
		return share{}, false
	}
	rest = strings.TrimRight(rest, `\`)
	host, below, _ := strings.Cut(rest, `\`)
	// A letter can be mapped to a folder inside a share, and SMB still wants
	// the share on its own.
	name, _, _ := strings.Cut(below, `\`)
	if host == "" || name == "" {
		return share{}, false
	}
	s := share{Letter: letter, Path: `\\` + rest, Host: host, Share: name, User: account}
	// DOMAIN\user is the form SMB asks for in two fields. user@domain is one
	// name SMB takes as it is.
	if domain, user, found := strings.Cut(account, `\`); found {
		s.Domain, s.User = domain, user
	}
	return s, true
}

// listSharesHandler answers with the connected shares. A machine with none,
// and every system but Windows, answers with an empty list.
func (s *Server) listSharesHandler(w http.ResponseWriter, r *http.Request) {
	found, err := listShares()
	if err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	if found == nil {
		found = []share{}
	}
	writeJSON(w, http.StatusOK, map[string]any{"shares": found})
}
