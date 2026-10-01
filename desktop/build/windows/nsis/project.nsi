Unicode true

# Wails writes the project's name, version and helper macros into
# wails_tools.nsh on every build (scripts/desktop.mjs). This file is Wails'
# own template with a page for choosing the shortcuts, installed for all users.

# Under Program Files, like any other program. Nobody but an administrator may
# write there, so a scheduled task running as the system account keeps it
# current; see docs/installing.md.
!define REQUEST_EXECUTION_LEVEL "admin"
!define WAILS_INSTALL_SCOPE "machine"
!define UNINST_KEY_NAME "${INFO_PRODUCTNAME}"

# ArrowLoop 1.1.0 and earlier were installed for all users by Wails v2's own
# script, which named the entry after company and product, both "ArrowLoop".
!define LEGACY_MACHINE_KEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\${INFO_PRODUCTNAME}${INFO_PRODUCTNAME}"
# ArrowLoop 1.2.0 was installed for one user, under AppData\Local\Programs.
!define LEGACY_USER_KEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\${INFO_PRODUCTNAME}"

# The entry internal/autostart writes to start ArrowLoop on sign-in.
!define AUTOSTART_KEY "Software\Microsoft\Windows\CurrentVersion\Run"
!define AUTOSTART_NAME "ArrowLoop"

!define TASK_NAME "${INFO_PRODUCTNAME} Update"

# Under the all-users context wails.setShellContext sets, $APPDATA is
# ProgramData. The folder holds the update switch and the task's log.
!define DATA_DIR "$APPDATA\${INFO_PRODUCTNAME}"

!include "wails_tools.nsh"
!include "LogicLib.nsh"
!include "Sections.nsh"
!include "StrFunc.nsh"

${StrStr}

VIProductVersion "${INFO_PRODUCTVERSION}.0"
VIFileVersion    "${INFO_PRODUCTVERSION}.0"

VIAddVersionKey "CompanyName"     "${INFO_COMPANYNAME}"
VIAddVersionKey "FileDescription" "${INFO_PRODUCTNAME} Installer"
VIAddVersionKey "ProductVersion"  "${INFO_PRODUCTVERSION}"
VIAddVersionKey "FileVersion"     "${INFO_PRODUCTVERSION}"
VIAddVersionKey "LegalCopyright"  "${INFO_COPYRIGHT}"
VIAddVersionKey "ProductName"     "${INFO_PRODUCTNAME}"

ManifestDPIAware true

!include "MUI.nsh"

!define MUI_ICON "..\icon.ico"
!define MUI_UNICON "..\icon.ico"
!define MUI_FINISHPAGE_NOAUTOCLOSE
!define MUI_ABORTWARNING
!define MUI_COMPONENTSPAGE_NODESC

# No directory page: the task runs the program as the system account, and a
# folder a user could write to would let that user run anything that way.
!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_COMPONENTS
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_UNPAGE_INSTFILES

# The first language is the one used where the system's is neither.
!insertmacro MUI_LANGUAGE "English"
!insertmacro MUI_LANGUAGE "German"

LangString StartMenuShortcut ${LANG_ENGLISH} "Start menu entry"
LangString StartMenuShortcut ${LANG_GERMAN}  "Eintrag im Startmenü"
LangString DesktopShortcut   ${LANG_ENGLISH} "Shortcut on the desktop"
LangString DesktopShortcut   ${LANG_GERMAN}  "Verknüpfung auf dem Desktop"
LangString TaskFailed        ${LANG_ENGLISH} "Could not set up the background updates. ${INFO_PRODUCTNAME} works, but stays at this version."
LangString TaskFailed        ${LANG_GERMAN}  "Die Updates im Hintergrund ließen sich nicht einrichten. ${INFO_PRODUCTNAME} läuft, bleibt aber auf dieser Version."

Name "${INFO_PRODUCTNAME}"
OutFile "..\..\bin\${INFO_PROJECTNAME}-${ARCH}-installer.exe"
# The 64-bit Program Files, which is also where Windows on ARM keeps its own
# programs.
InstallDir "$PROGRAMFILES64\${INFO_PRODUCTNAME}"
ShowInstDetails show

