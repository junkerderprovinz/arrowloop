package remotes

import (
	"sort"
	"strings"
)

// Provider is a product somebody looks for, as opposed to the rclone backend
// that reaches it: Nextcloud, ownCloud and OpenCloud are three products and one
// webdav backend. A backend with no provider entry is still offered after the
// list.
type Provider struct {
	// ID is stable and is what the interface sends back. Display names are
	// translated, so they cannot serve as identifiers.
	ID string `json:"id"`

	// Name is the product's own and is not translated.
	Name string `json:"name"`

	// Backend is the rclone type this becomes.
	Backend string `json:"backend"`

	// Group decides which card it appears on.
	Group Group `json:"group"`

	// Preset is written into the target without anybody being asked, such as
	// the vendor that makes WebDAV work properly against a self-hosted cloud.
	Preset map[string]string `json:"preset,omitempty"`

	// Mark is the component name of this provider's logo, or empty where there
	// is none. A mark naming the wrong service is worse than a generic glyph.
	Mark string `json:"mark,omitempty"`

	// Hint is one line about what this is, for the ones whose name does not say
	// it.
	Hint string `json:"hint,omitempty"`

	// UrlHint is the shape this product's address takes, where it is not the
	// address people already have in their browser. The WebDAV products share
	// one backend and each has its own path.
	UrlHint string `json:"urlHint,omitempty"`

	// Auth says how this product wants to be signed into. The interface turns
	// it into one translated sentence per style and ignores a style it does
	// not know.
	Auth AuthStyle `json:"auth,omitempty"`

	// AuthURL is the page where the credential is created, where there is a
	// shared one to point at. Empty where the page is on somebody's own server.
	AuthURL string `json:"authUrl,omitempty"`
}

// AuthStyle is how a product wants to be signed into. The set is closed,
// because every value needs a sentence in the interface in every language.
type AuthStyle string

const (
	// AuthAppPassword is a password generated in the account's security
	// settings and used instead of the login password, which cannot work once
	// two-factor authentication is on. The self-hosted clouds all work this
	// way.
	AuthAppPassword AuthStyle = "apppassword"

	// AuthOAuth is a sign-in that happens in a browser rather than in a field,
	// so the token cannot be typed.
	AuthOAuth AuthStyle = "oauth"

	// AuthAPIKey is a key and secret pair created in the service's own console.
	AuthAPIKey AuthStyle = "apikey"

	// AuthAccessKey is the S3 pair: a public access key id and a secret.
	AuthAccessKey AuthStyle = "accesskey"

	// AuthLogin is the ordinary user name and password, with nothing to fetch
	// first.
	AuthLogin AuthStyle = "login"
)

// Group is which of the three cards a provider belongs on.
//
// A service that hands out buckets is storage, whoever runs the machine, so
// MinIO, SeaweedFS, Ceph and Garage are storage although they ask for an
// endpoint. Of the rest, a service somebody signs into by name is a cloud and
// something they point at by address is a protocol; HDFS is a filesystem with
// directories and stays a protocol. Nextcloud, ownCloud, OpenCloud and Seafile
// ask for a server URL but are clouds, because people look for them by name.
type Group string

const (
	// GroupCloud is a service somebody signs into and keeps folders in.
	GroupCloud Group = "cloud"
	// GroupStorage is a bucket store: an access key, a secret and containers
	// with nothing in them until somebody adds something.
	GroupStorage Group = "storage"
	// GroupProtocol is a machine, a share or an address somebody types in.
	GroupProtocol Group = "protocol"
)

