package notify

import (
	"cmp"
	"errors"
	"slices"
	"strconv"
	"strings"

	kit "github.com/junkerderprovinz/parleyport/kit/notify"
	"github.com/nicholas-fedor/shoutrrr/pkg/router"
	"github.com/nicholas-fedor/shoutrrr/pkg/types"
)

// KindShoutrrr sends through Shoutrrr, which reaches a few dozen services from
// one address each. The kit does not know it, so this package checks and
// sends it beside the kit's kinds.
const KindShoutrrr kit.Kind = "shoutrrr"

// Channel is one stored destination in the kit's format, with the settings
// of a Shoutrrr channel beside the kit's blocks.
type Channel struct {
	kit.Channel
	Shoutrrr *Shoutrrr `json:"shoutrrr,omitempty"`
}

// Shoutrrr sends to every address in URLs, such as telegram://... or
// pushover://...
type Shoutrrr struct {
	URLs []string `json:"urls,omitempty"`
}

// FromKit wraps channels of the kit, as its legacy package reads them from an
// older file.
func FromKit(channels []kit.Channel) []Channel {
	if channels == nil {
		return nil
	}
	out := make([]Channel, len(channels))
	for i, c := range channels {
		out[i] = Channel{Channel: c}
	}
	return out
}

func kitChannels(channels []Channel) []kit.Channel {
	if channels == nil {
		return nil
	}
	out := make([]kit.Channel, len(channels))
	for i, c := range channels {
		out[i] = c.Channel
	}
	return out
}

// Validate is the kit's Validate for every kind, Shoutrrr included: it
// reports every problem in channels as kit.Problems, or nil.
func Validate(channels []Channel) error {
	shared := kitChannels(channels)
	var ps kit.Problems
	for i, c := range channels {
		if c.Kind != KindShoutrrr {
			continue
		}
		// The kit still checks the id, the "when" and the bounds, as it does
		// for Unraid's channel, which has no settings either.
		shared[i].Kind = kit.KindUnraid
		if c.Enabled {
			ps = append(ps, c.shoutrrrProblems(i)...)
		}
	}
	if err := kit.Validate(shared); err != nil {
		var theirs kit.Problems
		if !errors.As(err, &theirs) {
			return err
		}
		ps = append(theirs, ps...)
	}
	if len(ps) == 0 {
		return nil
	}
	slices.SortStableFunc(ps, func(a, b kit.Problem) int { return cmp.Compare(a.Index, b.Index) })
	return ps
}

// shoutrrrProblems are what keeps c from sending. An address that Shoutrrr
// cannot read is reported by its place alone, since it holds a key.
func (c Channel) shoutrrrProblems(index int) kit.Problems {
	var ps kit.Problems
	add := func(field, code string) {
		ps = append(ps, kit.Problem{Index: index, Channel: c.ID, Field: field, Code: code})
	}
	if c.Shoutrrr == nil {
		add("shoutrrr", kit.ProblemMissingSettings)
		return ps
	}
	if len(c.Shoutrrr.URLs) == 0 {
		add("shoutrrr.urls", kit.ProblemMissingField)
	}
	for i, u := range c.Shoutrrr.URLs {
		field := "shoutrrr.urls." + strconv.Itoa(i)
		if strings.TrimSpace(u) == "" {
			add(field, kit.ProblemMissingField)
			continue
		}
		if _, err := router.NewWithOptions(nil, types.SenderOptions{}, u); err != nil {
			add(field, kit.ProblemBadURL)
		}
	}
	return ps
}
