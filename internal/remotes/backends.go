package remotes

import (
	"fmt"
	"sort"
	"strings"

	rclonefs "github.com/rclone/rclone/fs"
)

// The form for setting up a target is built from what the backend says about
// itself, not from a list written out here.
//
// Every one of these settings already carries a name, a help text, a default
// and often a set of examples, and rclone keeps them correct because its own
// command line reads the same thing. A hand-written copy would be a second
// source of truth that starts wrong the first time a backend gains an option.

// Option is one setting a backend accepts.
type Option struct {
	Name     string `json:"name"`
	Help     string `json:"help"`
	Required bool   `json:"required"`
	Secret   bool   `json:"secret"`
	Advanced bool   `json:"advanced"`
	// Essential means: without this, the target will not work in practice.
	//
	// Separate from Required, and the gap between them is a real defect rather
	// than a nicety. rclone's `required` describes its own interactive setup,
	// where everything else is asked for by a prompt with a default. Read as
	// "the fields a form must show", it produces nonsense: measured on this
	// build, s3 marks NONE of its seventy-eight options required, so the form
	// for the one backend somebody would point at a cloud provider showed no
	// fields at all and let a target be saved with no credentials whatsoever.
	// smb marks only `host`, so it never asked for the user or the password a
	// private share needs.
	//
	// So this is a short, hand-kept list per backend of what a person actually
	// has to fill in, and it is deliberately hand-kept: it encodes which of
	// thirty S3 providers people here use, which rclone cannot know. It only
	// ever ADDS to what the form shows - nothing that was reachable becomes
	// unreachable - and the advanced switch still reveals everything.
	Essential bool      `json:"essential"`
	Default   string    `json:"default"`
	Examples  []Example `json:"examples,omitempty"`
}

// Example is one suggested value, with the reason it might be the right one.
type Example struct {
	Value string `json:"value"`
	Help  string `json:"help"`
}

// Backend is one kind of storage this build can reach.
type Backend struct {
	Name        string   `json:"name"`
	Description string   `json:"description"`
	Options     []Option `json:"options"`
}

// Backends lists what this build can actually talk to.
//
// What is compiled in is the honest answer to "what can I point a job at". A
// screen offering a backend the binary does not carry would produce a job that
// fails the first time it runs, with an error about a missing section rather
// than about the thing that is really wrong.
// promised are the kinds of storage this product is sold on, in the order a
// person is most likely to want them.
//
// rclone's registry is alphabetical, which puts crypt first: a wrapper around
// another remote, offered before the four things anybody came here for. A form
// that opens on a backend nobody asked for is a form whose first act is to be
// wrong. The rest of the registry still follows, because a build that carries a
// backend and hides it would be lying about what it can reach.
var promised = []string{"s3", "sftp", "smb"}

// essential lists, per backend, the settings without which the target will not
// work - see Option.Essential for why rclone's own `required` cannot answer
// this. Order does not matter; the form keeps rclone's.
var essential = map[string]map[string]bool{
	"s3": {
		// Which of the thirty-odd S3 services this is. Everything else about
		// the connection follows from it, and getting it wrong produces errors
		// about signatures that read like a credentials problem.
		"provider":          true,
		"access_key_id":     true,
		"secret_access_key": true,
		// One of these two, depending on the provider: AWS wants a region and
		// everybody else wants an endpoint. Both are shown rather than guessed
		// at, because guessing would hide the one the person needs.
		"region":   true,
		"endpoint": true,
	},
	"smb": {
		"host": true,
		"user": true,
		"pass": true,
		// A Windows domain or workgroup. Blank is right on a home network and
		// wrong in an office, and somebody in an office will not find it behind
		// the advanced switch.
		"domain": true,
	},
	"sftp": {
		"host": true,
		"user": true,
		"port": true,
		// Both ways in. A key file and a password are alternatives, so neither
		// can be "required", and hiding either leaves half the people stuck.
		"pass":     true,
		"key_file": true,
	},
	"crypt": {
		"remote":   true,
		"password": true,
	},
}

func rank(name string) int {
	for i, p := range promised {
		if name == p {
			return i
		}
	}
	return len(promised)
}

func Backends() []Backend {
	out := make([]Backend, 0, len(rclonefs.Registry))
	for _, info := range rclonefs.Registry {
		if info.Name == "local" {
			// A local path is typed in as a path. Offering it here would ask
			// somebody to name a remote for the folder they are looking at.
			continue
		}
		// Options starts as an empty slice for the same reason a target's
		// settings do: a nil slice marshals to null, and a browser handed null
		// where it was promised a list falls over on the first map.
		b := Backend{Name: info.Name, Description: info.Description, Options: []Option{}}
		for _, o := range info.Options {
			b.Options = append(b.Options, Option{
				Name:     o.Name,
				Help:     firstLine(o.Help),
				Required: o.Required,
				// The backend's own idea of a password, plus this package's
				// rule. Either one is enough to withhold a value: two ways of
				// spotting a secret can only ever hide more, never less.
				Secret:    o.IsPassword || IsSecret(o.Name),
				Advanced:  o.Advanced,
				Essential: essential[info.Name][o.Name],
				Default:   defaultText(o.Default),
				Examples:  examples(o),
			})
		}
		sort.SliceStable(b.Options, func(i, j int) bool {
			// Required first, then the ordinary ones, then the long tail. A
			// form that opens on forty advanced options is a form nobody fills
			// in.
			return optionRank(b.Options[i]) < optionRank(b.Options[j])
		})
		out = append(out, b)
	}
	sort.Slice(out, func(i, j int) bool {
		if a, b := rank(out[i].Name), rank(out[j].Name); a != b {
			return a < b
		}
		return out[i].Name < out[j].Name
	})
	return out
}

func optionRank(o Option) int {
	switch {
	// Essential sits with required rather than below it: the two mean the same
	// thing to the person filling the form in, and separating them would put
	// the secret key under a heading of merely-optional settings.
	case o.Required, o.Essential:
		return 0
	case !o.Advanced:
		return 1
	default:
		return 2
	}
}

// firstLine keeps the sentence and drops the paragraphs. rclone's help texts
// run to several lines with examples in them, which is right for a manual page
// and wrong for a label beside a field.
func firstLine(help string) string {
	line, _, _ := strings.Cut(help, "\n")
	return strings.TrimSpace(line)
}

func defaultText(value any) string {
	if value == nil {
		return ""
	}
	text := fmt.Sprint(value)
	if text == "<nil>" || text == "false" || text == "0" {
		return ""
	}
	return text
}

func examples(o rclonefs.Option) []Example {
	if o.IsPassword || IsSecret(o.Name) {
		// An example password is either useless or a suggestion somebody will
		// take literally.
		return nil
	}
	out := make([]Example, 0, len(o.Examples))
	for _, e := range o.Examples {
		out = append(out, Example{Value: e.Value, Help: firstLine(e.Help)})
	}
	return out
}
