package importer

import (
	"encoding/json"
	"fmt"
	"net/url"
	"strconv"
	"strings"

	"github.com/junkerderprovinz/arrowloop/internal/job"
)

// The field names are FolderSync's own: its configuration export (Settings,
// Advanced, Export configuration) is its RestoreFileDto written by Gson, with
// the folder pairs of the first kind inside their account and those of the
// second kind beside the accounts, pointing at them by importKey.
type fsFile struct {
	Accounts      []fsAccount `json:"accounts"`
	FolderPairsV2 []fsPairV2  `json:"folderPairsV2"`
}

type fsAccount struct {
	Name          string            `json:"name"`
	AccountType   string            `json:"accountType"`
	ImportKey     string            `json:"importKey"`
	LoginName     string            `json:"loginName"`
	AccessKey     string            `json:"accessKey"`
	Region        string            `json:"region"`
	ServerAddress string            `json:"serverAddress"`
	KeyFileURL    string            `json:"keyFileUrl"`
	KeyFilePass   string            `json:"keyFilePassword"`
	Protocol      string            `json:"protocol"`
	Port          int               `json:"port"`
	Domain        string            `json:"domain"`
	Anonymous     bool              `json:"anonymous"`
	Properties    map[string]string `json:"properties"`
	FolderPairs   []fsPair          `json:"folderPairs"`
}

type fsPair struct {
	Name                  string   `json:"name"`
	SdFolder              string   `json:"sdFolder"`
	SdFolderReadable      string   `json:"sdFolderReadable"`
	RemoteFolder          string   `json:"remoteFolder"`
	RemoteFolderReadable  string   `json:"remoteFolderReadable"`
	SyncType              string   `json:"syncType"`
	SyncInterval          string   `json:"syncInterval"`
	SyncSubFolders        *bool    `json:"syncSubFolders"`
	SyncHiddenFiles       *bool    `json:"syncHiddenFiles"`
	DeleteFilesAfterSync  bool     `json:"deleteFilesAfterSync"`
	SyncRuleConflict      string   `json:"syncRuleConflict"`
	InstantSync           bool     `json:"instantSync"`
	UseBackupScheme       bool     `json:"useBackupScheme"`
	OnlySyncWhileCharging bool     `json:"onlySyncWhileCharging"`
	TurnOnWifi            bool     `json:"turnOnWifi"`
	RescanMediaLibrary    bool     `json:"rescanMediaLibrary"`
	NotifyOnSync          bool     `json:"notifyOnSync"`
	NotifyOnError         bool     `json:"notifyOnError"`
	NotifyOnSuccess       bool     `json:"notifyOnSuccess"`
	NotifyOnChanges       bool     `json:"notifyOnChanges"`
	NotificationEmail     string   `json:"notificationEmail"`
	AllowedNetworks       string   `json:"allowedNetworks"`
	DisallowedNetworks    string   `json:"disallowedNetworks"`
	SyncRules             []fsRule `json:"syncRules"`
	Webhooks              []any    `json:"webhooks"`
}

type fsPairV2 struct {
	AccountLeftKey          string       `json:"accountLeftKey"`
	AccountRightKey         string       `json:"accountRightKey"`
	Name                    string       `json:"name"`
	LeftFolderID            string       `json:"leftFolderId"`
	LeftFolderDisplayPath   string       `json:"leftFolderDisplayPath"`
	RightFolderID           string       `json:"rightFolderId"`
	RightFolderDisplayPath  string       `json:"rightFolderDisplayPath"`
	SyncDirection           string       `json:"syncDirection"`
	SyncDeletionEnabled     bool         `json:"syncDeletionEnabled"`
	SyncConflictRule        string       `json:"syncConflictRule"`
	SyncModeMoveFiles       bool         `json:"syncModeMoveFiles"`
	SyncModeBackup          bool         `json:"syncModeBackup"`
	SyncMonitorDeviceFolder bool         `json:"syncMonitorDeviceFolder"`
	Filters                 []fsRule     `json:"filters"`
	Schedules               []fsSchedule `json:"schedules"`
	Webhooks                []any        `json:"webhooks"`
}

type fsRule struct {
	SyncRule    string `json:"syncRule"`
	StringValue string `json:"stringValue"`
	LongValue   int64  `json:"longValue"`
	IncludeRule bool   `json:"includeRule"`
}

type fsSchedule struct {
	CronString      string `json:"cronString"`
	Enabled         bool   `json:"enabled"`
	RequireCharging bool   `json:"requireCharging"`
	RequireVpn      bool   `json:"requireVpn"`
}

