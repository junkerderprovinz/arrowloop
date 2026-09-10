package remotes

import (
	"sort"
	"strings"
)

// A PROVIDER is what somebody is looking for; a BACKEND is what rclone speaks.
//
// They are not the same thing, and treating them as the same is what made the
// setup screen unusable for the case it exists for. Nextcloud, ownCloud and
// OpenCloud are three products with three websites and three logos, and to
// rclone they are one `webdav` backend distinguished by a `vendor` string.
// Offering "webdav" and expecting somebody to know that is asking them to know
// the implementation in order to use the product. jdp: "Ich möchte jede Cloud
// einzeln aufgelistet haben auch wenn sie das gleiche Protokoll nutzen wie z.b.
// Nextcloud und Opencloud."
//
// So this is the list a person picks from, and each entry says which backend it
// resolves to and what to fill in for them. A backend with no provider entry is
// still reachable: the list ends with the raw backends, so nothing that was
// possible becomes impossible.
type Provider struct {
	// ID is stable and is what the interface sends back. Never a display name:
	// those get translated, and a translated identifier is a bug waiting for
	// its first non-English user.
	ID string `json:"id"`

	// Name is the product's own, and is deliberately NOT translated. A brand is
	// a brand in every language, and "Google Drive" translated into forty-two
	// languages is forty-two chances to name something that does not exist.
	Name string `json:"name"`

	// Backend is the rclone type this becomes.
	Backend string `json:"backend"`

	// Group decides which card it appears on.
	Group Group `json:"group"`

	// Preset is what gets written into the target without anybody being asked.
	// For the three self-hosted clouds this is the `vendor` that makes WebDAV
	// work properly against them rather than merely connect.
	Preset map[string]string `json:"preset,omitempty"`

	// Mark is the component name of this provider's logo, or empty where there
	// is none to use. Empty is a real answer: a mark naming the WRONG service
	// is worse than a generic glyph, so OpenCloud shows no logo rather than
	// ownCloud's, and Microsoft's, Amazon's and Apple's own products have no
	// mark in the CC0 set at all.
	Mark string `json:"mark,omitempty"`

	// Hint is one line about what this is, for the ones whose name does not say
	// it. Empty where the name is enough.
	Hint string `json:"hint,omitempty"`
}

// Group is which of the two cards a provider belongs on.
//
// The split is by what somebody HAS rather than by protocol: an account with a
// company, or a machine and an address. That is the question being answered
// when somebody opens this screen, and it puts Backblaze with the clouds even
// though it speaks S3, and plain S3 with the protocols even though it is
// Amazon's.
type Group string

const (
	// GroupCloud is a service somebody has an account with.
	GroupCloud Group = "cloud"
	// GroupProtocol is a machine, a share or an address somebody reaches.
	GroupProtocol Group = "protocol"
)

