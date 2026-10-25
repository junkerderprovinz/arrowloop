// Package failure reads the kind of failure out of the text a run ended with,
// so the interface can say it in the reader's language. A run's error is kept
// as text, which is also all a run recorded by an older version has, so the
// kind is worked out from that text whenever it is shown.
package failure

import (
	"regexp"
	"strings"
)

// Failure is a known kind of failure and the figures its sentence needs. It is
// read from the text it is shown beside, so a scrubbed text gives a scrubbed
// failure.
type Failure struct {
	Code   string            `json:"code"`
	Params map[string]string `json:"params,omitempty"`
}

// The codes the interface has a sentence for.
const (
	NotEnoughSpace   = "notEnoughSpace"
	VolumeMissing    = "volumeMissing"
	Unreachable      = "unreachable"
	SignInFailed     = "signInFailed"
	PermissionDenied = "permissionDenied"
	NotFound         = "notFound"
	QuotaExceeded    = "quotaExceeded"
	RateLimited      = "rateLimited"
	Stopped          = "stopped"
	BeforeFailed     = "beforeFailed"
	AfterFailed      = "afterFailed"
	HostKeyChanged   = "hostKeyChanged"
)

// The sentences the engine composes itself, in internal/daemon,
// internal/precheck and the trash listing of internal/web. Their tests build
// them from there, so a change to one of them fails a test instead of turning
// its failures back into English. Each may follow a job's name or a finding's
// own words, as in a notification.
var (
	space  = regexp.MustCompile(`not enough room on the destination: the (left|right) side reports (\d+) bytes free and this job would write at least (\d+)`)
	volume = regexp.MustCompile(`the volume this job points at is not attached: (left|right) side|the drive the (left|right) side lives on is not attached`)
	side   = regexp.MustCompile(`(?:^|: )(?:the )?(left|right) side (?:"(?:[^"\\]|\\.)*"|could not be opened): `)
	hook   = regexp.MustCompile(`(?:^|: )the command (before|after) the run failed(?:, so the run did not start)?: `)
)

// rule is a family of messages from rclone, the network or the system, matched
// on lower-cased text. Each names the same trouble on every platform: Windows
// words its socket and file errors differently from Linux.
type rule struct {
	code  string
	marks []string
}

// rules are checked in order, so sign-in comes before the network: an SSH
// handshake that is refused is a credential problem, not a dead host.
var rules = []rule{
	{Stopped, []string{"context canceled"}},
	// rclone's words for a server that shows another key than the pinned one
	// go on to say it could not connect.
	{HostKeyChanged, []string{"host key mismatch"}},
	{SignInFailed, []string{
		"unable to authenticate", "authentication failed", "auth failed", "invalid credentials",
		"ssh-agent", "permission denied (publickey", "logon failure", "401 unauthorized",
		"invalid_grant", "token expired", "signaturedoesnotmatch", "invalidaccesskeyid",
	}},
	{QuotaExceeded, []string{"quota exceeded", "over quota", "storage quota", "insufficient storage", "quotaexceeded"}},
	{RateLimited, []string{"rate limit", "too many requests", "slowdown", "ratelimitexceeded"}},
	{Unreachable, []string{
		"connection refused", "actively refused", "no such host", "network is unreachable",
		"host is unreachable", "no route to host", "i/o timeout", "connection timed out",
		"connection reset", "did not properly respond", "couldn't connect", "could not connect",
	}},
	{PermissionDenied, []string{"permission denied", "access is denied", "operation not permitted", "403 forbidden", "accessdenied"}},
	{NotFound, []string{
		"directory not found", "no such file or directory", "cannot find the path",
		"cannot find the file", "object not found", "nosuchbucket", "bucket not found",
	}},
}

// Of names the failure in a run's error text, or returns nil for one the
// interface has no sentence for, which then shows the text as it is.
func Of(text string) *Failure {
	if text == "" {
		return nil
	}
	if m := space.FindStringSubmatch(text); m != nil {
		return &Failure{Code: NotEnoughSpace, Params: map[string]string{"side": m[1], "free": m[2], "needed": m[3]}}
	}
	if m := volume.FindStringSubmatch(text); m != nil {
		return &Failure{Code: VolumeMissing, Params: map[string]string{"side": m[1] + m[2]}}
	}
	if m := hook.FindStringSubmatchIndex(text); m != nil {
		code := BeforeFailed
		if text[m[2]:m[3]] == "after" {
			code = AfterFailed
		}
		// What the command printed is its own, and is shown below the sentence.
		return &Failure{Code: code, Params: map[string]string{"output": text[m[1]:]}}
	}

	var params map[string]string
	if m := side.FindStringSubmatch(text); m != nil {
		params = map[string]string{"side": m[1]}
	}
	lower := strings.ToLower(text)
	for _, r := range rules {
		for _, mark := range r.marks {
			if strings.Contains(lower, mark) {
				return &Failure{Code: r.code, Params: params}
			}
		}
	}
	return nil
}
