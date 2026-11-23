package remotes

import (
	"errors"
	"fmt"
	"maps"
	"strconv"
	"strings"
	"unicode"
	"unicode/utf8"

	"github.com/rclone/rclone/fs/config"
)

// LabelKey is the setting that holds what a target is called on screen. The
// section's own name is the target's id: jobs, wrapping targets such as crypt
// and rclone's command line write it before the colon, so it stays as it was
// made. A target without a label, as every target from before labels is, goes
// by its id.
const LabelKey = "label"

// MaxLabel is the most characters a label may have, which is room for a
// provider, an account and what is kept there.
const MaxLabel = 100

// ErrLabelTaken is what a label another target already goes by is refused
// with: two rows of one name cannot be told apart in a job's choice of target.
var ErrLabelTaken = errors.New("another target already goes by this name")

// LabelOf is what the target id goes by.
func LabelOf(id string) string {
	return labelOf(config.LoadedData(), id)
}

func labelOf(data config.Storage, id string) string {
	if label, _ := data.GetValue(id, LabelKey); label != "" {
		return label
	}
	return id
}

func validLabel(label string) error {
	switch {
	case label == "":
		return errors.New("a target needs a name")
	case utf8.RuneCountInString(label) > MaxLabel:
		return fmt.Errorf("a target's name can be at most %d characters long", MaxLabel)
	case strings.IndexFunc(label, unicode.IsControl) >= 0:
		return errors.New("a target's name cannot contain a line break or a tab")
	}
	return nil
}

// checkLabel refuses a label that is no name or that a target other than id
// goes by.
func checkLabel(data config.Storage, id, label string) error {
	if err := validLabel(label); err != nil {
		return err
	}
	for _, other := range data.GetSectionList() {
		if other != id && labelOf(data, other) == label {
			return fmt.Errorf("%w: %s", ErrLabelTaken, label)
		}
	}
	return nil
}

// setLabel keeps the label only where it says something the id does not, so a
// target whose label is its id reads in rclone.conf as one from before labels.
func setLabel(data config.Storage, id, label string) {
	if label == id {
		data.DeleteKey(id, LabelKey)
		return
	}
	data.SetValue(id, LabelKey, label)
}

// Rename gives a target another name on screen. Its id, and with it every job
// and wrapping target that names it, stays.
func Rename(id, label string) error {
	label = strings.TrimSpace(label)
	data := config.LoadedData()
	if !data.HasSection(id) {
		return fmt.Errorf("no remote called %q", id)
	}
	if err := checkLabel(data, id, label); err != nil {
		return err
	}
	was, _ := data.GetValue(id, LabelKey)
	setLabel(data, id, label)
	if err := data.Save(); err != nil {
		if was == "" {
			data.DeleteKey(id, LabelKey)
		} else {
			data.SetValue(id, LabelKey, was)
		}
		return fmt.Errorf("write rclone's configuration: %w", err)
	}
	return nil
}

// Add writes a new target called label under an id made from it, and returns
// the id.
func Add(label, backend string, settings map[string]string) (string, error) {
	label = strings.TrimSpace(label)
	data := config.LoadedData()
	if err := checkLabel(data, "", label); err != nil {
		return "", err
	}
	id := freeID(data, label)
	with := maps.Clone(settings)
	if with == nil {
		with = map[string]string{}
	}
	with[LabelKey] = label
	return id, Create(id, backend, with)
}

// freeID makes an id for a target called label: the label with what rclone
// would not take in a remote's name folded into hyphens, numbered when a
// target has it already. Case is ignored in the comparison, since two ids
// that differ only there look like one in a job's path.
func freeID(data config.Storage, label string) string {
	base := idOf(label)
	taken := func(id string) bool {
		for _, other := range data.GetSectionList() {
			if strings.EqualFold(other, id) {
				return true
			}
		}
		return false
	}
	if !taken(base) {
		return base
	}
	for n := 2; ; n++ {
		if next := base + "-" + strconv.Itoa(n); !taken(next) {
			return next
		}
	}
}

// idOf keeps a label's letters, digits and the punctuation rclone allows in a
// remote's name. An id of one character would read as a Windows drive letter.
func idOf(label string) string {
	var b strings.Builder
	for _, r := range label {
		switch {
		case unicode.IsLetter(r), unicode.IsDigit(r), strings.ContainsRune("_.+@", r):
			b.WriteRune(r)
		default:
			b.WriteRune('-')
		}
	}
	id := b.String()
	for strings.Contains(id, "--") {
		id = strings.ReplaceAll(id, "--", "-")
	}
	id = strings.Trim(id, "-.")
	if utf8.RuneCountInString(id) < 2 {
		return "target"
	}
	return id
}
