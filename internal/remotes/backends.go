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
	Name     string    `json:"name"`
	Help     string    `json:"help"`
	Required bool      `json:"required"`
	Secret   bool      `json:"secret"`
	Advanced bool      `json:"advanced"`
	Default  string    `json:"default"`
	Examples []Example `json:"examples,omitempty"`
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
func Backends() []Backend {
	out := make([]Backend, 0, len(rclonefs.Registry))
	for _, info := range rclonefs.Registry {
		if info.Name == "local" {
			// A local path is typed in as a path. Offering it here would ask
			// somebody to name a remote for the folder they are looking at.
			continue
		}
		b := Backend{Name: info.Name, Description: info.Description}
		for _, o := range info.Options {
			b.Options = append(b.Options, Option{
				Name:     o.Name,
				Help:     firstLine(o.Help),
				Required: o.Required,
				// The backend's own idea of a password, plus this package's
				// rule. Either one is enough to withhold a value: two ways of
				// spotting a secret can only ever hide more, never less.
				Secret:   o.IsPassword || IsSecret(o.Name),
				Advanced: o.Advanced,
				Default:  defaultText(o.Default),
				Examples: examples(o),
			})
		}
		sort.SliceStable(b.Options, func(i, j int) bool {
			// Required first, then the ordinary ones, then the long tail. A
			// form that opens on forty advanced options is a form nobody fills
			// in.
			return rank(b.Options[i]) < rank(b.Options[j])
		})
		out = append(out, b)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Name < out[j].Name })
	return out
}

func rank(o Option) int {
	switch {
	case o.Required:
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
