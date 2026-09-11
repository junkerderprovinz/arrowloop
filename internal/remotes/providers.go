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

	// UrlHint is what this product's address looks like, for the backends where
	// the address is not the thing people already have in their browser.
	//
	// WebDAV is the case that needs it: three products share one backend and
	// each has its own path, and "URL of http host to connect to" - rclone's
	// own words for the field - helps nobody who is looking at their Nextcloud
	// in a tab and wondering which part to copy. jdp: "kann man einen hinweis
	// hinterlegen wie die URL jeweils aussehen muss?"
	//
	// A shape rather than a sentence: what somebody needs here is the pattern
	// their own address has to match.
	UrlHint string `json:"urlHint,omitempty"`

	// Auth names HOW this product wants to be signed into, as one of a closed
	// set of tokens rather than as prose.
	//
	// The screen turns it into a sentence, and that split is the whole point.
	// jdp: "Bitte die infobubbles ausführlicher. wenn man zb ein API TOken
	// braucht soll drin stehen wo man den herbekommt usw. User müssen ganz
	// einfach verstehen können was wo reingeschrieben werden muss." Written as
	// prose HERE it would be one English paragraph per provider in a table that
	// has no language at all; written as a token it is one translated sentence
	// per STYLE, shared by every product that uses that style.
	//
	// The value is stable and the screen falls back silently on one it does not
	// know, so a new provider can name a style before anybody has written its
	// sentence.
	Auth AuthStyle `json:"auth,omitempty"`

	// AuthURL is the page where the credential above is created, where there is
	// one to point at. A bare address, for the same reason UrlHint is: it needs
	// no translation and it goes stale in exactly one place.
	//
	// Empty where the page is inside somebody's OWN server - a Nextcloud's
	// security settings live at their address, not at a shared one - and the
	// sentence for that style says where to look instead.
	AuthURL string `json:"authUrl,omitempty"`
}

// AuthStyle is how a product wants to be signed into.
//
// A closed set on purpose. Every value here has to have a sentence written for
// it in the interface, in every language, so adding one is a decision rather
// than a typo - and a product whose style is genuinely new gets a new value
// instead of a paragraph of its own.
type AuthStyle string

const (
	// AuthAppPassword is a password generated in the account's own security
	// settings, used INSTEAD of the login password. The self-hosted clouds all
	// work this way, and getting this wrong is the single most common reason a
	// WebDAV target refuses a password that is plainly correct: with two-factor
	// authentication switched on, the login password cannot work here at all.
	AuthAppPassword AuthStyle = "apppassword"

	// AuthOAuth is a sign-in that happens in a browser rather than in a field.
	// The token cannot be typed, and this style exists to say so: the screen
	// otherwise shows an empty box for something nobody can fill in.
	AuthOAuth AuthStyle = "oauth"

	// AuthAPIKey is a key and secret pair created in the service's own console.
	AuthAPIKey AuthStyle = "apikey"

	// AuthAccessKey is the S3 pair: an access key id, which is public and
	// appears in every tutorial, and a secret that is not.
	AuthAccessKey AuthStyle = "accesskey"

	// AuthLogin is the ordinary case: the same user name and password used to
	// sign in anywhere else, with nothing to fetch first.
	AuthLogin AuthStyle = "login"
)

// Group is which of the three cards a provider belongs on.
//
// The split is by what somebody HAS rather than by protocol: an account with a
// company, or a machine and an address. That is the question being answered
// when somebody opens this screen, and it puts plain S3 with the protocols even
// though it is Amazon's.
type Group string

const (
	// GroupCloud is a service somebody SIGNS IN TO and keeps FILES in: a name
	// they already know, reached by pressing its button and giving it a
	// password, and what comes back is folders they recognise.
	GroupCloud Group = "cloud"
	// GroupStorage is signed into the same way and gives back BUCKETS: an
	// access key, a secret, and a container with no folders in it until
	// somebody makes some.
	GroupStorage Group = "storage"
	// GroupProtocol is something somebody POINTS AT: a machine, a share or an
	// address they have to type in.
	GroupProtocol Group = "protocol"
)