func isFolderSync(doc map[string]json.RawMessage) bool {
	_, accounts := doc["accounts"]
	_, pairs := doc["folderPairsV2"]
	return accounts || pairs
}

func readFolderSync(data []byte, p *Plan) error {
	var f fsFile
	if err := json.Unmarshal(data, &f); err != nil {
		return fmt.Errorf("read the FolderSync export: %w", err)
	}
	// A target is made only for an account a folder pair uses, so the list
	// holds no logins nobody needs.
	made := map[int]string{}
	place := func(i int) (string, bool) {
		if name, ok := made[i]; ok {
			return name, name != ""
		}
		name := p.fsTarget(f.Accounts[i])
		made[i] = name
		return name, name != ""
	}

	for i, a := range f.Accounts {
		for _, pair := range a.FolderPairs {
			p.fsPairV1(a, pair, func() (string, bool) { return place(i) })
		}
	}

	byKey := map[string]int{}
	for i, a := range f.Accounts {
		if a.ImportKey != "" {
			byKey[a.ImportKey] = i
		}
	}
	for _, pair := range f.FolderPairsV2 {
		p.fsPairV2(f.Accounts, byKey, pair, place)
	}
	return nil
}

func (p *Plan) fsPairV1(a fsAccount, pair fsPair, target func() (string, bool)) {
	name := jobName(pair.Name, "FolderSync")
	if !fsReachable(a.AccountType) {
		p.skip(name, "accountType: %s", a.AccountType)
		return
	}
	var direction string
	switch pair.SyncType {
	case "ToRemoteFolder":
		direction = "leftToRight"
	case "ToSdCard":
		direction = "rightToLeft"
	case "TwoWay":
		direction = "both"
	default:
		p.skip(name, "syncType: %s", pair.SyncType)
		return
	}
	remote, ok := target()
	if !ok {
		p.skip(name, "serverAddress: %s", a.ServerAddress)
		return
	}
	far := fsRemoteSide(a, remote, readable(pair.RemoteFolder, pair.RemoteFolderReadable))
	if far == "" {
		p.skip(name, "remoteFolder: %s", pair.RemoteFolder)
		return
	}
	mode := "sync"
	if pair.DeleteFilesAfterSync {
		if direction == "both" {
			p.skip(name, "deleteFilesAfterSync")
		} else {
			mode = "move"
		}
	}
	j := newJob(name, cleanLocal(readable(pair.SdFolder, pair.SdFolderReadable)), far, direction, mode)

	if every, ok := fsIntervals[pair.SyncInterval]; ok {
		j["schedule"] = every
	} else if pair.SyncInterval != "" {
		p.skip(name, "syncInterval: %s", pair.SyncInterval)
	}
	if pair.InstantSync {
		watch(j)
	}
	switch pair.SyncRuleConflict {
	case "OverwriteOldest":
		j["newerWins"] = true
	case "", "Rename", "PromptUser", "Skip":
	default:
		p.skip(name, "syncRuleConflict: %s", pair.SyncRuleConflict)
	}
	p.fsFilters(j, name, pair.SyncRules, "syncRules")

	if pair.SyncSubFolders != nil && !*pair.SyncSubFolders {
		p.skip(name, "syncSubFolders: false")
	}
	if pair.SyncHiddenFiles != nil && !*pair.SyncHiddenFiles {
		p.skip(name, "syncHiddenFiles: false")
	}
	if len(pair.Webhooks) > 0 {
		p.skip(name, "webhooks")
	}
	for _, flag := range []struct {
		on   bool
		name string
	}{
		{pair.UseBackupScheme, "useBackupScheme"},
		{pair.OnlySyncWhileCharging, "onlySyncWhileCharging"},
		{pair.TurnOnWifi, "turnOnWifi"},
		{pair.RescanMediaLibrary, "rescanMediaLibrary"},
		{pair.NotifyOnSync, "notifyOnSync"},
		{pair.NotifyOnError, "notifyOnError"},
		{pair.NotifyOnSuccess, "notifyOnSuccess"},
		{pair.NotifyOnChanges, "notifyOnChanges"},
		{pair.NotificationEmail != "", "notificationEmail"},
		{pair.AllowedNetworks != "", "allowedNetworks"},
		{pair.DisallowedNetworks != "", "disallowedNetworks"},
	} {
		if flag.on {
			p.skip(name, "%s", flag.name)
		}
	}
	p.Jobs = append(p.Jobs, j)
}