// providers is the hand-kept list of products, since rclone's registry does
// not know what products exist or what they are called. A backend missing
// from it is still offered through UnlistedBackends.
var providers = []Provider{
	{ID: "nextcloud", Name: "Nextcloud", Auth: AuthAppPassword, Backend: "webdav", Group: GroupCloud,
		Preset: map[string]string{"vendor": "nextcloud"}, Mark: "IconNextcloud",
		UrlHint: "https://cloud.example.com/remote.php/webdav/"},
	{ID: "owncloud", Name: "ownCloud", Auth: AuthAppPassword, Backend: "webdav", Group: GroupCloud,
		Preset: map[string]string{"vendor": "owncloud"}, Mark: "IconOwncloud",
		UrlHint: "https://cloud.example.com/remote.php/webdav/"},
	{ID: "opencloud", Name: "OpenCloud", Auth: AuthAppPassword, Backend: "webdav", Group: GroupCloud,
		// OpenCloud is a fork of ownCloud Infinite Scale, not of ownCloud 10,
		// whose vendor setting speaks the older PHP server's dialect. Its mark
		// comes from its own repository, since the CC0 set has none.
		Preset: map[string]string{"vendor": "infinitescale"},
		Mark:   "IconOpencloud",
		// Infinite Scale's address for the personal space, as rclone documents
		// it. Other spaces have their own address in their details panel.
		UrlHint: "https://cloud.example.com/remote.php/webdav"},

	{ID: "dropbox", Name: "Dropbox", Backend: "dropbox", Group: GroupCloud, Mark: "IconDropbox"},
	{ID: "gdrive", Name: "Google Drive", Backend: "drive", Group: GroupCloud, Mark: "IconGoogleDrive"},
	{ID: "onedrive", Name: "OneDrive", Backend: "onedrive", Group: GroupCloud, Mark: "IconOnedrive"},
	{ID: "mega", Name: "MEGA", Backend: "mega", Group: GroupCloud, Mark: "IconMega"},
	{ID: "pcloud", Name: "pCloud", Backend: "pcloud", Group: GroupCloud, Mark: "IconPcloud"},
	{ID: "box", Name: "Box", Backend: "box", Group: GroupCloud, Mark: "IconBox"},
	{ID: "protondrive", Name: "Proton Drive", Backend: "protondrive", Group: GroupCloud, Mark: "IconProtonDrive"},
	{ID: "icloud", Name: "iCloud Drive", Auth: AuthAppPassword, Backend: "iclouddrive", Group: GroupCloud, Mark: "IconICloud"},

	{ID: "jottacloud", Name: "Jottacloud", Backend: "jottacloud", Group: GroupCloud, Mark: "IconJottacloud"},
	// Koofr's fields look like an ordinary login, but rclone's own help says
	// the password is generated in the service's settings.
	{ID: "koofr", Name: "Koofr", Auth: AuthAppPassword, Backend: "koofr", Group: GroupCloud, Mark: "IconKoofr"},
	{ID: "seafile", Name: "Seafile", Auth: AuthAppPassword, Backend: "seafile", Group: GroupCloud, Mark: "IconSeafile"},
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
	{ID: "huaweidrive", Name: "Huawei Drive", Backend: "huaweidrive", Group: GroupCloud, Mark: "IconHuaweiCloud"},
	// The name keeps the company's caron; the ID stays ASCII.
	{ID: "ulozto", Name: "Ulož.to", Backend: "ulozto", Group: GroupCloud, Mark: "IconUlozto"},
	{ID: "quatrix", Name: "Quatrix", Backend: "quatrix", Group: GroupCloud, Mark: "IconQuatrix"},
	{ID: "linkbox", Name: "Linkbox", Backend: "linkbox", Group: GroupCloud, Mark: "IconLinkbox"},
	{ID: "gofile", Name: "Gofile", Backend: "gofile", Group: GroupCloud, Mark: "IconGofile"},
	{ID: "pixeldrain", Name: "Pixeldrain", Backend: "pixeldrain", Group: GroupCloud, Mark: "IconPixeldrain"},
	{ID: "googlephotos", Name: "Google Photos", Backend: "google photos", Group: GroupCloud,
		Mark: "IconGooglePhotos", Hint: "Photos only, and read-mostly."},

	{ID: "b2", Name: "Backblaze B2", Backend: "b2", Group: GroupStorage, Mark: "IconBackblaze"},
	{ID: "azureblob", Name: "Azure Blob Storage", Backend: "azureblob", Group: GroupStorage, Mark: "IconAzure"},
	{ID: "gcs", Name: "Google Cloud Storage", Backend: "google cloud storage", Group: GroupStorage, Mark: "IconGoogleCloud"},
	// Huawei's object storage, a different product from huaweidrive above,
	// reached as an S3 provider.
	{ID: "huaweiobs", Name: "Huawei Cloud OBS", Backend: "s3", Group: GroupStorage,
		Preset: map[string]string{"provider": "HuaweiOBS"}, Mark: "IconHuaweiCloud"},

	// S3-compatible services by name, so nobody has to know to pick S3. The
	// Preset values are rclone's own spelling: rclone silently treats an
	// unknown provider as plain S3.
	{ID: "wasabi", Name: "Wasabi", Backend: "s3", Group: GroupStorage,
		Preset: map[string]string{"provider": "Wasabi"}, Mark: "IconWasabi"},
	{ID: "r2", Name: "Cloudflare R2", Backend: "s3", Group: GroupStorage,
		Preset: map[string]string{"provider": "Cloudflare"}, Mark: "IconCloudflare"},
	{ID: "spaces", Name: "DigitalOcean Spaces", Backend: "s3", Group: GroupStorage,
		Preset: map[string]string{"provider": "DigitalOcean"}, Mark: "IconDigitalOcean"},
	{ID: "idrivee2", Name: "IDrive e2", Backend: "s3", Group: GroupStorage,
		Preset: map[string]string{"provider": "IDrive"}, Mark: "IconIdrive"},
	{ID: "scaleway", Name: "Scaleway Object Storage", Backend: "s3", Group: GroupStorage,
		Preset: map[string]string{"provider": "Scaleway"}, Mark: "IconScaleway"},
	{ID: "hetznerobj", Name: "Hetzner Object Storage", Backend: "s3", Group: GroupStorage,
		Preset: map[string]string{"provider": "Hetzner"}, Mark: "IconHetzner"},
	// A different IONOS product from HiDrive above.
	{ID: "ionosobj", Name: "IONOS Object Storage", Backend: "s3", Group: GroupStorage,
		Preset: map[string]string{"provider": "IONOS"}, Mark: "IconIonos"},
	{ID: "linode", Name: "Linode Object Storage", Backend: "s3", Group: GroupStorage,
		Preset: map[string]string{"provider": "Linode"}, Mark: "IconLinode"},
	{ID: "ovh", Name: "OVHcloud Object Storage", Backend: "s3", Group: GroupStorage,
		Preset: map[string]string{"provider": "OVHcloud"}, Mark: "IconOvh"},
	{ID: "synologyc2", Name: "Synology C2", Backend: "s3", Group: GroupStorage,
		Preset: map[string]string{"provider": "Synology"}, Mark: "IconSynology"},
	{ID: "oracle", Name: "Oracle Object Storage", Backend: "oracleobjectstorage", Group: GroupStorage, Mark: "IconOracleCloud"},
	{ID: "storj", Name: "Storj", Backend: "storj", Group: GroupStorage, Mark: "IconStorj"},
	{ID: "swift", Name: "OpenStack Swift", Backend: "swift", Group: GroupStorage, Mark: "IconOpenstack"},
	{ID: "netstorage", Name: "Akamai NetStorage", Backend: "netstorage", Group: GroupStorage, Mark: "IconAkamai"},
	{ID: "cloudinary", Name: "Cloudinary", Backend: "cloudinary", Group: GroupStorage, Mark: "IconCloudinary"},
	{ID: "internetarchive", Name: "Internet Archive", Backend: "internetarchive", Group: GroupStorage,
		Mark: "IconInternetArchive"},

	// Bucket stores somebody runs themselves.
	{ID: "minio", Name: "MinIO", Backend: "s3", Group: GroupStorage,
		Preset: map[string]string{"provider": "Minio"}, Mark: "IconMinio",
		Hint: "A bucket store you run yourself. Needs its endpoint address."},
	{ID: "seaweedfs", Name: "SeaweedFS", Backend: "s3", Group: GroupStorage,
		Preset: map[string]string{"provider": "SeaweedFS"}, Mark: "IconSeaweedfs",
		Hint: "A bucket store you run yourself. Needs its endpoint address."},
	{ID: "ceph", Name: "Ceph", Backend: "s3", Group: GroupStorage,
		Preset: map[string]string{"provider": "Ceph"}, Mark: "IconCeph",
		Hint: "A bucket store you run yourself. Needs its endpoint address."},
	{ID: "garage", Name: "Garage", Backend: "s3", Group: GroupStorage,
		// rclone has no Garage preset, and Garage's own documentation
		// configures it as a generic S3 service.
		Preset: map[string]string{"provider": "Other"}, Mark: "IconGarage",
		Hint: "A bucket store you run yourself. Needs its endpoint address."},
	{ID: "smb", Name: "SMB / Windows share", Backend: "smb", Group: GroupProtocol,
		Mark: "IconFolder", Hint: "A shared folder on a NAS or a Windows machine."},
	{ID: "sftp", Name: "SFTP", Backend: "sftp", Group: GroupProtocol,
		Mark: "IconServer", Hint: "A server reached over SSH."},
	{ID: "webdav", Name: "WebDAV", Auth: AuthAppPassword, Backend: "webdav", Group: GroupProtocol,
		Mark: "IconLink", Hint: "Any WebDAV server. Pick the product above if it has an entry.",
		UrlHint: "https://server.example.com/remote.php/webdav/"},
	{ID: "ftp", Name: "FTP", Backend: "ftp", Group: GroupProtocol, Mark: "IconTransfer"},
	{ID: "s3", Name: "S3 compatible", Backend: "s3", Group: GroupStorage,
		Mark: "IconBuckets", Hint: "Amazon S3 and the thirty-odd services that speak its protocol."},
	{ID: "http", Name: "HTTP", Backend: "http", Group: GroupProtocol,
		Mark: "IconLink", Hint: "Read-only, over a plain web server."},
	{ID: "hdfs", Name: "HDFS", Backend: "hdfs", Group: GroupProtocol, Mark: "IconHadoop"},
	{ID: "crypt", Name: "Encrypted", Backend: "crypt", Group: GroupProtocol,
		Mark: "IconLock", Hint: "Wraps another target and encrypts what goes into it."},
}