// WHICH GROUP A NEW ENTRY BELONGS IN, because the obvious question is the
// wrong one.
//
// It is not "who owns the machine". By that reading MinIO and SeaweedFS sat
// with the clouds for months on the argument that what you have is an account
// with a bucket store even when the hardware is your own - and somebody
// looking for them went through fifty consumer services first (jdp: "ist
// seaweedfs und object storage nicht im falschen abschnitt?").
//
// The question is WHAT SOMEBODY TYPES, because that is what they are holding
// when they open this list:
//
//   - a name they know and a password  ->  GroupCloud or GroupStorage
//   - an address, host or endpoint     ->  GroupProtocol
//
// MinIO asks for an endpoint, so it sits with the machines. Dropbox asks for
// nothing but a button, so it sits with the services.
//
// THE SECOND CUT, inside the first group, is what comes BACK: files or buckets.
// A cloud hands over folders somebody recognises; a bucket store hands over a
// container with an access key and a secret and nothing in it until they make
// something. Both are signed into, so the typing rule could not tell them
// apart - and it did not, which is how one card came to hold fifty-two entries
// with a photo service three rows from a CDN (jdp: "speicher und clouds sind
// noch nicht sortiert"). Alphabetical order inside one card cannot fix that;
// it is what interleaves them.
//
// THE ONE EXCEPTION, and it is jdp's call rather than a hole in the rule:
// Nextcloud, ownCloud, OpenCloud and Seafile stay with the clouds even though
// they ask for a server URL. They carry a BRAND somebody goes looking for by
// name - "where is Nextcloud" is the question, not "what is at this address" -
// and a list that answers the second question when somebody asked the first
// is a list they scroll past. The typing rule decides everything else,
// including the four self-hosted bucket stores, which have no such name in
// anybody's head.