func (p *Plan) fsPairV2(accounts []fsAccount, byKey map[string]int, pair fsPairV2, place func(int) (string, bool)) {
	name := jobName(pair.Name, "FolderSync")
	side := func(which, key, id, display string) (string, bool) {
		i, ok := byKey[key]
		if !ok {
			p.skip(name, "account%sKey: %s", which, key)
			return "", false
		}
		a := accounts[i]
		folder := readable(id, display)
		if a.AccountType == "LocalStorage" {
			return cleanLocal(folder), true
		}
		if !fsReachable(a.AccountType) {
			p.skip(name, "accountType: %s", a.AccountType)
			return "", false
		}
		remote, ok := place(i)
		if !ok {
			p.skip(name, "serverAddress: %s", a.ServerAddress)
			return "", false
		}
		s := fsRemoteSide(a, remote, folder)
		if s == "" {
			p.skip(name, "%sFolderId: %s", strings.ToLower(which), id)
		}
		return s, s != ""
	}
	left, ok := side("Left", pair.AccountLeftKey, pair.LeftFolderID, pair.LeftFolderDisplayPath)
	if !ok {
		return
	}
	right, ok := side("Right", pair.AccountRightKey, pair.RightFolderID, pair.RightFolderDisplayPath)
	if !ok {
		return
	}

	var direction string
	switch pair.SyncDirection {
	case "ToRightFolder":
		direction = "leftToRight"
	case "ToLeftFolder":
		direction = "rightToLeft"
	case "TwoWay":
		direction = "both"
	default:
		p.skip(name, "syncDirection: %s", pair.SyncDirection)
		return
	}
	mode := "sync"
	switch {
	case pair.SyncModeMoveFiles && direction != "both":
		mode = "move"
	case pair.SyncModeMoveFiles:
		p.skip(name, "syncModeMoveFiles")
	case pair.SyncDeletionEnabled && direction != "both":
		mode = "mirror"
	case !pair.SyncDeletionEnabled && direction == "both":
		// A two-way job here always carries a deletion across, to the trash.
		p.skip(name, "syncDeletionEnabled: false")
	}
	j := newJob(name, left, right, direction, mode)

	scheduled := false
	for _, s := range pair.Schedules {
		if !s.Enabled {
			continue
		}
		if _, err := job.ParseSchedule(s.CronString); err != nil || scheduled {
			p.skip(name, "cronString: %s", s.CronString)
		} else {
			j["schedule"] = s.CronString
			scheduled = true
		}
		if s.RequireCharging {
			p.skip(name, "requireCharging")
		}
		if s.RequireVpn {
			p.skip(name, "requireVpn")
		}
	}
	if pair.SyncMonitorDeviceFolder {
		watch(j)
	}
	switch pair.SyncConflictRule {
	case "OverwriteOldest":
		j["newerWins"] = true
	case "", "Rename":
	default:
		p.skip(name, "syncConflictRule: %s", pair.SyncConflictRule)
	}
	if pair.SyncModeBackup {
		p.skip(name, "syncModeBackup")
	}
	p.fsFilters(j, name, pair.Filters, "filters")
	if len(pair.Webhooks) > 0 {
		p.skip(name, "webhooks")
	}
	p.Jobs = append(p.Jobs, j)
}

// watch switches watching on. Watching here needs a schedule behind it, which
// catches what a watcher missed, and FolderSync's instant sync has none, so an
// hourly one stands in.
func watch(j map[string]any) {
	j["watch"] = true
	if _, ok := j["schedule"]; !ok {
		j["schedule"] = "@hourly"
	}
}

var fsIntervals = map[string]string{
	"Every5Minutes":  "@every 5m",
	"Every15Minutes": "@every 15m",
	"Every30Minutes": "@every 30m",
	"EveryHour":      "@hourly",
	"Every2Hours":    "@every 2h",
	"Every3Hours":    "@every 3h",
	"Every4Hours":    "@every 4h",
	"Every5Hours":    "@every 5h",
	"Every6Hours":    "@every 6h",
	"Every8Hours":    "@every 8h",
	"Every12Hours":   "@every 12h",
	"Daily":          "@daily",
	"Weekly":         "@weekly",
	"Monthly":        "@monthly",
}

