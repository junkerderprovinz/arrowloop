// Package notify keeps the secrets of the notification channels on the
// engine. The interface reads the channels with every secret replaced by
// Placeholder and saves them back that way, and Merge puts the stored secrets
// back in, each only beside the destination it was saved for.
//
// Beyond the tokens, passwords and header values the kit's Redacted hides,
// the address of a webhook, a Discord or Slack hook, an ntfy topic, a Gotify
// server, an Apprise key, a check and every Shoutrrr address is its own key,
// so those are hidden too.
package notify

import (
	"encoding/json"
	"errors"
	"fmt"
	"strings"

	kit "github.com/junkerderprovinz/parleyport/kit/notify"
)

// Placeholder stands in for a secret the engine keeps.
const Placeholder = kit.RedactedValue

// ErrMoved refuses a placeholder that cannot come back: the destination
// beside it changed, or nothing was ever saved for it.
var ErrMoved = errors.New("type it again")

// Redacted returns a copy of channels with every secret replaced by
// Placeholder.
func Redacted(channels []Channel) []Channel {
	shared := kit.Redacted(kitChannels(channels))
	out := make([]Channel, len(channels))
	for i := range out {
		out[i].Channel = shared[i]
		if s := channels[i].Shoutrrr; s != nil {
			out[i].Shoutrrr = &Shoutrrr{URLs: maskAll(s.URLs)}
		}
		c := &out[i].Channel
		for _, a := range addresses(c) {
			*a = mask(*a)
		}
		if c.Apprise != nil {
			c.Apprise.URLs = maskAll(c.Apprise.URLs)
		}
		if c.Healthchecks != nil {
			for key, u := range c.Healthchecks.ByKey {
				c.Healthchecks.ByKey[key] = mask(u)
			}
		}
	}
	return out
}

// Merge puts the secrets Redacted took out of next back from prev, the
// stored channels, and refuses a placeholder that cannot come back with an
// error wrapping ErrMoved.
func Merge(next, prev []Channel) ([]Channel, error) {
	old := make(map[string]Channel, len(prev))
	for _, c := range prev {
		old[c.ID] = c
	}
	out, err := deepCopy(next)
	if err != nil {
		return nil, err
	}
	for i := range out {
		c := &out[i]
		p, ok := old[c.ID]
		if !ok || p.Kind != c.Kind {
			continue
		}
		if c.Shoutrrr != nil && p.Shoutrrr != nil && masked(c.Shoutrrr.URLs) {
			c.Shoutrrr.URLs = append([]string(nil), p.Shoutrrr.URLs...)
		}
		have := addresses(&p.Channel)
		for j, a := range addresses(&c.Channel) {
			if *a == Placeholder && j < len(have) {
				*a = *have[j]
			}
		}
		if c.Apprise != nil && p.Apprise != nil && masked(c.Apprise.URLs) {
			c.Apprise.URLs = append([]string(nil), p.Apprise.URLs...)
		}
		// The kit compares the server and the login. The encryption counts
		// too: "none" would hand the password over in the clear.
		if c.SMTP != nil && p.SMTP != nil && c.SMTP.Password == Placeholder && tls(c.SMTP) != tls(p.SMTP) {
			c.SMTP.Password = ""
		}
		if c.Healthchecks != nil && p.Healthchecks != nil {
			for key, u := range c.Healthchecks.ByKey {
				if u == Placeholder && p.Healthchecks.ByKey[key] != "" {
					c.Healthchecks.ByKey[key] = p.Healthchecks.ByKey[key]
				}
			}
		}
	}
	shared := kit.Merge(kitChannels(out), kitChannels(prev))
	for i := range out {
		out[i].Channel = shared[i]
	}
	for i := range next {
		if field := lost(&next[i], &out[i]); field != "" {
			name := next[i].Name
			if name == "" {
				name = next[i].ID
			}
			return nil, fmt.Errorf("the saved %s of %s belongs to where it was saved; %w to use it here", field, name, ErrMoved)
		}
	}
	return out, nil
}

// lost names the first secret that was a placeholder in sent and did not come
// back in merged.
func lost(sent, merged *Channel) string {
	gone := func(was, now string) bool { return was == Placeholder && (now == "" || now == Placeholder) }
	now := addresses(&merged.Channel)
	for j, a := range addresses(&sent.Channel) {
		if gone(*a, *now[j]) {
			return "address"
		}
	}
	if sent.Apprise != nil && masked(sent.Apprise.URLs) && (len(merged.Apprise.URLs) == 0 || masked(merged.Apprise.URLs)) {
		return "address"
	}
	if sent.Shoutrrr != nil && masked(sent.Shoutrrr.URLs) && (len(merged.Shoutrrr.URLs) == 0 || masked(merged.Shoutrrr.URLs)) {
		return "address"
	}
	if sent.Healthchecks != nil {
		for key, u := range sent.Healthchecks.ByKey {
			if gone(u, merged.Healthchecks.ByKey[key]) {
				return "address"
			}
		}
	}
	if sent.Webhook != nil {
		for name, v := range sent.Webhook.Headers {
			if gone(v, merged.Webhook.Headers[name]) {
				return "header"
			}
		}
	}
	if was := tokenOf(&sent.Channel); was != nil && gone(*was, *tokenOf(&merged.Channel)) {
		return "token"
	}
	if sent.SMTP != nil && gone(sent.SMTP.Password, merged.SMTP.Password) {
		return "password"
	}
	return ""
}

func tls(s *kit.SMTP) string {
	if t := strings.ToLower(s.TLS); t != "" {
		return t
	}
	return "starttls"
}

func tokenOf(c *kit.Channel) *string {
	switch {
	case c.Gotify != nil:
		return &c.Gotify.Token
	case c.Ntfy != nil:
		return &c.Ntfy.Token
	case c.Matrix != nil:
		return &c.Matrix.Token
	}
	return nil
}

// addresses are the fields of c whose address is itself a key, in the same
// order for every channel of a kind.
func addresses(c *kit.Channel) []*string {
	var out []*string
	if c.Webhook != nil {
		out = append(out, &c.Webhook.URL)
	}
	if c.Discord != nil {
		out = append(out, &c.Discord.URL)
	}
	if c.Slack != nil {
		out = append(out, &c.Slack.URL)
	}
	if c.Gotify != nil {
		out = append(out, &c.Gotify.URL)
	}
	if c.Ntfy != nil {
		out = append(out, &c.Ntfy.URL)
	}
	if c.Apprise != nil && len(c.Apprise.URLs) == 0 {
		out = append(out, &c.Apprise.URL)
	}
	if c.Healthchecks != nil {
		out = append(out, &c.Healthchecks.URL)
	}
	return out
}

// maskAll stands one placeholder in for a list of addresses, which Merge
// puts back whole.
func maskAll(vs []string) []string {
	if len(vs) == 0 {
		return vs
	}
	return []string{Placeholder}
}

func masked(vs []string) bool {
	return len(vs) == 1 && vs[0] == Placeholder
}

func mask(v string) string {
	if v == "" {
		return ""
	}
	return Placeholder
}

// deepCopy copies channels through their JSON form, which is what they are
// stored as.
func deepCopy(channels []Channel) ([]Channel, error) {
	raw, err := json.Marshal(channels)
	if err != nil {
		return nil, fmt.Errorf("copy the channels: %w", err)
	}
	var out []Channel
	if err := json.Unmarshal(raw, &out); err != nil {
		return nil, fmt.Errorf("copy the channels: %w", err)
	}
	return out, nil
}