// groupOrder is the order the three cards appear in: clouds first, because
// that is what most people are looking for, and protocols last.
func groupOrder(g Group) int {
	switch g {
	case GroupCloud:
		return 0
	case GroupStorage:
		return 1
	default:
		return 2
	}
}

// Providers lists the providers whose backend is compiled into this build,
// alphabetically within each group.
func Providers() []Provider {
	have := map[string]Backend{}
	for _, b := range Backends() {
		have[b.Name] = b
	}
	out := make([]Provider, 0, len(providers))
	for _, p := range providers {
		b, ok := have[p.Backend]
		if !ok {
			continue
		}
		// A hand-written style wins over the derived one.
		if p.Auth == "" {
			p.Auth = derivedAuth(b)
		}
		out = append(out, p)
	}
	// Case-insensitive, so "ownCloud" sorts by how it reads.
	sort.SliceStable(out, func(i, j int) bool {
		if out[i].Group != out[j].Group {
			return groupOrder(out[i].Group) < groupOrder(out[j].Group)
		}
		return strings.ToLower(out[i].Name) < strings.ToLower(out[j].Name)
	})
	return out
}

// derivedAuth works out how a backend wants to be signed into from the fields
// it asks for, so the styles follow rclone rather than a table that goes stale.
// Only two unmistakable shapes are read and everything else is empty, because
// a wrong sentence sends somebody looking in the wrong place.
func derivedAuth(b Backend) AuthStyle {
	// NeedsToken already puts its own note above the fields.
	if b.NeedsToken {
		return ""
	}

	var hasKeyID, hasKeySecret, hasUser, hasPass, hasToken bool
	for _, o := range b.Options {
		// Advanced options carry alternative credentials the form never
		// offers.
		if !o.Required && !o.Essential {
			continue
		}
		switch o.Name {
		case "access_key_id", "account":
			hasKeyID = true
		case "secret_access_key", "key", "secret":
			hasKeySecret = true
		case "user", "username", "apple_id", "email":
			hasUser = true
		case "pass", "password":
			hasPass = true
		case "token", "app_token", "api_key", "access_token":
			hasToken = true
		}
	}

	switch {
	// S3, b2's account and key, and netstorage's account and secret.
	case hasKeyID && hasKeySecret:
		return AuthAccessKey
	// A token beside the login, as Linkbox, Ulozto and Filen ask for, means
	// there is something to fetch after all.
	case hasUser && hasPass && !hasToken:
		return AuthLogin
	}
	return ""
}

// UnlistedBackends are the compiled-in backends no provider entry covers, so a
// new rclone backend is reachable by its rclone name before anybody lists it.
func UnlistedBackends() []Backend {
	named := map[string]bool{}
	for _, p := range providers {
		named[p.Backend] = true
	}
	// Not nil, so it marshals as a list.
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