// fsFilters carries the exclusions that have a glob of their own. Size, age
// and regular expressions have none, and an include rule turns the filter
// around, so those are listed.
func (p *Plan) fsFilters(j map[string]any, name string, rules []fsRule, field string) {
	for _, r := range rules {
		v := r.StringValue
		var pattern string
		if !r.IncludeRule && v != "" {
			switch r.SyncRule {
			case "FileType":
				pattern = "*." + strings.TrimLeft(v, "*.")
			case "FileNameEquals":
				pattern = v
			case "FileNameStartsWith":
				pattern = v + "*"
			case "FileNameEndsWith":
				pattern = "*" + v
			case "FileNameContains":
				pattern = "*" + v + "*"
			case "FolderNameEquals":
				pattern = v + "/**"
			case "FolderNameStartsWith":
				pattern = v + "*/**"
			case "FolderNameEndsWith":
				pattern = "*" + v + "/**"
			case "FolderNameContains":
				pattern = "*" + v + "*/**"
			}
		}
		if pattern != "" && !strings.Contains(v, "/") && addExclude(j, pattern) {
			continue
		}
		what := strings.TrimSpace(fmt.Sprintf("%s: %s %s", field, r.SyncRule, firstOf(v, strconv.FormatInt(r.LongValue, 10))))
		if r.IncludeRule {
			what += " (include)"
		}
		p.skip(name, "%s", what)
	}
}

func firstOf(a, b string) string {
	if a != "" {
		return a
	}
	return b
}

// readable picks the path among a folder's two spellings. The other one is a
// content:// address on a newer Android, and an id at Dropbox or Google Drive.
func readable(id, display string) string {
	if strings.HasPrefix(display, "/") {
		return display
	}
	if strings.HasPrefix(id, "/") || display == "" {
		return id
	}
	return display
}

var fsBackends = map[string]string{
	"SFTP": "sftp", "FTP": "ftp",
	"SMB": "smb", "SMB2": "smb", "SMB3": "smb",
	"WebDAV": "webdav", "OwnCloud": "webdav", "OwnCloud9": "webdav", "Nextcloud": "webdav", "LuckycloudWebDav": "webdav",
	"AmazonS3": "s3", "S3Compatible": "s3", "MinIO": "s3", "LuckycloudS3": "s3",
	"Dropbox": "dropbox", "GoogleDrive": "drive", "GoogleDriveV3": "drive",
	"OneDrive": "onedrive", "SkyDrive": "onedrive", "OneDriveBusiness": "onedrive",
	"PCloud": "pcloud", "BoxNET": "box", "YandexDisk": "yandex", "YandexDiskRestApi": "yandex",
	"HiDrive": "hidrive", "HiDriveRestApi": "hidrive", "GoogleCloudStorage": "gcs",
	"Koofr": "koofr", "KoofrRestApi": "koofr", "Mega": "mega", "MegaKmp": "mega", "ProtonDrive": "protondrive",
}

func fsReachable(accountType string) bool {
	_, ok := fsBackends[accountType]
	return ok || accountType == "LocalStorage"
}

// fsS3Regions follows FolderSync's own table, in which UsStandard is Oregon.
var fsS3Regions = map[string]string{
	"UsStandard": "us-west-2", "UsGov": "us-gov-west-1", "UsGovEast": "us-gov-east-1", "UsEast": "us-east-2",
	"UsVirginia": "us-east-1", "UsWest": "us-west-1", "UsWestOregon": "us-west-2",
	"AfricaCapeTown": "af-south-1", "AsiaPacificHongKong": "ap-east-1", "AsiaPacificHyderabad": "ap-south-2",
	"AsiaPacificMumbai": "ap-south-1", "AsiaPacificSeoul": "ap-northeast-2", "AsiaPacificSingapore": "ap-southeast-1",
	"AsiaPacificMelbourne": "ap-southeast-4", "AsiaPacificSydney": "ap-southeast-2", "AsiaPacificJapan": "ap-northeast-1",
	"AsiaPacificJakarta": "ap-southeast-3", "CanadaCentral": "ca-central-1", "ChinaBeijing": "cn-north-1",
	"ChinaNingxia": "cn-northwest-1", "EUFrankfurt": "eu-central-1", "EU": "eu-west-1", "EULondon": "eu-west-2",
	"EUMilan": "eu-south-1", "EUParis": "eu-west-3", "EUStockholm": "eu-north-1", "EUSpain": "eu-south-2",
	"EUZurich": "eu-central-2", "IsraelTelAviv": "il-central-1", "MiddleEastBahrain": "me-south-1",
	"MiddleEastUAE": "me-central-1", "SouthAmericaSaoPaulo": "sa-east-1",
}