# The shortcuts somebody chose. An update installs over the old version, often
# silently, and must not bring back a shortcut they left out.
!define CHOICE_KEY "Software\${UNINST_KEY_NAME}"

Section "-${INFO_PRODUCTNAME}"
    !insertmacro wails.setShellContext
    !insertmacro wails.webview2runtime

    SetOutPath $INSTDIR
    # A running copy cannot be overwritten but can be renamed. It steps aside
    # as .old, as it does for an update, and the next update removes it.
    Delete "$INSTDIR\${PRODUCT_EXECUTABLE}.old"
    Rename "$INSTDIR\${PRODUCT_EXECUTABLE}" "$INSTDIR\${PRODUCT_EXECUTABLE}.old"
    !insertmacro wails.files
    !insertmacro wails.associateFiles
    !insertmacro wails.associateCustomProtocols
    !insertmacro wails.writeUninstaller
    # The program compares its own folder with this to tell the installed copy
    # from a portable one.
    WriteRegStr HKLM "${UNINST_KEY}" "InstallLocation" "$INSTDIR"

    Call RemoveUserInstall
    Call PrepareData
    Pop $0
    ${If} $0 == "ok"
        Call CreateTask
    ${Else}
        # A task from an earlier install would use the folder all the same.
        nsExec::ExecToLog 'schtasks /Delete /TN "${TASK_NAME}" /F'
        Pop $0
        DetailPrint "$(TaskFailed)"
    ${EndIf}
SectionEnd

Section "$(StartMenuShortcut)" SecStartMenu
    CreateShortcut "$SMPROGRAMS\${INFO_PRODUCTNAME}.lnk" "$INSTDIR\${PRODUCT_EXECUTABLE}"
SectionEnd

Section "$(DesktopShortcut)" SecDesktop
    CreateShortCut "$DESKTOP\${INFO_PRODUCTNAME}.lnk" "$INSTDIR\${PRODUCT_EXECUTABLE}"
SectionEnd

# Last, so it sees the final choice: a shortcut left out on a reinstall is
# removed rather than kept from the version before.
Section "-remember the shortcuts"
    ${If} ${SectionIsSelected} ${SecStartMenu}
        WriteRegDWORD SHCTX "${CHOICE_KEY}" "StartMenuShortcut" 1
    ${Else}
        WriteRegDWORD SHCTX "${CHOICE_KEY}" "StartMenuShortcut" 0
        Delete "$SMPROGRAMS\${INFO_PRODUCTNAME}.lnk"
    ${EndIf}
    ${If} ${SectionIsSelected} ${SecDesktop}
        WriteRegDWORD SHCTX "${CHOICE_KEY}" "DesktopShortcut" 1
    ${Else}
        WriteRegDWORD SHCTX "${CHOICE_KEY}" "DesktopShortcut" 0
        Delete "$DESKTOP\${INFO_PRODUCTNAME}.lnk"
    ${EndIf}
SectionEnd

# The copy 1.2.0 installed for the person running this goes, together with its
# shortcuts and its entry under Apps. Their settings stay where they are, and
# an autostart entry that named the old copy names this one.
Function RemoveUserInstall
    ClearErrors
    ReadRegStr $0 HKCU "${LEGACY_USER_KEY}" "DisplayIcon"
    ${If} ${Errors}
        Return
    ${EndIf}
    ${GetParent} $0 $1

    ReadRegStr $2 HKCU "${AUTOSTART_KEY}" "${AUTOSTART_NAME}"
    ${If} $2 == '"$0"'
        WriteRegStr HKCU "${AUTOSTART_KEY}" "${AUTOSTART_NAME}" '"$INSTDIR\${PRODUCT_EXECUTABLE}"'
    ${EndIf}

    # A copy that is still running goes at the next restart.
    Delete /REBOOTOK "$0"
    Delete /REBOOTOK "$0.old"
    Delete "$1\uninstall.exe"
    Delete "$1\.*.update-*"
    RMDir /REBOOTOK "$1"

    SetShellVarContext current
    Delete "$SMPROGRAMS\${INFO_PRODUCTNAME}.lnk"
    Delete "$DESKTOP\${INFO_PRODUCTNAME}.lnk"
    SetShellVarContext all

    DeleteRegKey HKCU "${LEGACY_USER_KEY}"
    DeleteRegKey HKCU "${CHOICE_KEY}"