// providers is the list, in the order it is offered within each group.
//
// Hand-kept, and it has to be: which products exist, what they are called and
// which of them people here actually use is not something rclone's registry
// knows. The cost is that a new rclone backend does not appear here on its own,
// and the raw-backend fallback below is what keeps that from being a wall.
var providers = []Provider{
	// The self-hosted three: one backend, three products, three entries.
	{ID: "nextcloud", Name: "Nextcloud", Auth: AuthAppPassword, Backend: "webdav", Group: GroupCloud,
		Preset: map[string]string{"vendor": "nextcloud"}, Mark: "IconNextcloud",
		UrlHint: "https://cloud.example.com/remote.php/webdav/"},
	{ID: "owncloud", Name: "ownCloud", Auth: AuthAppPassword, Backend: "webdav", Group: GroupCloud,
		Preset: map[string]string{"vendor": "owncloud"}, Mark: "IconOwncloud",
		UrlHint: "https://cloud.example.com/remote.php/webdav/"},
	{ID: "opencloud", Name: "OpenCloud", Auth: AuthAppPassword, Backend: "webdav", Group: GroupCloud,
		// `infinitescale`, not `owncloud`. OpenCloud is a fork of ownCloud
		// Infinite Scale rather than of ownCloud 10, and rclone carries a
		// vendor for each: the 10 setting speaks the older PHP server's
		// dialect. Its OWN mark, taken from its own repository - the CC0 set
		// carries none, and it must never wear ownCloud's, which would name the
		// wrong project.
		Preset: map[string]string{"vendor": "infinitescale"},
		Mark:   "IconOpencloud"},
	// No UrlHint on purpose. Infinite Scale gives every space its own
	// address - rclone's own documentation says to read it out of the
	// space's details panel - so there is no pattern to print, and a made-up
	// one would be worse than none. This field carries a URL SHAPE and
	// nothing else: a sentence here would be an untranslated string in a
	// table that has no language.

	// The big consumer services.
	{ID: "dropbox", Name: "Dropbox", Backend: "dropbox", Group: GroupCloud, Mark: "IconDropbox"},
	{ID: "gdrive", Name: "Google Drive", Backend: "drive", Group: GroupCloud, Mark: "IconGoogleDrive"},
	{ID: "onedrive", Name: "OneDrive", Backend: "onedrive", Group: GroupCloud, Mark: "IconOnedrive"},
	{ID: "mega", Name: "MEGA", Backend: "mega", Group: GroupCloud, Mark: "IconMega"},
	{ID: "pcloud", Name: "pCloud", Backend: "pcloud", Group: GroupCloud, Mark: "IconPcloud"},
	{ID: "box", Name: "Box", Backend: "box", Group: GroupCloud, Mark: "IconBox"},
	{ID: "protondrive", Name: "Proton Drive", Backend: "protondrive", Group: GroupCloud, Mark: "IconProtonDrive"},
	{ID: "icloud", Name: "iCloud Drive", Auth: AuthAppPassword, Backend: "iclouddrive", Group: GroupCloud, Mark: "IconICloud"},

	// The rest of the consumer field.
	{ID: "jottacloud", Name: "Jottacloud", Backend: "jottacloud", Group: GroupCloud, Mark: "IconJottacloud"},
	// Koofr's fields are a user and a password, so the shape says an ordinary
	// login - and rclone's OWN help for that field says otherwise: "Your
	// password for rclone (generate one at your service's settings page)".
	// One of exactly two places in sixty-eight backends where the option list
	// and the truth disagree, and the only one rclone itself flags.
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
	// "Ulož.to" with the caron, which is how the company writes it. jdp:
	// "überm z fehlt das zeichen." The ID stays ASCII on purpose - it is what
	// the interface sends back, and an identifier that needs a keyboard layout
	// is an identifier waiting to be mistyped.
	{ID: "ulozto", Name: "Ulož.to", Backend: "ulozto", Group: GroupCloud, Mark: "IconUlozto"},
	{ID: "quatrix", Name: "Quatrix", Backend: "quatrix", Group: GroupCloud, Mark: "IconQuatrix"},
	{ID: "linkbox", Name: "Linkbox", Backend: "linkbox", Group: GroupCloud, Mark: "IconLinkbox"},
	{ID: "gofile", Name: "Gofile", Backend: "gofile", Group: GroupCloud, Mark: "IconGofile"},
	{ID: "pixeldrain", Name: "Pixeldrain", Backend: "pixeldrain", Group: GroupCloud, Mark: "IconPixeldrain"},
	{ID: "googlephotos", Name: "Google Photos", Backend: "google photos", Group: GroupCloud,
		Mark: "IconGooglePhotos", Hint: "Photos only, and read-mostly."},

	// Object storage: an account with a company, so it belongs with the clouds
	// however it is addressed underneath.
	{ID: "b2", Name: "Backblaze B2", Backend: "b2", Group: GroupStorage, Mark: "IconBackblaze"},
	{ID: "azureblob", Name: "Azure Blob Storage", Backend: "azureblob", Group: GroupStorage, Mark: "IconAzure"},
	{ID: "gcs", Name: "Google Cloud Storage", Backend: "google cloud storage", Group: GroupStorage, Mark: "IconGoogleCloud"},
	// Huawei's OTHER storage, and the reason both are listed: `huaweidrive`
	// above is the consumer Drive, this is the platform's object storage, and
	// somebody looking for one of them would not accept the other. It reaches
	// it the way rclone does, as an S3 provider, which is the same arrangement
	// that puts Nextcloud, ownCloud and OpenCloud on one webdav backend: the
	// list is products, the backends are plumbing.
	{ID: "huaweiobs", Name: "Huawei Cloud OBS", Backend: "s3", Group: GroupStorage,
		Preset: map[string]string{"provider": "HuaweiOBS"}, Mark: "IconHuaweiCloud"},

	// The S3-compatible field, by name. rclone knows fifty-three of these and
	// this list offered one generic entry, so somebody looking for Wasabi or R2
	// found nothing among fifty-one products and had to know to pick "S3" and
	// then set a field correctly. Each is one preset away, exactly as Huawei
	// OBS above already was, and the generic entry stays for the rest.
	//
	// The Preset values are rclone's OWN spelling from that list. A typo here
	// would not announce itself: rclone accepts an unknown provider and falls
	// back to plain S3, which works for most of them and quietly drops whatever
	// the named one does differently.
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
	// IONOS twice, and deliberately: HiDrive above is the consumer drive, this
	// is the object storage. Same company, two products, and somebody looking
	// for one would not accept the other - the same arrangement as the two
	// Huawei entries.
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
	{ID: "swift", Name: "OpenStack Swift", Backend: "swift", Group: GroupProtocol, Mark: "IconOpenstack"},
	{ID: "netstorage", Name: "Akamai NetStorage", Backend: "netstorage", Group: GroupStorage, Mark: "IconAkamai"},
	{ID: "cloudinary", Name: "Cloudinary", Backend: "cloudinary", Group: GroupStorage, Mark: "IconCloudinary"},
	{ID: "internetarchive", Name: "Internet Archive", Backend: "internetarchive", Group: GroupStorage,
		Mark: "IconInternetArchive"},

	// Machines, shares and addresses.
	// THE BUCKET STORES SOMEBODY RUNS THEMSELVES, and they belong here rather
	// than with the clouds. They used to sit with them, on the argument that
	// what you have is an account with a bucket store even when the machine
	// under it is your own - and that reads the wrong half of the question.
	// What you TYPE is an endpoint: an address, a machine on a network, the
	// same thing SFTP and SMB ask for. Somebody looking for MinIO is looking
	// where their own machines are listed, not in a catalogue of services to
	// subscribe to (jdp: "ist seaweedfs und object storage nicht im falschen
	// abschnitt?").
	//
	// Garage and Ceph are here for the same reason, and because a list that
	// names two of the four self-hosted stores and leaves the others to be
	// guessed at under "S3 compatible" is a list that stops halfway. Ceph has
	// rclone's own preset; Garage has none - it is S3-compatible and reached
	// through the generic provider, which is exactly what the entry says.
	{ID: "minio", Name: "MinIO", Backend: "s3", Group: GroupProtocol,
		Preset: map[string]string{"provider": "Minio"}, Mark: "IconMinio",
		Hint: "A bucket store you run yourself. Needs its endpoint address."},
	{ID: "seaweedfs", Name: "SeaweedFS", Backend: "s3", Group: GroupProtocol,
		Preset: map[string]string{"provider": "SeaweedFS"}, Mark: "IconSeaweedfs",
		Hint: "A bucket store you run yourself. Needs its endpoint address."},
	{ID: "ceph", Name: "Ceph", Backend: "s3", Group: GroupProtocol,
		Preset: map[string]string{"provider": "Ceph"}, Mark: "IconCeph",
		Hint: "A bucket store you run yourself. Needs its endpoint address."},
	{ID: "garage", Name: "Garage", Backend: "s3", Group: GroupProtocol,
		// rclone has no Garage preset, so it is reached as a generic
		// S3 service - which is what Garage is, and what its own
		// documentation tells people to configure.
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
	{ID: "s3", Name: "S3 compatible", Backend: "s3", Group: GroupProtocol,
		Mark: "IconBuckets", Hint: "Amazon S3 and the thirty-odd services that speak its protocol."},
	{ID: "http", Name: "HTTP", Backend: "http", Group: GroupProtocol,
		Mark: "IconLink", Hint: "Read-only, over a plain web server."},
	{ID: "hdfs", Name: "HDFS", Backend: "hdfs", Group: GroupProtocol, Mark: "IconHadoop"},
	{ID: "crypt", Name: "Encrypted", Backend: "crypt", Group: GroupProtocol,
		Mark: "IconLock", Hint: "Wraps another target and encrypts what goes into it."},
}

// Providers lists what can be offered on this build, which is the ones whose
// backend is actually compiled in.
//
// Filtered rather than assumed: a provider offered for a backend the binary
// does not carry produces a target that fails the first time it runs, with an
// error about a missing section rather than about the thing that is really
// wrong.
// groupOrder is the order the three cards appear in, which is not the order
// their names happen to sort in. Clouds first because that is what most people
// are looking for, storage next because it is the same kind of answer with a
// different shape, and the protocols last because reaching them means already
// knowing an address.
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
		// The hand-written style always wins; the shape fills in the rest.
		// See derivedAuth for why that order and not the other one.
		if p.Auth == "" {
			p.Auth = derivedAuth(b)
		}
		out = append(out, p)
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
			return groupOrder(out[i].Group) < groupOrder(out[j].Group)
		}
		return strings.ToLower(out[i].Name) < strings.ToLower(out[j].Name)
	})
	return out
}