// providers is the list, in the order it is offered within each group.
//
// Hand-kept, and it has to be: which products exist, what they are called and
// which of them people here actually use is not something rclone's registry
// knows. The cost is that a new rclone backend does not appear here on its own,
// and the raw-backend fallback below is what keeps that from being a wall.
var providers = []Provider{
	// The self-hosted three: one backend, three products, three entries.
	{ID: "nextcloud", Name: "Nextcloud", Backend: "webdav", Group: GroupCloud,
		Preset: map[string]string{"vendor": "nextcloud"}, Mark: "IconNextcloud"},
	{ID: "owncloud", Name: "ownCloud", Backend: "webdav", Group: GroupCloud,
		Preset: map[string]string{"vendor": "owncloud"}, Mark: "IconOwncloud"},
	{ID: "opencloud", Name: "OpenCloud", Backend: "webdav", Group: GroupCloud,
		// The ownCloud vendor setting, because OpenCloud is its fork and speaks
		// the same dialect. Its OWN mark, taken from its own repository - the
		// CC0 set carries none, and it must never wear ownCloud's, which would
		// name the wrong project.
		Preset: map[string]string{"vendor": "owncloud"},
		Mark:   "IconOpencloud"},

	// The big consumer services.
	{ID: "dropbox", Name: "Dropbox", Backend: "dropbox", Group: GroupCloud, Mark: "IconDropbox"},
	{ID: "gdrive", Name: "Google Drive", Backend: "drive", Group: GroupCloud, Mark: "IconGoogleDrive"},
	{ID: "onedrive", Name: "OneDrive", Backend: "onedrive", Group: GroupCloud, Mark: "IconOnedrive"},
	{ID: "mega", Name: "MEGA", Backend: "mega", Group: GroupCloud, Mark: "IconMega"},
	{ID: "pcloud", Name: "pCloud", Backend: "pcloud", Group: GroupCloud, Mark: "IconPcloud"},
	{ID: "box", Name: "Box", Backend: "box", Group: GroupCloud, Mark: "IconBox"},
	{ID: "protondrive", Name: "Proton Drive", Backend: "protondrive", Group: GroupCloud, Mark: "IconProtonDrive"},
	{ID: "icloud", Name: "iCloud Drive", Backend: "iclouddrive", Group: GroupCloud, Mark: "IconICloud"},

	// The rest of the consumer field.
	{ID: "jottacloud", Name: "Jottacloud", Backend: "jottacloud", Group: GroupCloud, Mark: "IconJottacloud"},
	{ID: "koofr", Name: "Koofr", Backend: "koofr", Group: GroupCloud, Mark: "IconKoofr"},
	{ID: "seafile", Name: "Seafile", Backend: "seafile", Group: GroupCloud, Mark: "IconSeafile"},
	{ID: "opendrive", Name: "OpenDrive", Backend: "opendrive", Group: GroupCloud, Mark: "IconOpendrive"},
	{ID: "yandex", Name: "Yandex Disk", Backend: "yandex", Group: GroupCloud, Mark: "IconYandex"},
	{ID: "mailru", Name: "Mail.ru Cloud", Backend: "mailru", Group: GroupCloud, Mark: "IconMailru"},
	{ID: "zoho", Name: "Zoho WorkDrive", Backend: "zoho", Group: GroupCloud, Mark: "IconZoho"},
	{ID: "hidrive", Name: "IONOS HiDrive", Backend: "hidrive", Group: GroupCloud, Mark: "IconIonos",
		Hint: "IONOS's storage."},
	{ID: "sharefile", Name: "ShareFile", Backend: "sharefile", Group: GroupCloud, Mark: "IconCitrix"},
	{ID: "sugarsync", Name: "SugarSync", Backend: "sugarsync", Group: GroupCloud, Mark: "IconSugarsync"},
	{ID: "putio", Name: "put.io", Backend: "putio", Group: GroupCloud, Mark: "IconPutio"},
	{ID: "pikpak", Name: "PikPak", Backend: "pikpak", Group: GroupCloud, Mark: "IconPikpak"},
	{ID: "internxt", Name: "Internxt", Backend: "internxt", Group: GroupCloud, Mark: "IconInternxt"},
	{ID: "filen", Name: "Filen", Backend: "filen", Group: GroupCloud, Mark: "IconFilen"},
	{ID: "filescom", Name: "Files.com", Backend: "filescom", Group: GroupCloud, Mark: "IconFilesCom"},
	{ID: "huaweidrive", Name: "Huawei Drive", Backend: "huaweidrive", Group: GroupCloud, Mark: "IconHuawei"},
	{ID: "ulozto", Name: "Uloz.to", Backend: "ulozto", Group: GroupCloud, Mark: "IconUlozto"},
	{ID: "quatrix", Name: "Quatrix", Backend: "quatrix", Group: GroupCloud, Mark: "IconQuatrix"},
	{ID: "linkbox", Name: "Linkbox", Backend: "linkbox", Group: GroupCloud, Mark: "IconLinkbox"},
	{ID: "gofile", Name: "Gofile", Backend: "gofile", Group: GroupCloud, Mark: "IconGofile"},
	{ID: "pixeldrain", Name: "Pixeldrain", Backend: "pixeldrain", Group: GroupCloud, Mark: "IconPixeldrain"},
	{ID: "googlephotos", Name: "Google Photos", Backend: "googlephotos", Group: GroupCloud,
		Mark: "IconGooglePhotos", Hint: "Photos only, and read-mostly."},

	// Object storage: an account with a company, so it belongs with the clouds
	// however it is addressed underneath.
	{ID: "b2", Name: "Backblaze B2", Backend: "b2", Group: GroupCloud, Mark: "IconBackblaze"},
	{ID: "azureblob", Name: "Azure Blob Storage", Backend: "azureblob", Group: GroupCloud, Mark: "IconAzure"},
	{ID: "gcs", Name: "Google Cloud Storage", Backend: "googlecloudstorage", Group: GroupCloud, Mark: "IconGoogleCloud"},
	// Huawei's OTHER storage, and the reason both are listed: `huaweidrive`
	// above is the consumer Drive, this is the platform's object storage, and
	// somebody looking for one of them would not accept the other. It reaches
	// it the way rclone does, as an S3 provider, which is the same arrangement
	// that puts Nextcloud, ownCloud and OpenCloud on one webdav backend: the
	// list is products, the backends are plumbing.
	{ID: "huaweiobs", Name: "Huawei Cloud OBS", Backend: "s3", Group: GroupCloud,
		Preset: map[string]string{"provider": "HuaweiOBS"}, Mark: "IconHuaweiCloud"},
	{ID: "oracle", Name: "Oracle Object Storage", Backend: "oracleobjectstorage", Group: GroupCloud, Mark: "IconOracleCloud"},
	{ID: "storj", Name: "Storj", Backend: "storj", Group: GroupCloud, Mark: "IconStorj"},
	{ID: "swift", Name: "OpenStack Swift", Backend: "swift", Group: GroupCloud, Mark: "IconOpenstack"},
	{ID: "netstorage", Name: "Akamai NetStorage", Backend: "netstorage", Group: GroupCloud, Mark: "IconAkamai"},
	{ID: "cloudinary", Name: "Cloudinary", Backend: "cloudinary", Group: GroupCloud, Mark: "IconCloudinary"},
	{ID: "internetarchive", Name: "Internet Archive", Backend: "internetarchive", Group: GroupCloud,
		Mark: "IconInternetArchive"},

	// Machines, shares and addresses.
	{ID: "smb", Name: "SMB / Windows share", Backend: "smb", Group: GroupProtocol,
		Mark: "IconFolder", Hint: "A shared folder on a NAS or a Windows machine."},
	{ID: "sftp", Name: "SFTP", Backend: "sftp", Group: GroupProtocol,
		Mark: "IconTargets", Hint: "A server reached over SSH."},
	{ID: "webdav", Name: "WebDAV", Backend: "webdav", Group: GroupProtocol,
		Mark: "IconLink", Hint: "Any WebDAV server. Pick the product above if it has an entry."},
	{ID: "ftp", Name: "FTP", Backend: "ftp", Group: GroupProtocol, Mark: "IconTargets"},
	{ID: "s3", Name: "S3 compatible", Backend: "s3", Group: GroupProtocol,
		Mark: "IconTargets", Hint: "Amazon S3 and the thirty-odd services that speak its protocol."},
	{ID: "http", Name: "HTTP", Backend: "http", Group: GroupProtocol,
		Mark: "IconLink", Hint: "Read-only, over a plain web server."},
	{ID: "hdfs", Name: "HDFS", Backend: "hdfs", Group: GroupProtocol, Mark: "IconHadoop"},
	{ID: "crypt", Name: "Encrypted", Backend: "crypt", Group: GroupProtocol,
		Mark: "IconHidden", Hint: "Wraps another target and encrypts what goes into it."},
}