FunctionEnd

# The folder under ProgramData belongs to the administrators, and only
# settings.json is open to every user, so the settings page can change the
# switch. Anything else a user could write there, the task running as the
# system account could be tricked into writing somewhere else. What an earlier
# folder held is cleared, keeping only the switch. Pushes "ok" when the folder
# is safe for the task.
Function PrepareData
    StrCpy $3 "true"
    ClearErrors
    FileOpen $0 "${DATA_DIR}\settings.json" r
    ${IfNot} ${Errors}
        FileRead $0 $1
        FileClose $0
        ${StrStr} $2 $1 "false"
        ${If} $2 != ""
            StrCpy $3 "false"
        ${EndIf}
    ${EndIf}

    # A junction in place of the folder would lead everything below elsewhere.
    System::Call 'kernel32::GetFileAttributesW(w "${DATA_DIR}") i .r0'
    ${If} $0 <> -1
        IntOp $0 $0 & 0x400
        ${If} $0 <> 0
            RMDir "${DATA_DIR}"
        ${EndIf}
    ${EndIf}

    # A user may have made the folder before the first install and given
    # themselves rights on it, or turned a new one into a junction before its
    # rights are set. Whatever is at the path, a junction itself and not where
    # it leads, goes to the administrators with its whole access list replaced.
    # No user can change it after that, so it is cleared only then.
    CreateDirectory "${DATA_DIR}"
    nsExec::ExecToLog 'icacls "${DATA_DIR}" /setowner *S-1-5-32-544 /L'
    Pop $0
    nsExec::ExecToLog 'icacls "${DATA_DIR}" /reset /L'
    Pop $1
    nsExec::ExecToLog 'icacls "${DATA_DIR}" /inheritance:r /grant:r *S-1-5-18:(OI)(CI)F *S-1-5-32-544:(OI)(CI)F *S-1-5-32-545:(OI)(CI)RX /L'
    Pop $2
    # 0x10 marks a folder, 0x400 a reparse point.
    System::Call 'kernel32::GetFileAttributesW(w "${DATA_DIR}") i .r4'
    IntOp $4 $4 & 0x410
    ${If} $0 != 0
    ${OrIf} $1 != 0
    ${OrIf} $2 != 0
    ${OrIf} $4 <> 0x10
        Push "unsafe"
        Return
    ${EndIf}

    # A subfolder goes only when it is empty or a junction, which RMDir unlinks
    # instead of following. A full one a user left there stays, which is
    # harmless unless it holds the name of the task's log: the user could
    # empty it later and turn it into a junction.
    Delete "${DATA_DIR}\*.*"
    FindFirst $0 $1 "${DATA_DIR}\*"
    ${DoWhile} $1 != ""
        ${If} $1 != "."
        ${AndIf} $1 != ".."
            RMDir "${DATA_DIR}\$1"
        ${EndIf}
        FindNext $0 $1
    ${Loop}
    FindClose $0
    ${If} ${FileExists} "${DATA_DIR}\update.log\*.*"
        Push "unsafe"
        Return
    ${EndIf}

    FileOpen $0 "${DATA_DIR}\settings.json" w
    FileWrite $0 '{"autoUpdate":$3}$\r$\n'
    FileClose $0
    nsExec::ExecToLog 'icacls "${DATA_DIR}\settings.json" /grant *S-1-5-32-545:(R,W)'
    Pop $0
    Push "ok"
FunctionEnd