// fsTarget adds the target an account becomes and returns its name, or ""
// when the account names no server to reach.
func (p *Plan) fsTarget(a fsAccount) string {
	backend := fsBackends[a.AccountType]
	s := map[string]string{}
	set := func(key, value string) {
		if value != "" {
			s[key] = value
		}
	}
	port := func(standard int) {
		if a.Port > 0 && a.Port != standard {
			s["port"] = strconv.Itoa(a.Port)
		}
	}
	host, _ := splitServer(a.ServerAddress)
	needs := Password

	switch backend {
	case "sftp":
		if host == "" {
			return ""
		}
		set("host", host)
		port(22)
		set("user", a.LoginName)
		if key := a.KeyFileURL; key != "" && !strings.Contains(key, "://") {
			s["key_file"] = key
			if a.KeyFilePass == "" {
				needs = ""
			}
		}
	case "ftp":
		if host == "" {
			return ""
		}
		set("host", host)
		port(21)
		scheme := strings.ToLower(firstOf(schemeOf(a.ServerAddress), a.Protocol))
		switch {
		case strings.Contains(scheme, "ftpes") || strings.Contains(scheme, "explicit"):
			s["explicit_tls"] = "true"
		case strings.Contains(scheme, "ftps") || strings.Contains(scheme, "implicit"):
			s["tls"] = "true"
		}
		if a.Anonymous {
			s["user"] = "anonymous"
			needs = ""
		} else {
			set("user", a.LoginName)
		}
	case "smb":
		if host == "" {
			return ""
		}
		set("host", host)
		port(445)
		set("domain", a.Domain)
		if a.Anonymous {
			needs = ""
		} else {
			set("user", a.LoginName)
		}
	case "webdav":
		addr := a.ServerAddress
		if addr == "" && a.AccountType == "LuckycloudWebDav" {
			addr = "https://webdav.luckycloud.de"
		}
		if addr == "" {
			return ""
		}
		if schemeOf(addr) == "" {
			addr = firstOf(a.Protocol, "https") + "://" + addr
			if a.Port > 0 {
				if u, err := url.Parse(addr); err == nil && u.Port() == "" {
					u.Host += ":" + strconv.Itoa(a.Port)
					addr = u.String()
				}
			}
		}
		s["url"] = addr
		switch a.AccountType {
		case "Nextcloud":
			s["vendor"] = "nextcloud"
		case "OwnCloud", "OwnCloud9":
			s["vendor"] = "owncloud"
		default:
			s["vendor"] = "other"
		}
		set("user", a.LoginName)
	case "s3":
		switch a.AccountType {
		case "AmazonS3":
			s["provider"] = "AWS"
			set("region", fsS3Regions[a.Region])
		case "MinIO":
			s["provider"] = "Minio"
		default:
			s["provider"] = "Other"
		}
		if a.AccountType != "AmazonS3" {
			endpoint := a.ServerAddress
			if endpoint == "" && a.AccountType == "LuckycloudS3" {
				endpoint = "https://s3-berlin1.luckycloud.de"
			}
			if endpoint == "" {
				return ""
			}
			s["endpoint"] = endpoint
		}
		if a.Properties["pathStyleAccess"] == "true" {
			s["force_path_style"] = "true"
		}
		set("access_key_id", firstOf(a.AccessKey, a.LoginName))
		needs = SecretKey
	case "mega", "koofr":
		set("user", a.LoginName)
	case "protondrive":
		set("username", a.LoginName)
	default:
		needs = SignIn
	}

	name := p.addTarget(Target{Name: targetName(a.Name, backend), Type: backend, Settings: s})
	if needs != "" {
		p.fillIn(name, needs)
	}
	return name
}

// fsRemoteSide writes a folder on an account's target as a job side, or ""
// for one that names no folder ArrowLoop can use.
func fsRemoteSide(a fsAccount, target, folder string) string {
	switch fsBackends[a.AccountType] {
	case "sftp", "ftp":
		return onTarget(target, folder, true)
	case "smb":
		// FolderSync keeps the share in the address, rclone in the path.
		_, share := splitServer(a.ServerAddress)
		side := onTarget(target, share+"/"+folder, false)
		if side == target+":" {
			return ""
		}
		return side
	}
	return onTarget(target, folder, false)
}

// splitServer parses "smb://fileserver/team" into "fileserver" and "team".
func splitServer(addr string) (host, rest string) {
	if i := strings.Index(addr, "://"); i >= 0 {
		addr = addr[i+3:]
	}
	host, rest, _ = strings.Cut(addr, "/")
	if h, _, ok := strings.Cut(host, ":"); ok {
		host = h
	}
	return host, rest
}

func schemeOf(addr string) string {
	scheme, _, ok := strings.Cut(addr, "://")
	if !ok {
		return ""
	}
	return scheme
}

// addTarget adds a target under a name no other target in the plan has and
// returns that name.
func (p *Plan) addTarget(t Target) string {
	t.Name = free(t.Name, "-", func(n string) bool {
		for _, other := range p.Targets {
			if other.Name == n {
				return true
			}
		}
		return false
	})
	p.Targets = append(p.Targets, t)
	return t.Name
}