// Providers lists what can be offered on this build, which is the ones whose
// backend is actually compiled in.
//
// Filtered rather than assumed: a provider offered for a backend the binary
// does not carry produces a target that fails the first time it runs, with an
// error about a missing section rather than about the thing that is really
// wrong.
func Providers() []Provider {
	have := map[string]bool{}
	for _, b := range Backends() {
		have[b.Name] = true
	}
	out := make([]Provider, 0, len(providers))
	for _, p := range providers {
		if have[p.Backend] {
			out = append(out, p)
		}
	}
	// Alphabetical, within each group. The table above is written in rough
	// order of how often anybody reaches for one, and that order only helps
	// somebody who already agrees with it: anybody looking for a particular
	// name has to read the whole list to find out it is not near the top.
	// A name is what somebody arrives with, so a name is what the order uses.
	//
	// Case-insensitive, because "ownCloud" and "OpenDrive" would otherwise sort
	// by their capitals rather than by how they read.
	sort.SliceStable(out, func(i, j int) bool {
		if out[i].Group != out[j].Group {
			return out[i].Group == GroupCloud
		}
		return strings.ToLower(out[i].Name) < strings.ToLower(out[j].Name)
	})
	return out
}

// UnlistedBackends are the compiled-in backends no provider entry covers.
//
// They are offered after the list, and that is what keeps the hand-kept table
// above from being a wall: a backend nobody has written an entry for is still
// reachable by its rclone name, so the day rclone gains one it works here
// before anybody gets round to naming it.
func UnlistedBackends() []Backend {
	named := map[string]bool{}
	for _, p := range providers {
		named[p.Backend] = true
	}
	// An empty SLICE rather than a nil one, because a nil slice marshals to
	// JSON null and a browser handed null where it was promised a list falls
	// over on the first map. There is a test for exactly this across every
	// endpoint, and it caught this the moment the field was added.
	out := []Backend{}
	for _, b := range Backends() {
		if !named[b.Name] {
			out = append(out, b)
		}
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Name < out[j].Name })
	return out
}

// FindProvider returns the entry with this id.
func FindProvider(id string) (Provider, bool) {
	for _, p := range providers {
		if p.ID == id {
			return p, true
		}
	}
	return Provider{}, false
}