// derivedAuth works out how a backend wants to be signed into, from the shape
// of the fields it asks for.
//
// This is the answer to filling the styles in for fifty-one products, and it
// beats the obvious one. Looking each up by hand means a table that is right on
// the day it is written and quietly wrong a year later, and it means asserting
// things about services nobody here has an account with. rclone already knows
// what each backend asks for, that knowledge arrives with every build, and the
// shape of the question is usually enough to say what the answer is.
//
// It is deliberately CONSERVATIVE. Only two shapes are read, both unmistakable,
// and everything else comes back empty - which puts the field back to what it
// says today rather than guessing. A wrong sentence here is worse than none:
// "nothing has to be fetched first" in front of a service that wants a
// generated token sends somebody looking in the wrong place with confidence.
//
// The hand-written value WINS over this, and that is where the knowledge rclone
// cannot have lives. Nextcloud's fields are a user and a password, so the shape
// says an ordinary login - and with two-factor authentication switched on the
// login password cannot work at all, which no option list anywhere says.
func derivedAuth(b Backend) AuthStyle {
	// A backend reached only with an OAuth token already says so through
	// NeedsToken, and the form prints its own note above the fields. A second
	// sentence beside a box nobody can type into would be the same news twice.
	if b.NeedsToken {
		return ""
	}

	var hasKeyID, hasKeySecret, hasUser, hasPass, hasToken bool
	for _, o := range b.Options {
		// Only the fields somebody is actually shown. The long tail of advanced
		// options carries alternative credentials for cases nobody here is in -
		// swift alone offers three - and reading those would label a backend by
		// a route its own form never offers.
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
	// A public half and a secret half, created together in a console. Covers
	// S3 everywhere it is spoken, plus b2's account-and-key and netstorage's
	// account-and-secret, which are the same idea under other names.
	case hasKeyID && hasKeySecret:
		return AuthAccessKey
	// A name and a password and nothing to fetch. This is the shape that most
	// often leaves somebody hunting for a token that does not exist, so saying
	// there is none is worth a sentence.
	//
	// A token shown ALONGSIDE them disqualifies it, and that exclusion is not
	// theoretical: Linkbox, Uloz.to and Filen each ask for an email, a password
	// AND a token, so "nothing has to be fetched first" would be exactly wrong
	// on the three products where somebody most needs to be told there is
	// something to fetch. Without an answer for where to fetch it, they get
	// silence instead of a confident lie.
	case hasUser && hasPass && !hasToken:
		return AuthLogin
	}
	return ""
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
