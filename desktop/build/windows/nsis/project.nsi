Unicode true

# Wails writes the project's name, version and helper macros into
# wails_tools.nsh on every build (scripts/desktop.mjs). This file is Wails'
# own template with a page for choosing the shortcuts, installed for the
# person running it.

# Under AppData\Local\Programs, so an update replaces the program without
# asking for an administrator.
!define REQUEST_EXECUTION_LEVEL "user"
!define WAILS_INSTALL_SCOPE "user"
!define UNINST_KEY_NAME "ArrowLoop"

# Where ArrowLoop 1.1.0 and earlier, installed for all users by Wails v2's own
# script, registered their uninstaller: company and product, both "ArrowLoop".
!define MACHINE_UNINST_KEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\ArrowLoopArrowLoop"

!include "wails_tools.nsh"
!include "LogicLib.nsh"
!include "Sections.nsh"

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

!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_DIRECTORY
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

Name "${INFO_PRODUCTNAME}"
OutFile "..\..\bin\${INFO_PROJECTNAME}-${ARCH}-installer.exe"
InstallDir "$LOCALAPPDATA\Programs\${INFO_PRODUCTNAME}"
ShowInstDetails show

# The shortcuts somebody chose. An update installs over the old version, often
# silently, and must not bring back a shortcut they left out.
!define CHOICE_KEY "Software\${UNINST_KEY_NAME}"

Section "-${INFO_PRODUCTNAME}"
    !insertmacro wails.setShellContext
    !insertmacro wails.webview2runtime

    SetOutPath $INSTDIR
    !insertmacro wails.files
    !insertmacro wails.associateFiles
    !insertmacro wails.associateCustomProtocols
    !insertmacro wails.writeUninstaller
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

Function .onInit
    !insertmacro wails.checkArchitecture
    !insertmacro wails.setShellContext

    # A version installed for all users sits in Program Files. Its own
    # uninstaller asks for an administrator once, and this installation takes
    # its place. It hands itself to a copy and returns at once, so the wait is
    # for its registry entry to go. A silent run is an update from a version
    # that already lives here, and must not stop to ask for an administrator.
    ${IfNot} ${Silent}
        SetRegView 64
        ClearErrors
        ReadRegStr $1 HKLM "${MACHINE_UNINST_KEY}" "UninstallString"
        ${IfNot} ${Errors}
            StrCpy $1 $1 "" 1
            StrCpy $1 $1 -1
            ExecShellWait "runas" "$1" "/S"
            StrCpy $2 0
            ${Do}
                Sleep 500
                ClearErrors
                ReadRegStr $3 HKLM "${MACHINE_UNINST_KEY}" "UninstallString"
                ${If} ${Errors}
                    ${Break}
                ${EndIf}
                IntOp $2 $2 + 1
            ${LoopUntil} $2 >= 120
        ${EndIf}
        SetRegView default
    ${EndIf}

    # Both are ticked on a first install; later ones start from the last choice.
    ClearErrors
    ReadRegDWORD $0 SHCTX "${CHOICE_KEY}" "StartMenuShortcut"
    ${IfNot} ${Errors}
    ${AndIf} $0 == 0
        !insertmacro UnselectSection ${SecStartMenu}
    ${EndIf}
    ClearErrors
    ReadRegDWORD $0 SHCTX "${CHOICE_KEY}" "DesktopShortcut"
    ${IfNot} ${Errors}
    ${AndIf} $0 == 0
        !insertmacro UnselectSection ${SecDesktop}
    ${EndIf}
FunctionEnd

# An updater runs this with /S /relaunch after closing the program, and the
# program comes back once the new version is in place. It starts as the person
# who ran the installer, which is never an administrator here.
Function .onInstSuccess
    ${GetParameters} $0
    ClearErrors
    ${GetOptions} $0 "/relaunch" $1
    ${IfNot} ${Errors}
        Exec '"$INSTDIR\${PRODUCT_EXECUTABLE}"'
    ${EndIf}
FunctionEnd

Section "uninstall"
    !insertmacro wails.setShellContext

    RMDir /r "$AppData\${PRODUCT_EXECUTABLE}"
    RMDir /r $INSTDIR

    Delete "$SMPROGRAMS\${INFO_PRODUCTNAME}.lnk"
    Delete "$DESKTOP\${INFO_PRODUCTNAME}.lnk"
    DeleteRegKey SHCTX "${CHOICE_KEY}"

    !insertmacro wails.unassociateFiles
    !insertmacro wails.unassociateCustomProtocols
    !insertmacro wails.deleteUninstaller
SectionEnd
