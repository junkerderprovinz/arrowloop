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
	// Twice is what a LeftTwice failure names, which only the run that found
	// it knows: the text has the reasons in English alone.
	Twice *Twice `json:"twice,omitempty"`
}

// Twice is the first few files a run left for later in two runs in a row,
// and how many more there were.
type Twice struct {
	Files []Left `json:"files"`
	More  int    `json:"more,omitempty"`
}

// Left is one file left for later, with its reason as a code and values for
// an interface to word, and in English.
type Left struct {
	Path string            `json:"path"`
	Code string            `json:"code"`
	Vars map[string]string `json:"vars,omitempty"`
	Text string            `json:"text"`
}

// The codes the interface has a sentence for.
const (
	NotEnoughSpace       = "notEnoughSpace"
	VolumeMissing        = "volumeMissing"
	Unreachable          = "unreachable"
	SignInFailed         = "signInFailed"
	SignInAgain          = "signInAgain"
	TwoFactorRefused     = "twoFactorRefused"
	PermissionDenied     = "permissionDenied"
	NoFileAccess         = "noFileAccess"
	NotFound             = "notFound"
	QuotaExceeded        = "quotaExceeded"
	RateLimited          = "rateLimited"
	Stopped              = "stopped"
	BeforeFailed         = "beforeFailed"
	AfterFailed          = "afterFailed"
	HostKeyChanged       = "hostKeyChanged"
	TooManyLogins        = "tooManyLogins"
	LeftTwice            = "leftTwice"
	CertificateUntrusted = "certificateUntrusted"
	VPNDown              = "vpnDown"
	VPNUnreached         = "vpnUnreached"
	VPNRefused           = "vpnRefused"
	NoVPN                = "noVpn"
	TrashRefused         = "trashRefused"
)

// The sentences the engine composes itself, in internal/daemon, internal/apply,
// internal/precheck and the trash listing of internal/web. Their tests build
// them from there, so a change to one of them fails a test instead of turning
// its failures back into English. Each may follow a job's name or a finding's
// own words, as in a notification.
var (
	space  = regexp.MustCompile(`not enough room on the destination: the (left|right) side reports (\d+) bytes free and this job would write at least (\d+)`)
	volume = regexp.MustCompile(`the volume this job points at is not attached: (?:the )?(left|right) side|the drive the (left|right) side lives on is not attached`)
	side   = regexp.MustCompile(`(?:^|: )(?:the )?(left|right) side (?:"(?:[^"\\]|\\.)*"|could not be opened): `)
	hook   = regexp.MustCompile(`(?:^|: )the command (before|after) the run failed(?:, so the run did not start)?: `)
	twice  = regexp.MustCompile(`(?:^|: )left for later in two runs in a row: `)
	vpn    = regexp.MustCompile(`(?:^|: )the VPN did not come up, so the run did not start: `)
	away   = regexp.MustCompile(`(?:^|: )the VPN did not come up, so the job's sides could not be reached: `)
	unfit  = regexp.MustCompile(`(?:^|: )this job goes through the VPN, but one of its sides cannot: the (left|right) side: `)
	novpn  = regexp.MustCompile(`(?:^|: )this job goes through the VPN, and ArrowLoop has no built-in VPN here`)
	binned = regexp.MustCompile(`(?:^|: )the trash cannot be kept on the (left|right) side: `)
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
	// Go's words for a refused certificate, and internal/certpin's for one
	// other than the trusted one.
	{CertificateUntrusted, []string{"failed to verify certificate", "certificate changed, sha-256"}},
	// An FTP server's cap on logins at once, which ProFTPD answers with the
	// code of a wrong password, and Samba's on connections to a share.
	{TooManyLogins, []string{
		"insufficient system resources exist to complete the api",
		"login limit", "too many connect", "too many users", "too many sessions",
		"connections as the same user", "(the maximum) are already logged in",
		"maximum number of clients", "maximum number of allowed clients",
		"maximum number of hosts", "maximum number of connections",
	}},
	// A sign-in rclone cannot make by itself, such as one that wants a
	// two-factor code, and a code the provider refused.
	{SignInAgain, []string{"please run: rclone config reconnect"}},
	{TwoFactorRefused, []string{"wrong 2-factor auth code"}},
	{SignInFailed, []string{
		"unable to authenticate", "authentication failed", "auth failed", "invalid credentials",
		"ssh-agent", "permission denied (publickey", "logon failure", "401 unauthorized",
		"invalid_grant", "token expired", "signaturedoesnotmatch", "invalidaccesskeyid",
		"wrong login credentials",
	}},
	{QuotaExceeded, []string{"quota exceeded", "over quota", "storage quota", "insufficient storage", "quotaexceeded"}},
	{RateLimited, []string{"rate limit", "too many requests", "slowdown", "ratelimitexceeded"}},
	{Unreachable, []string{
		"connection refused", "actively refused", "no such host", "network is unreachable",
		"host is unreachable", "no route to host", "i/o timeout", "connection timed out",
		"connection reset", "did not properly respond", "couldn't connect", "could not connect",
		"no answer within",
	}},
	// daemon.ErrNoFileAccess, which is about the app rather than an account.
	{NoFileAccess, []string{"may not read the files on this phone"}},
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
	// Ahead of the rules, since the reasons it lists use their words.
	if m := twice.FindStringIndex(text); m != nil {
		return &Failure{Code: LeftTwice, Params: map[string]string{"output": text[m[1]:]}}
	}
	if m := space.FindStringSubmatch(text); m != nil {
		return &Failure{Code: NotEnoughSpace, Params: map[string]string{"side": m[1], "free": m[2], "needed": m[3]}}
	}
	if m := volume.FindStringSubmatch(text); m != nil {
		return &Failure{Code: VolumeMissing, Params: map[string]string{"side": m[1] + m[2]}}
	}
	// Ahead of the rules too: the provider's reason after them may read like
	// a network failure, when the trouble is the VPN's.
	if m := vpn.FindStringIndex(text); m != nil {
		return &Failure{Code: VPNDown, Params: map[string]string{"output": text[m[1]:]}}
	}
	if m := away.FindStringIndex(text); m != nil {
		return &Failure{Code: VPNUnreached, Params: map[string]string{"output": text[m[1]:]}}
	}
	if m := unfit.FindStringSubmatchIndex(text); m != nil {
		return &Failure{Code: VPNRefused, Params: map[string]string{"side": text[m[2]:m[3]], "output": text[m[1]:]}}
	}
	if novpn.MatchString(text) {
		return &Failure{Code: NoVPN}
	}
	// Ahead of the rules, since the backend's reason after it is a refusal.
	if m := binned.FindStringSubmatch(text); m != nil {
		return &Failure{Code: TrashRefused, Params: map[string]string{"side": m[1]}}
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
