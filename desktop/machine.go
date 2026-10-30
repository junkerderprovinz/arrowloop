package main

import "github.com/junkerderprovinz/arrowloop/internal/deskset"

// product names the installation for all users: its entry under Apps and its
// folder under ProgramData, and the user's own folder for the configuration.
// installID names the folder the Linux installer puts the program in and the
// single-instance lock. Both are main.name and main.id in desktop/installer.
// ownData keeps the window's storage and rclone's configuration in the
// configuration folder too, instead of the places a real installation uses.
var (
	product   = "ArrowLoop"
	installID = "com.junkerderprovinz.arrowloop"
	ownData   = false
)

// installerLanguage is the language the installer's welcome page chose, which
// the interface starts in until somebody picks one inside it, or "".
func installerLanguage() string {
	path, err := installerChoices()
	if err != nil {
		return ""
	}
	return deskset.ReadLanguage(path)
}

// machineSettingsFile holds the installed copy's AutoUpdate switch and the
// installer's language in the folder under ProgramData, which the installer
// opens to every user.
const machineSettingsFile = "settings.json"