# Once a day and five minutes after the computer starts, as the system
# account, the way browsers keep themselves current. schtasks reads the
# definition as UTF-16.
Function CreateTask
    InitPluginsDir
    FileOpen $0 "$PLUGINSDIR\task.xml" w
    FileWriteWord $0 0xFEFF
    FileWriteUTF16LE $0 `<?xml version="1.0" encoding="UTF-16"?>$\r$\n`
    FileWriteUTF16LE $0 `<Task version="1.2" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">$\r$\n`
    FileWriteUTF16LE $0 `  <RegistrationInfo>$\r$\n`
    FileWriteUTF16LE $0 `    <Author>${INFO_COMPANYNAME}</Author>$\r$\n`
    FileWriteUTF16LE $0 `    <Description>Installs new versions of ${INFO_PRODUCTNAME} from its releases on GitHub. Uninstalling ${INFO_PRODUCTNAME} removes this task.</Description>$\r$\n`
    FileWriteUTF16LE $0 `  </RegistrationInfo>$\r$\n`
    FileWriteUTF16LE $0 `  <Triggers>$\r$\n`
    FileWriteUTF16LE $0 `    <BootTrigger>$\r$\n`
    FileWriteUTF16LE $0 `      <Delay>PT5M</Delay>$\r$\n`
    FileWriteUTF16LE $0 `    </BootTrigger>$\r$\n`
    FileWriteUTF16LE $0 `    <CalendarTrigger>$\r$\n`
    FileWriteUTF16LE $0 `      <StartBoundary>2000-01-01T12:00:00</StartBoundary>$\r$\n`
    FileWriteUTF16LE $0 `      <RandomDelay>PT1H</RandomDelay>$\r$\n`
    FileWriteUTF16LE $0 `      <ScheduleByDay>$\r$\n`
    FileWriteUTF16LE $0 `        <DaysInterval>1</DaysInterval>$\r$\n`
    FileWriteUTF16LE $0 `      </ScheduleByDay>$\r$\n`
    FileWriteUTF16LE $0 `    </CalendarTrigger>$\r$\n`
    FileWriteUTF16LE $0 `  </Triggers>$\r$\n`
    FileWriteUTF16LE $0 `  <Principals>$\r$\n`
    FileWriteUTF16LE $0 `    <Principal id="System">$\r$\n`
    FileWriteUTF16LE $0 `      <UserId>S-1-5-18</UserId>$\r$\n`
    FileWriteUTF16LE $0 `      <RunLevel>HighestAvailable</RunLevel>$\r$\n`
    FileWriteUTF16LE $0 `    </Principal>$\r$\n`
    FileWriteUTF16LE $0 `  </Principals>$\r$\n`
    FileWriteUTF16LE $0 `  <Settings>$\r$\n`
    FileWriteUTF16LE $0 `    <MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>$\r$\n`
    FileWriteUTF16LE $0 `    <DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>$\r$\n`
    FileWriteUTF16LE $0 `    <StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>$\r$\n`
    FileWriteUTF16LE $0 `    <StartWhenAvailable>true</StartWhenAvailable>$\r$\n`
    FileWriteUTF16LE $0 `    <ExecutionTimeLimit>PT1H</ExecutionTimeLimit>$\r$\n`
    FileWriteUTF16LE $0 `  </Settings>$\r$\n`
    FileWriteUTF16LE $0 `  <Actions Context="System">$\r$\n`
    FileWriteUTF16LE $0 `    <Exec>$\r$\n`
    FileWriteUTF16LE $0 `      <Command>"$INSTDIR\${PRODUCT_EXECUTABLE}"</Command>$\r$\n`
    FileWriteUTF16LE $0 `      <Arguments>--update</Arguments>$\r$\n`
    FileWriteUTF16LE $0 `    </Exec>$\r$\n`
    FileWriteUTF16LE $0 `  </Actions>$\r$\n`
    FileWriteUTF16LE $0 `</Task>$\r$\n`
    FileClose $0

    nsExec::ExecToLog 'schtasks /Create /TN "${TASK_NAME}" /XML "$PLUGINSDIR\task.xml" /F'
    Pop $0
    ${If} $0 != 0
        DetailPrint "$(TaskFailed)"
    ${EndIf}
FunctionEnd

