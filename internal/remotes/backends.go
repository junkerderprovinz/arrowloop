package remotes

import (
	"fmt"
	"sort"
	"strings"

	rclonefs "github.com/rclone/rclone/fs"
)

// Option is one setting a backend accepts, as the backend describes it to
// rclone's own command line.
type Option struct {
	Name     string `json:"name"`
	Help     string `json:"help"`
	Required bool   `json:"required"`
	Secret   bool   `json:"secret"`
	Advanced bool   `json:"advanced"`
	// Essential means the target will not work in practice without this.
	// rclone's Required describes its interactive setup, where everything else
	// is prompted for with a default: s3 marks none of its options required and
	// smb marks only host. Essential comes from a hand-kept list and only adds
	// to what the form shows.
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

	// NeedsToken says this backend can only be reached with an OAuth token
	// obtained outside this program, so the interface can say so in the
	// reader's language.
	NeedsToken bool `json:"needsToken,omitempty"`
}

// promised are the kinds of storage this product is for, in the order a person
// is most likely to want them. rclone's registry is alphabetical and would put
// crypt first; the rest of it follows these.
var promised = []string{
	// The self-hosted clouds are WebDAV underneath.
	"webdav", "mega", "dropbox", "drive", "onedrive", "pcloud",
	"s3", "sftp", "smb",
	"b2", "box", "azureblob", "ftp", "jottacloud", "koofr", "protondrive",
	"seafile", "opendrive", "yandex", "storj",
}

// essential lists, per backend, the settings without which the target will not
// work. See Option.Essential. Order does not matter; the form keeps rclone's.
var essential = map[string]map[string]bool{
	"s3": {
		// A wrong provider produces signature errors that read like a
		// credentials problem.
		"provider":          true,
		"access_key_id":     true,
		"secret_access_key": true,
		// AWS wants a region and everybody else an endpoint, so both are shown.
		"region":   true,
		"endpoint": true,
	},
	"smb": {
		"host": true,
		"user": true,
		"pass": true,
		// Blank is right at home and wrong in an office.
		"domain": true,
	},
	"sftp": {
		"host": true,
		"user": true,
		"port": true,
		// A password and a key file are alternatives, so both are shown.
		"pass":     true,
		"key_file": true,
	},
	"crypt": {
		"remote":   true,
		"password": true,
	},

	// vendor is what makes Nextcloud and ownCloud work rather than merely
	// connect.
	"webdav": {"url": true, "vendor": true, "user": true, "pass": true},

	"mega":        {"user": true, "pass": true},
	"opendrive":   {"username": true, "password": true},
	"protondrive": {"username": true, "password": true, "2fa": true},
	"seafile":     {"url": true, "user": true, "pass": true, "library": true},
	"koofr":       {"provider": true, "user": true, "password": true},
	"ftp":         {"host": true, "user": true, "pass": true, "port": true},

	"b2":        {"account": true, "key": true},
	"azureblob": {"account": true, "key": true},
	"storj":     {"provider": true, "access_grant": true},

	// rclone marks token advanced because its own setup fetches it through a
	// browser. This interface has no such flow, so the field has to be shown.
	"dropbox":    {"token": true},
	"drive":      {"token": true, "scope": true},
	"onedrive":   {"token": true, "drive_id": true, "drive_type": true},
	"pcloud":     {"token": true, "hostname": true},
	"box":        {"token": true},
	"jottacloud": {"token": true},
	"yandex":     {"token": true},

	"filescom":        {"site": true, "username": true, "password": true},
	"internetarchive": {"access_key_id": true, "secret_access_key": true},
	"sugarsync":       {"app_id": true, "access_key_id": true, "private_access_key": true},
	"ulozto":          {"username": true, "password": true, "app_token": true},
	"sia":             {"api_url": true, "api_password": true},
	// auth is the installation's own endpoint URL.
	"swift":      {"auth": true, "user": true, "key": true},
	"qingstor":   {"access_key_id": true, "secret_access_key": true, "zone": true},
	"azurefiles": {"account": true, "key": true, "share_name": true},
	"drime":      {"access_token": true},
	"gofile":     {"access_token": true},
	"fichier":    {"api_key": true},
	"archive":    {"remote": true},
	// Storj's old name.
	"tardigrade": {"access_grant": true, "satellite_address": true, "api_key": true, "passphrase": true},

	// OAuth backends with no plain credential: the client pair is what a person
	// registers with the provider to obtain a token.
	"hidrive":      {"token": true, "client_id": true, "client_secret": true},
	"huaweidrive":  {"token": true, "client_id": true, "client_secret": true},
	"putio":        {"token": true, "client_id": true, "client_secret": true},
	"sharefile":    {"token": true, "client_id": true, "client_secret": true},
	"zoho":         {"token": true, "client_id": true, "client_secret": true, "region": true},
	"premiumizeme": {"token": true, "api_key": true},

	// These registry names contain spaces.
	"google cloud storage": {
		"token": true, "project_number": true, "service_account_file": true,
		"client_id": true, "client_secret": true,
	},
	"google photos": {"token": true, "client_id": true, "client_secret": true, "read_only": true},
}

// tokenBackends are the ones whose only way in is an OAuth token obtained
// outside this program. They are named rather than detected, because some
// backends with a token option also accept a password.
var tokenBackends = map[string]bool{
	"dropbox": true, "drive": true, "onedrive": true, "pcloud": true,
	"box": true, "jottacloud": true, "yandex": true,
}

func rank(name string) int {
	for i, p := range promised {
		if name == p {
			return i
		}
	}
	return len(promised)
}

// Backends lists what this build can talk to, built from what each backend
// says about itself rather than from a copy kept here.
func Backends() []Backend {
	out := make([]Backend, 0, len(rclonefs.Registry))
	for _, info := range rclonefs.Registry {
		if info.Name == "local" {
			// A local path is typed in as a path.
			continue
		}
		// Not nil, so it marshals as a list.
		b := Backend{
			Name: info.Name, Description: info.Description, Options: []Option{},
			NeedsToken: tokenBackends[info.Name],
		}
		for _, o := range info.Options {
			b.Options = append(b.Options, Option{
				Name:     o.Name,
				Help:     firstLine(o.Help),
				Required: o.Required,
				// Either test is enough to withhold a value.
				Secret:    o.IsPassword || IsSecret(o.Name),
				Advanced:  o.Advanced,
				Essential: essential[info.Name][o.Name],
				Default:   defaultText(o.Default),
				Examples:  examples(o),
			})
		}
		sort.SliceStable(b.Options, func(i, j int) bool {
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

// optionRank puts required and essential options first, then the ordinary
// ones, then the advanced ones.
func optionRank(o Option) int {
	switch {
	case o.Required, o.Essential:
		return 0
	case !o.Advanced:
		return 1
	default:
		return 2
	}
}

// firstLine keeps the first line of a help text, which is all a label beside a
// field has room for.
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
		// Somebody might use an example password literally.
		return nil
	}
	out := make([]Example, 0, len(o.Examples))
	for _, e := range o.Examples {
		out = append(out, Example{Value: e.Value, Help: firstLine(e.Help)})
	}
	return out
}
