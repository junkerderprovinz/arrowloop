// Package scrub takes out of a text what must not leave the machine: the
// parameters of an rclone connection string, which can hold a password or a
// key, a password written into an address, what a failed hook printed, and
// the name of the person in a home folder. A run's error goes through it on
// its way into a notification and into the bug report alike.
package scrub

import (
	"regexp"
	"strconv"
	"strings"

	"github.com/junkerderprovinz/arrowloop/internal/hook"
	"github.com/junkerderprovinz/arrowloop/internal/job"
)

// Text scrubs a text without knowing the jobs it may quote.
func Text(text string) string {
	text = quotedText.ReplaceAllStringFunc(text, func(q string) string {
		plain, err := strconv.Unquote(q)
		if err != nil {
			return q
		}
		if shown := withoutParameters(plain); shown != plain {
			return strconv.Quote(shown)
		}
		return q
	})
	// After the quoted ones, whose escaped quotes would read wrong here.
	text = withoutParametersIn(text)
	text = userinfo.ReplaceAllString(text, "$1:***@")
	return Home(withoutHookOutput(text))
}

// Knowing returns a Text that also knows the sides of these jobs, so a side
// is shown as Side shows it wherever an error quotes it, however it is quoted.
func Knowing(jobs []job.Job) func(string) string {
	var pairs []string
	for _, j := range jobs {
		for _, side := range []string{j.Left, j.Right} {
			shown := Side(side)
			if shown == side {
				continue
			}
			pairs = append(pairs, side, shown, unquoted(strconv.Quote(side)), unquoted(strconv.Quote(shown)))
		}
	}
	known := strings.NewReplacer(pairs...)
	return func(text string) string { return Text(known.Replace(text)) }
}

// Side is a job's side without its connection parameters and home folder.
func Side(side string) string { return Home(withoutParameters(side)) }

func unquoted(q string) string { return q[1 : len(q)-1] }

// quotedText is a Go-quoted string inside an error, which is how the engine
// names a side it could not open.
var quotedText = regexp.MustCompile(`"(?:[^"\\]|\\.)*"`)

// userinfo finds the password part of an address, as a remote's error may
// quote one.
var userinfo = regexp.MustCompile(`([a-zA-Z][a-zA-Z0-9+.-]*://[^/\s:@]*):[^/\s@]*@`)

// hookStatus is the part of a failed command's error that says how it ended.
// What follows it is the command's own output.
var hookStatus = regexp.MustCompile(`^(exit status -?\d+|gave no answer within \S+)`)

func withoutHookOutput(text string) string {
	for _, failed := range []string{hook.BeforeFailed, hook.AfterFailed} {
		at := strings.Index(text, failed)
		if at < 0 {
			continue
		}
		end := at + len(failed)
		rest := strings.TrimPrefix(text[end:], ": ")
		status := hookStatus.FindString(rest)
		switch {
		case status == "":
			return text[:end]
		case len(status) < len(rest):
			return text[:end] + ": " + status + ": the output is left out"
		}
		return text[:end] + ": " + status
	}
	return text
}

// homeFolder is a user's own folder, which is usually named after the person.
// Windows allows spaces in the name, so it ends only at a separator, a quote,
// a colon or the end of a line.
var homeFolder = regexp.MustCompile(`(?i)(^|[\s"'(=:,])(?:[a-z]:)?[\\/]+(?:home|users)[\\/]+[^\\/"'\n:]+`)

// Home writes every home folder in s as "~".
func Home(s string) string { return homeFolder.ReplaceAllString(s, "${1}~") }

// withoutParameters drops the parameters of an rclone connection string, such
// as ":s3,access_key_id=X,secret_access_key=Y:bucket", which can hold a key.
// A plain path or a named remote comes back as it was.
func withoutParameters(side string) string {
	comma := strings.IndexByte(side, ',')
	if comma < 0 {
		return side
	}
	name := strings.TrimPrefix(side[:comma], ":")
	if name == "" || strings.ContainsAny(name, `/\: `) {
		return side
	}
	end, open := parametersEnd(side, comma)
	switch {
	case end >= 0:
		return side[:comma] + side[end:]
	case open:
		// A quote that never closes leaves no telling where the secret ends.
		return side[:comma]
	}
	return side
}

// parametersEnd finds the colon that ends the parameters after s[comma], or
// -1, and tells whether a quote was left open. rclone takes a value as quoted
// only when the quote opens it, and a quote doubled inside stands for itself.
// A quoted value may hold a colon, so the colon that ends the parameters is
// the first one outside quotes.
func parametersEnd(s string, comma int) (end int, open bool) {
	var quote byte
	for i := comma + 1; i < len(s); i++ {
		c := s[i]
		switch {
		case quote != 0:
			if c != quote {
				continue
			}
			if i+1 < len(s) && s[i+1] == quote {
				i++
				continue
			}
			quote = 0
		case (c == '"' || c == '\'') && s[i-1] == '=':
			quote = c
		case c == ':':
			return i, false
		}
	}
	return -1, quote != 0
}

// parametersAt is where a connection string's parameters start inside free
// text: a backend or remote name, a comma and the first key, as in
// "sftp,host=" or "nas,pass=".
var parametersAt = regexp.MustCompile(`:?[\w.-]+,\w+=`)

// withoutParametersIn drops the parameters of every connection string in a
// text that does not quote them. Ones that no colon closes run to the end of
// their line.
func withoutParametersIn(text string) string {
	var out strings.Builder
	for {
		at := parametersAt.FindStringIndex(text)
		if at == nil {
			out.WriteString(text)
			return out.String()
		}
		comma := at[0] + strings.IndexByte(text[at[0]:], ',')
		lineEnd := len(text)
		if nl := strings.IndexByte(text[comma:], '\n'); nl >= 0 {
			lineEnd = comma + nl
		}
		end, _ := parametersEnd(text[:lineEnd], comma)
		if end < 0 {
			end = lineEnd
		}
		out.WriteString(text[:comma])
		text = text[end:]
	}
}