Function .onInit
    !insertmacro wails.checkArchitecture
    !insertmacro wails.setShellContext
    SetRegView 64

    # An installation from 1.1.0 or earlier takes the same folder. Its
    # uninstaller hands itself to a copy and returns at once, so the wait is
    # for its registry entry to go.
    ClearErrors
    ReadRegStr $1 HKLM "${LEGACY_MACHINE_KEY}" "UninstallString"
    ${IfNot} ${Errors}
        ExecWait '$1 /S'
        StrCpy $2 0
        ${Do}
            Sleep 500
            ClearErrors
            ReadRegStr $3 HKLM "${LEGACY_MACHINE_KEY}" "UninstallString"
            ${If} ${Errors}
                ${Break}
            ${EndIf}
            IntOp $2 $2 + 1
        ${LoopUntil} $2 >= 120
    ${EndIf}

    # Both are ticked on a first install; later ones start from the last
    # choice, which 1.2.0 kept for one user.
    ClearErrors
    ReadRegDWORD $0 SHCTX "${CHOICE_KEY}" "StartMenuShortcut"
    ${If} ${Errors}
        ClearErrors
        ReadRegDWORD $0 HKCU "${CHOICE_KEY}" "StartMenuShortcut"
    ${EndIf}
    ${IfNot} ${Errors}
    ${AndIf} $0 == 0
        !insertmacro UnselectSection ${SecStartMenu}
    ${EndIf}
    ClearErrors
    ReadRegDWORD $0 SHCTX "${CHOICE_KEY}" "DesktopShortcut"
    ${If} ${Errors}
        ClearErrors
        ReadRegDWORD $0 HKCU "${CHOICE_KEY}" "DesktopShortcut"
    ${EndIf}
    ${IfNot} ${Errors}
    ${AndIf} $0 == 0
        !insertmacro UnselectSection ${SecDesktop}
    ${EndIf}
FunctionEnd

# An updater runs this with /S /relaunch after closing the program, and the
# program comes back once the new version is in place. The installer runs as
# an administrator; Explorer starts the program as the person signed in.
Function .onInstSuccess
    ${GetParameters} $0
    ClearErrors
    ${GetOptions} $0 "/relaunch" $1
    ${IfNot} ${Errors}
        Exec '"$WINDIR\explorer.exe" "$INSTDIR\${PRODUCT_EXECUTABLE}"'
    ${EndIf}
FunctionEnd

Section "uninstall"
    !insertmacro wails.setShellContext
    SetRegView 64

    nsExec::ExecToLog 'schtasks /Delete /TN "${TASK_NAME}" /F'
    Pop $0
    # Only what the program writes there. RMDir /r would follow a junction
    # inside the folder and delete, as an administrator, wherever it leads.
    Delete "${DATA_DIR}\settings.json"
    Delete "${DATA_DIR}\update.log"
    Delete "${DATA_DIR}\updatetest-api"
    RMDir "${DATA_DIR}"

    # The webview's cache of the person uninstalling. Their settings stay.
    SetShellVarContext current
    RMDir /r "$APPDATA\${PRODUCT_EXECUTABLE}"
    SetShellVarContext all

    # Only what the installer and the updates put there, since the folder
    # could have been chosen with /D. A copy that is still running goes at the
    # next restart.
    Delete /REBOOTOK "$INSTDIR\${PRODUCT_EXECUTABLE}"
    Delete /REBOOTOK "$INSTDIR\${PRODUCT_EXECUTABLE}.old"
    Delete "$INSTDIR\.${PRODUCT_EXECUTABLE}.update-*"

    Delete "$SMPROGRAMS\${INFO_PRODUCTNAME}.lnk"
    Delete "$DESKTOP\${INFO_PRODUCTNAME}.lnk"
    DeleteRegKey SHCTX "${CHOICE_KEY}"

    !insertmacro wails.unassociateFiles
    !insertmacro wails.unassociateCustomProtocols
    !insertmacro wails.deleteUninstaller
    RMDir /REBOOTOK $INSTDIR
SectionEnd
