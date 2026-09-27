package main

// product names the installation for all users: its entry under Apps and its
// folder under ProgramData. It is INFO_PRODUCTNAME in
// build/windows/nsis/project.nsi.
var product = "ArrowLoop"

// machineSettingsFile holds the installed copy's AutoUpdate switch in the
// folder under ProgramData, which the installer opens to every user.
const machineSettingsFile = "settings.json"
