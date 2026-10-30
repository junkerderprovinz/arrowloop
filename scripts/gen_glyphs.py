"""Generate ArrowLoop's glyphs from GlimStone's glyph assortment.

Run from anywhere:  python scripts/gen_glyphs.py

scripts/glyphs.json is GlimStone's reference/glyphs.json, copied unchanged.
Each entry is one meaning: its drawing, where the drawing comes from, the
measured ink box and a square viewBox cropped to that ink, so glyphs from
different sets and grids fill their box alike. Refresh the copy from GlimStone
instead of editing it here, or the apps that share the set drift apart.

A meaning the assortment has no entry for gets its own entry in APP below, in
the same shape: the paths verbatim, the measured ink and the crop made from it.

Writes web/src/components/glyphs.tsx, which is generated: a hand edit is lost on
the next run. Run gen_glyph_data.py afterwards, which lifts the drawings into
the data the phone draws.
"""
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "web" / "src" / "components" / "glyphs.tsx"
ASSORTMENT = {e["name"]: e for e in json.loads((ROOT / "scripts" / "glyphs.json").read_text(encoding="utf-8"))}

# The assortment covers every app that speaks GlimStone; these are the meanings
# ArrowLoop has, some of them for pages that are still being built.
STANDARD = [
    "IconAdd",
    "IconBack",
    "IconCheck",
    "IconClose",
    "IconCopy",
    "IconDownload",
    "IconEye",
    "IconEyeOff",
    "IconFilter",
    "IconFolderUp",
    "IconInfo",
    "IconLink",
    "IconMore",
    "IconPause",
    "IconPencil",
    "IconPlay",
    "IconRefresh",
    "IconSave",
    "IconSearch",
    "IconShieldOn",
    "IconSignOut",
    "IconSort",
    "IconTrash",
    "IconUnlock",
    "IconUpload",
    "IconApply",
    "IconConfirm",
    "IconEmpty",
    "IconExport",
    "IconImport",
    "IconPrune",
    "IconRestore",
    "IconRetry",
    "IconStop",
    "IconUndo",
    # The way in and the protections around it.
    "IconForgotPassword",
    "IconKey",
    "IconKeyRevoke",
    "IconShieldOff",
    "IconSignIn",
    # The answers to a conflict.
    "IconKeepBoth",
    "IconKeepLeft",
    "IconKeepRight",
    # Notifications, the update check, what is new and the tray.
    "IconSendTest",
    "IconUpToDate",
    "IconUpdateAvailable",
    "IconWhatsNew",
    "IconApp",
    # The About card's buttons. IconCoffee is a brand mark and goes only on the
    # button that leads there.
    "IconCoffee",
    "IconMail",
    "IconMailOpen",
    "IconManual",
    "IconManualOpen",
    "IconAnomalies",
    "IconDashboard",
    "IconFolder",
    "IconFolderAdd",
    "IconGear",
    "IconPhone",
    "IconSchedules",
    "IconSync",
    # Settings tiles, and the rail entry that gets files back.
    "IconDiagnostics",
    "IconNotifications",
    "IconTabApp",
    "IconTabGeneral",
    "IconTabLook",
    "IconTabRecovery",
    "IconTabSecurity",
    "IconTabStorage",
    # The Look page's choices: design, corners, motion and labels.
    "IconMoon",
    "IconSun",
    "IconThemeSystem",
    "IconCornerRound",
    "IconCornerSoft",
    "IconCornerSquare",
    "IconCornerLeaf",
    "IconMotionOff",
    "IconMotionSubtle",
    "IconMotionWild",
    "IconMotionStorm",
    "IconLabelText",
    "IconLabelTextGlyph",
    "IconLabelGlyph",
    "IconLabelReactive",
]

# Meanings only ArrowLoop has. The Streamline drawings come from the free Core
# Solid subset and fill their 14-unit grid, so most crops are the grid itself.
APP = [
    {
        "name": "IconHistory",
        "means": "What the runs did, the History page",
        "source": "Streamline interface-essential/bullet-list.svg",
        "viewBox": "0 0 14 14",
        "ink": [0, 1.5, 14, 11.001],
        "svg": (
            '<path fill-rule="evenodd" clip-rule="evenodd" d="M2 2.49951c0 0.55229 -0.44772 1 -1 1 -0.552285 0 -1 -0.44771 -1 -1 0 -0.55228 0.447715 -1 1 -1 0.55228 0 1 0.44772 1 1ZM1 8c0.55228 0 1 -0.44772 1 -1s-0.44772 -1 -1 -1c-0.552285 0 -1 0.44772 -1 1s0.447715 1 1 1Zm0 4.5005c0.55228 0 1 -0.4477 1 -1s-0.44772 -1 -1 -1c-0.552285 0 -1 0.4477 -1 1s0.447715 1 1 1ZM4.75 1.75c-0.41421 0 -0.75 0.33579 -0.75 0.75s0.33579 0.75 0.75 0.75h8.5c0.4142 0 0.75 -0.33579 0.75 -0.75s-0.3358 -0.75 -0.75 -0.75h-8.5ZM4 7c0 -0.41421 0.33579 -0.75 0.75 -0.75h8.5c0.4142 0 0.75 0.33579 0.75 0.75s-0.3358 0.75 -0.75 0.75h-8.5C4.33579 7.75 4 7.41421 4 7Zm0.75 3.75c-0.41421 0 -0.75 0.3358 -0.75 0.75s0.33579 0.75 0.75 0.75h8.5c0.4142 0 0.75 -0.3358 0.75 -0.75s-0.3358 -0.75 -0.75 -0.75h-8.5Z" />'
        ),
    },
    {
        "name": "IconConflict",
        "means": "Conflicts: a sync that waits for somebody to choose",
        "source": "Streamline interface-essential/synchronize-warning.svg",
        "viewBox": "0 0 14 14",
        "ink": [0, 0.25, 14, 13.5],
        "svg": (
            '<path fill-rule="evenodd" clip-rule="evenodd" d="M7.00001 1.75c-1.85449 0 -3.48561 0.96181 -4.41976 2.41506l0.67699 0.40619c0.17341 0.10405 0.26707 0.30231 0.23731 0.50234 -0.02977 0.20003 -0.1771 0.36243 -0.37329 0.41148l-2 0.5c-0.267896 0.06698 -0.539363 -0.09591 -0.606338 -0.3638l-0.4999996 -2c-0.0490483 -0.1962 0.0249169 -0.40262 0.1874056 -0.52301 0.162489 -0.12039 0.381502 -0.13105 0.554913 -0.02701l0.536449 0.32187C2.4898 1.50463 4.59775 0.25 7.00001 0.25c2.72533 0 5.07189 1.61511 6.13759 3.93715 0.1728 0.37646 0.0077 0.8217 -0.3688 0.99449 -0.3764 0.17278 -0.8217 0.00766 -0.9945 -0.36879C10.9441 3.00383 9.11767 1.75 7.00001 1.75Zm0.74998 1.75c0 -0.41421 -0.33578 -0.75 -0.75 -0.75 -0.41421 0 -0.75 0.33579 -0.75 0.75v4c0 0.41421 0.33579 0.75 0.75 0.75 0.41422 0 0.75 -0.33579 0.75 -0.75v-4Zm-0.75 7.5c0.55229 0 1 -0.4477 1 -1 0 -0.55229 -0.44771 -1 -1 -1 -0.55228 0 -1 0.44771 -1 1 0 0.5523 0.44772 1 1 1Zm4.41981 -1.16504 -0.6771 -0.40621c-0.1734 -0.10405 -0.267 -0.30231 -0.2373 -0.50234 0.0298 -0.20003 0.1771 -0.36243 0.3733 -0.41148l2 -0.5c0.2679 -0.06698 0.5394 0.0959 0.6064 0.3638l0.5 1.99997c0.049 0.1962 -0.025 0.4026 -0.1874 0.523 -0.1625 0.1204 -0.3815 0.1311 -0.555 0.027l-0.5364 -0.3218C11.5102 12.4954 9.40228 13.75 7.00002 13.75c-2.72533 0 -5.07186 -1.6151 -6.137594 -3.93715 -0.172781 -0.37646 -0.007669 -0.8217 0.368784 -0.99448 0.37646 -0.17279 0.82171 -0.00767 0.99449 0.36878C3.05597 10.9962 4.88236 12.25 7.00002 12.25c1.85448 0 3.48558 -0.9618 4.41978 -2.41504Z" />'
        ),
    },
    {
        "name": "IconPreview",
        # The eye already means "show the secret", so the look ahead at a run
        # wears a lens in a frame instead.
        "means": "See what a run would do before it does it",
        "source": "Streamline interface-essential/search-visual.svg",
        "viewBox": "0 0 14 14",
        "ink": [0, 0, 14, 14],
        "svg": (
            '<path fill-rule="evenodd" clip-rule="evenodd" d="M1.75 1.5c-0.0663 0 -0.12989 0.02634 -0.17678 0.07322C1.52634 1.62011 1.5 1.6837 1.5 1.75v1.5c0 0.41421 -0.33579 0.75 -0.75 0.75C0.335786 4 0 3.66421 0 3.25v-1.5C0 1.28587 0.184375 0.840752 0.512563 0.512563 0.840752 0.184375 1.28587 0 1.75 0h1.5c0.41421 0 0.75 0.335786 0.75 0.75 0 0.41421 -0.33579 0.75 -0.75 0.75h-1.5Zm11.5 8.5c0.4142 0 0.75 0.3358 0.75 0.75v1.5c0 0.4641 -0.1844 0.9092 -0.5126 1.2374 -0.3282 0.3282 -0.7733 0.5126 -1.2374 0.5126h-1.5c-0.4142 0 -0.75 -0.3358 -0.75 -0.75s0.3358 -0.75 0.75 -0.75h1.5c0.0663 0 0.1299 -0.0263 0.1768 -0.0732 0.0469 -0.0469 0.0732 -0.1105 0.0732 -0.1768v-1.5c0 -0.4142 0.3358 -0.75 0.75 -0.75Zm-11.75 0.75c0 -0.4142 -0.33579 -0.75 -0.75 -0.75 -0.414214 0 -0.75 0.3358 -0.75 0.75v1.5c0 0.4641 0.184375 0.9092 0.512563 1.2374C0.840752 13.8156 1.28587 14 1.75 14h1.5c0.41421 0 0.75 -0.3358 0.75 -0.75s-0.33579 -0.75 -0.75 -0.75h-1.5c-0.0663 0 -0.12989 -0.0263 -0.17678 -0.0732C1.52634 12.3799 1.5 12.3163 1.5 12.25v-1.5Zm8.5 -10c0 -0.414214 0.3358 -0.75 0.75 -0.75h1.5c0.4641 0 0.9092 0.184375 1.2374 0.512563C13.8156 0.840752 14 1.28587 14 1.75v1.5c0 0.41421 -0.3358 0.75 -0.75 0.75s-0.75 -0.33579 -0.75 -0.75v-1.5c0 -0.0663 -0.0263 -0.12989 -0.0732 -0.17678C12.3799 1.52634 12.3163 1.5 12.25 1.5h-1.5c-0.4142 0 -0.75 -0.33579 -0.75 -0.75ZM6.25 4C5.00736 4 4 5.00736 4 6.25S5.00736 8.5 6.25 8.5 8.5 7.49264 8.5 6.25 7.49264 4 6.25 4ZM2.5 6.25c0 -2.07107 1.67893 -3.75 3.75 -3.75C8.32107 2.5 10 4.17893 10 6.25c0 0.76431 -0.22866 1.47522 -0.6213 2.06804l1.6516 1.65163c0.2929 0.29293 0.2929 0.76773 0 1.06063 -0.2929 0.2929 -0.7677 0.2929 -1.06063 0L8.31804 9.3787C7.72522 9.77134 7.01431 10 6.25 10 4.17893 10 2.5 8.32107 2.5 6.25Z" />'
        ),
    },
    {
        "name": "IconForget",
        "means": "Forget a drive, leaving its marker on the drive",
        "source": "Streamline interface-essential/subtract-circle.svg",
        "viewBox": "0 0 14 14",
        "ink": [0, 0, 14, 14],
        "svg": (
            '<path fill-rule="evenodd" clip-rule="evenodd" d="M7 14c3.866 0 7 -3.134 7 -7 0 -3.86599 -3.134 -7 -7 -7 -3.86599 0 -7 3.13401 -7 7 0 3.866 3.13401 7 7 7ZM4 6.25c-0.41421 0 -0.75 0.33579 -0.75 0.75s0.33579 0.75 0.75 0.75h6c0.4142 0 0.75 -0.33579 0.75 -0.75s-0.3358 -0.75 -0.75 -0.75H4Z" />'
        ),
    },
    {
        "name": "IconToRight",
        "means": "A job that copies left to right only",
        "source": "Streamline interface-essential/arrow-up-1.svg, turned",
        "viewBox": "0 0 14 14",
        "ink": [0, 3, 14, 8],
        "svg": (
            '<g transform="rotate(90 7 7)"><path fill-rule="evenodd" clip-rule="evenodd" d="M6.64645 0.146447c0.19526 -0.1952625 0.51184 -0.1952625 0.7071 0L10.8536 3.64645c0.143 0.143 0.1857 0.35805 0.1083 0.54489 -0.0774 0.18684 -0.2597 0.30866 -0.4619 0.30866H8V13c0 0.5523 -0.44772 1 -1 1 -0.55229 0 -1 -0.4477 -1 -1V4.5H3.5c-0.20223 0 -0.38455 -0.12182 -0.46194 -0.30866 -0.07739 -0.18684 -0.03461 -0.40189 0.10839 -0.54489l3.5 -3.500003Z" /></g>'
        ),
    },
    {
        "name": "IconToLeft",
        "means": "A job that copies right to left only",
        "source": "Streamline interface-essential/arrow-up-1.svg, turned",
        "viewBox": "0 0 14 14",
        "ink": [0, 3, 14, 8],
        "svg": (
            '<g transform="rotate(-90 7 7)"><path fill-rule="evenodd" clip-rule="evenodd" d="M6.64645 0.146447c0.19526 -0.1952625 0.51184 -0.1952625 0.7071 0L10.8536 3.64645c0.143 0.143 0.1857 0.35805 0.1083 0.54489 -0.0774 0.18684 -0.2597 0.30866 -0.4619 0.30866H8V13c0 0.5523 -0.44772 1 -1 1 -0.55229 0 -1 -0.4477 -1 -1V4.5H3.5c-0.20223 0 -0.38455 -0.12182 -0.46194 -0.30866 -0.07739 -0.18684 -0.03461 -0.40189 0.10839 -0.54489l3.5 -3.500003Z" /></g>'
        ),
    },
    {
        "name": "IconBothWays",
        # The two one-way arrows as they are, the one to the right above the
        # one to the left, so the three directions read as one family.
        "means": "A job that syncs both ways",
        "source": "Streamline interface-essential/arrow-up-1.svg, as IconToRight above IconToLeft",
        "viewBox": "-1.5 0 17 17",
        "ink": [0, 0, 14, 17],
        "svg": (
            '<g transform="translate(0 -3) rotate(90 7 7)"><path fill-rule="evenodd" clip-rule="evenodd" d="M6.64645 0.146447c0.19526 -0.1952625 0.51184 -0.1952625 0.7071 0L10.8536 3.64645c0.143 0.143 0.1857 0.35805 0.1083 0.54489 -0.0774 0.18684 -0.2597 0.30866 -0.4619 0.30866H8V13c0 0.5523 -0.44772 1 -1 1 -0.55229 0 -1 -0.4477 -1 -1V4.5H3.5c-0.20223 0 -0.38455 -0.12182 -0.46194 -0.30866 -0.07739 -0.18684 -0.03461 -0.40189 0.10839 -0.54489l3.5 -3.500003Z" /></g>'
            '<g transform="translate(0 6) rotate(-90 7 7)"><path fill-rule="evenodd" clip-rule="evenodd" d="M6.64645 0.146447c0.19526 -0.1952625 0.51184 -0.1952625 0.7071 0L10.8536 3.64645c0.143 0.143 0.1857 0.35805 0.1083 0.54489 -0.0774 0.18684 -0.2597 0.30866 -0.4619 0.30866H8V13c0 0.5523 -0.44772 1 -1 1 -0.55229 0 -1 -0.4477 -1 -1V4.5H3.5c-0.20223 0 -0.38455 -0.12182 -0.46194 -0.30866 -0.07739 -0.18684 -0.03461 -0.40189 0.10839 -0.54489l3.5 -3.500003Z" /></g>'
        ),
    },
    {
        "name": "IconLock",
        "means": "Locked or encrypted: the app lock, a target that encrypts what is written into it",
        "source": "Streamline interface-essential/padlock-square-1.svg",
        "viewBox": "0 0 14 14",
        "ink": [1.5, 0, 11, 14],
        "svg": (
            '<path fill-rule="evenodd" clip-rule="evenodd" d="M7 2a2 2 0 0 0 -2 2v1h4V4a2 2 0 0 0 -2 -2ZM3 4v1a1.5 1.5 0 0 0 -1.5 1.5v6A1.5 1.5 0 0 0 3 14h8a1.5 1.5 0 0 0 1.5 -1.5v-6A1.5 1.5 0 0 0 11 5V4a4 4 0 1 0 -8 0Zm4 6.75a1.25 1.25 0 1 0 0 -2.5 1.25 1.25 0 0 0 0 2.5Z" />'
        ),
    },
    {
        "name": "IconServer",
        "means": "SFTP: a machine reached over SSH",
        "source": "Streamline computer-devices/database-server-2.svg",
        "viewBox": "0 -0.006 14 14",
        "ink": [0, 0, 14, 13.987],
        "svg": (
            '<path fill-rule="evenodd" clip-rule="evenodd" d="M0 1.5A1.5 1.5 0 0 1 1.5 0h11A1.5 1.5 0 0 1 14 1.5V3a1.5 1.5 0 0 1 -1.5 1.5h-11A1.5 1.5 0 0 1 0 3V1.5Zm0 6A1.5 1.5 0 0 1 1.5 6h11A1.5 1.5 0 0 1 14 7.5V9a1.5 1.5 0 0 1 -1.5 1.5H7.75v1.987H12a0.75 0.75 0 0 1 0 1.5H2a0.75 0.75 0 0 1 0 -1.5h4.25V10.5H1.5A1.5 1.5 0 0 1 0 9V7.5Zm3.5 -5.25a0.75 0.75 0 1 1 -1.5 0 0.75 0.75 0 0 1 1.5 0Zm4.33 -0.625a0.625 0.625 0 1 0 0 1.25H11a0.625 0.625 0 1 0 0 -1.25H7.83ZM3.5 8.25a0.75 0.75 0 1 1 -1.5 0 0.75 0.75 0 0 1 1.5 0Zm3.706 0c0 -0.345 0.28 -0.625 0.625 -0.625H11a0.625 0.625 0 1 1 0 1.25H7.83a0.625 0.625 0 0 1 -0.624 -0.625Z" />'
        ),
    },
    {
        "name": "IconTransfer",
        "means": "FTP: the protocol whose whole name is the transfer",
        "source": "Streamline interface-essential/arrow-transfer-diagonal-1.svg",
        "viewBox": "0 0 14 14",
        "ink": [0, 0, 14, 14],
        "svg": (
            '<path fill-rule="evenodd" clip-rule="evenodd" d="M10.9977 1.06752c-0.0156 0.23297 -0.1125 0.46151 -0.2906 0.63959l-1.99999 2 -7 6.99999c-0.39053 0.3905 -1.023693 0.3905 -1.414217 0 -0.3905241 -0.3905 -0.3905241 -1.02368 0 -1.41421L6.58579 3l-1.2929 -1.29289c-0.28599 -0.286 -0.37155 -0.716119 -0.21677 -1.089793C5.2309 0.243642 5.59554 0 6 0h4c0.2546 0 0.4934 0.096541 0.674 0.261286m0.0818 0.083848c0.0691 0.07974 0.1263 0.171214 0.1681 0.272183 0.0341 0.082471 0.0566 0.167691 0.0678 0.253505 -0.0245 -0.189242 -0.1032 -0.372814 -0.2359 -0.525688ZM7.41421 11l6.29289 -6.29289c0.3905 -0.39053 0.3905 -1.02369 0 -1.41422 -0.3905 -0.39052 -1.0237 -0.39052 -1.4142 0L5.29289 10.2929l-2 2c-0.17808 0.1781 -0.27495 0.4066 -0.29062 0.6396 -0.00443 0.0653 -0.00248 0.1311 0.00606 0.1967 0.02439 0.1883 0.10234 0.3709 0.23386 0.5233 0.02624 0.0305 0.05422 0.0593 0.08376 0.0862 0.178 0.1627 0.40056 0.2494 0.62608 0.2602C3.96801 13.9996 3.984 14 4 14h4c0.40446 0 0.7691 -0.2436 0.92388 -0.6173 0.15478 -0.3737 0.06922 -0.8038 -0.21677 -1.0898L7.41421 11Z" />'
        ),
    },
    {
        "name": "IconBuckets",
        "means": "S3: object storage, which is buckets",
        "source": "Streamline computer-devices/database.svg",
        "viewBox": "0.056 0.112 13.888 13.888",
        "ink": [0.488, 0.112, 13.024, 13.888],
        "svg": (
            '<path fill-rule="evenodd" clip-rule="evenodd" d="M0.551514 2.27783c0 -0.15488 0.07702 -0.36799 0.357204 -0.62937 0.281142 -0.26227 0.721972 -0.52723 1.318962 -0.762786C3.41794 0.416028 5.10495 0.111832 6.99996 0.111832S10.582 0.416028 11.7722 0.885674c0.597 0.235556 1.0379 0.500516 1.319 0.762786 0.2802 0.26138 0.3572 0.47449 0.3572 0.62937 0 0.15487 -0.077 0.36799 -0.3572 0.62936 -0.2811 0.26227 -0.722 0.52723 -1.319 0.76279 -1.1902 0.46965 -2.87723 0.77384 -4.77224 0.77384s-3.58202 -0.30419 -4.77228 -0.77384c-0.59699 -0.23556 -1.03782 -0.50052 -1.318962 -0.76279 -0.280184 -0.26137 -0.357204 -0.47449 -0.357204 -0.62936ZM13.5121 4.16708c-0.3673 0.25522 -0.8026 0.47686 -1.2811 0.66566 -1.3698 0.54049 -3.21949 0.86108 -5.23104 0.86108s-3.86126 -0.32059 -5.23108 -0.86108c-0.47845 -0.18879 -0.913723 -0.41041 -1.280965 -0.66562v3.17781c0.055969 0.0849 0.135466 0.17801 0.246193 0.27869 0.289992 0.26368 0.744472 0.52986 1.359042 0.76629 1.22499 0.47125 2.95961 0.77608 4.90685 0.77608 1.94723 0 3.6819 -0.30483 4.9068 -0.77608 0.6146 -0.23643 1.0691 -0.50261 1.3591 -0.76629 0.1107 -0.10067 0.1902 -0.19378 0.2462 -0.27868V4.16708ZM0.487915 11.209V8.99273c0.341164 0.21282 0.732125 0.4006 1.156435 0.56383C3.04569 10.0957 4.93936 10.416 7 10.416c2.06063 0 3.9543 -0.3203 5.3556 -0.85944 0.4243 -0.16323 0.8153 -0.351 1.1565 -0.56383V11.209c0 1.5406 -2.9154 2.791 -6.51211 2.791 -3.59667 0 -6.512075 -1.2504 -6.512075 -2.791Z" />'
        ),
    },
    {
        "name": "IconQr",
        "means": "Show a download as a code to scan with the phone",
        "source": "Streamline money-shopping/qr-code.svg",
        "viewBox": "0.076 0.076 13.848 13.848",
        "ink": [0.076, 0.076, 13.848, 13.848],
        "svg": (
            '<path fill-rule="evenodd" clip-rule="evenodd" d="M1.77607 0.0762329c-0.45082 0 -0.883169 0.1790861 -1.201944 0.4978621C0.25535 0.892871 0.0762634 1.32522 0.0762634 1.77604v1.42471c0 0.41422 0.3357866 0.75 0.7499996 0.75 0.414217 0 0.749997 -0.33578 0.749997 -0.75V1.77604c0 -0.05299 0.02105 -0.10381 0.05853 -0.14128 0.03747 -0.03748 0.08829 -0.05853 0.14128 -0.05853h1.42471c0.41422 0 0.75 -0.33578 0.75 -0.749997 0 -0.414214 -0.33578 -0.7500001 -0.75 -0.7500001H1.77607ZM3.99586 2.74559c-0.69036 0 -1.25 0.55965 -1.25 1.25v2.07296c0 0.69036 0.55964 1.25 1.25 1.25h2.07296c0.69035 0 1.25 -0.55964 1.25 -1.25V3.99559c0 -0.69036 -0.55965 -1.25 -1.25 -1.25H3.99586Zm0.25 3.07296V4.24559h1.57296v1.57296H4.24586ZM10.0493 0.826309c0 -0.414213 0.3358 -0.7499998 0.75 -0.7499998h1.4247c0.4508 0 0.8832 0.1790868 1.202 0.4978618 0.3187 0.318776 0.4978 0.751129 0.4978 1.201949v1.42471c0 0.41421 -0.3358 0.75 -0.75 0.75s-0.75 -0.33579 -0.75 -0.75V1.77612c0 -0.053 -0.021 -0.10382 -0.0585 -0.14129 -0.0375 -0.03747 -0.0883 -0.05852 -0.1413 -0.05852h-1.4247c-0.4142 0 -0.75 -0.33579 -0.75 -0.750001ZM1.57632 10.7993c0 -0.4142 -0.33578 -0.75 -0.749996 -0.75 -0.414213 0 -0.7499995 0.3358 -0.7499995 0.75v1.4247c0 0.4508 0.1790865 0.8832 0.4978625 1.202 0.318775 0.3187 0.751123 0.4978 1.201943 0.4978h1.42471c0.41422 0 0.75 -0.3358 0.75 -0.75s-0.33578 -0.75 -0.75 -0.75H1.77613c-0.05299 0 -0.10381 -0.021 -0.14128 -0.0585 -0.03747 -0.0375 -0.05853 -0.0883 -0.05853 -0.1413v-1.4247Zm11.59748 -0.75c0.4142 0 0.75 0.3358 0.75 0.75v1.4247c0 0.4508 -0.1791 0.8832 -0.4978 1.202 -0.3188 0.3187 -0.7512 0.4978 -1.202 0.4978h-1.4247c-0.4142 0 -0.75 -0.3358 -0.75 -0.75s0.3358 -0.75 0.75 -0.75h1.4247c0.053 0 0.1038 -0.021 0.1413 -0.0585 0.0375 -0.0375 0.0585 -0.0883 0.0585 -0.1413v-1.4247c0 -0.4142 0.3358 -0.75 0.75 -0.75Zm-8.92789 -0.85918c0 -0.41421 -0.33579 -0.75 -0.75 -0.75s-0.75 0.33579 -0.75 0.75v1.31408c0 0.4142 0.33579 0.75 0.75 0.75H4.81c0.41421 0 0.75 -0.3358 0.75 -0.75s-0.33579 -0.74999 -0.75 -0.74999h-0.56409v-0.56409Zm1.46005 0c0 -0.41421 0.33579 -0.75 0.75 -0.75h0.54402c0.41422 0 0.75 0.33579 0.75 0.75v1.31408c0 0.4142 -0.33578 0.75 -0.75 0.75 -0.41421 0 -0.75 -0.3358 -0.75 -0.75v-0.59271c-0.31406 -0.08951 -0.54402 -0.37858 -0.54402 -0.72137Zm4.2342 -5.69445c0 -0.41422 -0.33579 -0.75 -0.75 -0.75 -0.41422 0 -0.75 0.33578 -0.75 0.75v1.31409c0 0.41421 0.33578 0.75 0.75 0.75h1.31404c0.4143 0 0.75 -0.33579 0.75 -0.75 0 -0.41422 -0.3357 -0.75 -0.75 -0.75l-0.56404 0v-0.56409Zm-1.5 3.50431c0 -0.41421 0.33578 -0.75 0.75 -0.75h1.31404c0.4143 0 0.75 0.33579 0.75 0.75v0.63901c0 0.41421 -0.3357 0.74999 -0.75 0.74999 -0.3765 0 -0.68816 -0.27742 -0.7418 -0.639h-0.57224c-0.41422 0 -0.75 -0.33578 -0.75 -0.75Zm1.5 2.19014c0 -0.41421 -0.33579 -0.75 -0.75 -0.75 -0.41422 0 -0.75 0.33579 -0.75 0.75v1.31408c0 0.4142 0.33578 0.75 0.75 0.75h1.31404c0.4143 0 0.75 -0.3358 0.75 -0.75s-0.3357 -0.74999 -0.75 -0.74999h-0.56404v-0.56409Z" />'
        ),
    },
    {
        "name": "IconWallet",
        "means": "Give with crypto",
        "source": "Streamline money-shopping/wallet.svg",
        "viewBox": "0 0.546 13.763 13.763",
        "ink": [0, 0.855, 13.763, 13.145],
        "svg": (
            '<path fill-rule="evenodd" clip-rule="evenodd" d="M0 4.35474C0 2.42174 1.567 0.854736 3.5 0.854736H10c0.2761 0 0.5 0.223854 0.5 0.500004v1.39795l-7.14453 0c-0.34518 0 -0.625 0.27982 -0.625 0.625 0 0.34517 0.27982 0.625 0.625 0.625l7.58413 0c0.0198 0 0.0394 -0.00093 0.0587 -0.00273l0.2138 0c0.3978 0 0.7793 0.15803 1.0606 0.43934 0.2813 0.2813 0.4394 0.66283 0.4394 1.06066v0.91618H9.76276c-0.82448 0 -1.75 0.62476 -1.75 1.6946v1.77843c0 1.06983 0.92552 1.69463 1.75 1.69463h2.94934v0.9161c0 0.3979 -0.1581 0.7794 -0.4394 1.0607s-0.6628 0.4393 -1.0606 0.4393L1.5 14c-0.39783 0 -0.779356 -0.1581 -1.06066 -0.4394C0.158035 13.2793 0 12.8978 0 12.5V4.35474Zm9.76276 3.3114h3.50004c0.2761 0 0.5 0.19905 0.5 0.4446v1.77843c0 0.24553 -0.2239 0.44463 -0.5 0.44463H9.76276c-0.27615 0 -0.5 -0.1991 -0.5 -0.44463V8.11074c0 -0.24555 0.22385 -0.4446 0.5 -0.4446Z" />'
        ),
    },
    {
        "name": "IconCheckDraw",
        "means": "A tick that draws itself in where a copy or a check has just worked",
        "source": "Drawn for ArrowLoop",
        # Stroked, unlike every other glyph, because the draw-in runs a dash
        # offset along the line; pathLength makes that one unit whatever the
        # geometry. The box stays the grid so the tick keeps the reach of the
        # round glyph it stands in for (glyphs.reach.test.ts).
        "viewBox": "0 0 14 14",
        "ink": [1.3, 2.3, 11.4, 9.7],
        "svg": (
            '<path d="M2.4 7.4L5.6 10.9L11.6 3.4" pathLength="1" fill="none" stroke="currentColor"'
            ' stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" />'
        ),
    },
]

# Glyphs that point along the reading direction, so a right-to-left layout
# mirrors them.
MIRRORED = {"IconBack", "IconSignIn", "IconSignOut"}

# Where a drawing comes from decides what the file owes its author. A source
# matching neither these nor NO_LICENCE stops the run, so a glyph from a new set
# cannot ship without its licence line.
LICENCES = [
    ("Streamline", "Free icons from Streamline, https://streamlinehq.com (CC BY 4.0)"),
    ("Font Awesome Free", "Font Awesome Free, https://fontawesome.com (icons: CC BY 4.0)"),
    ("Tabler Icons", "Tabler Icons, https://tabler.io/icons (MIT)"),
    ("Material Design Icons", "Material Design Icons, https://pictogrammers.com/library/mdi/ (Apache 2.0)"),
    ("Simple Icons", "Simple Icons, https://simpleicons.org (CC0)"),
]
NO_LICENCE = ("Drawn", "KnightLoader's drawing")

TRADEMARKS = {
    "IconCoffee": "Buy Me a Coffee",
}

HEADER = """// ArrowLoop's icon set.
//
// GENERATED by scripts/gen_glyphs.py from scripts/glyphs.json, GlimStone's glyph
// assortment, and the generator's own table of ArrowLoop's meanings. Do not
// hand-edit: regenerate instead, or the next run silently overwrites the change.
//
// Attribution, required by the licences below:
%(licences)s
//
// Only Streamline's free 1000-icon subset is used
// (github.com/webalys-hq/streamline-vectors, core/solid), which is CC BY 4.0
// and may be redistributed. The 5771-icon set sold on streamlinehq.com is a
// separate product whose licence forbids redistribution.
%(trademarks)s//
// Every glyph takes the ink of its control through `currentColor`, so it is
// right in every theme, and is `aria-hidden`, because the control's label is
// its accessible name. Each viewBox is a square cropped to the drawing's
// measured ink, which makes glyphs from different sets the same size in the
// same box.

import type { ReactNode, SVGProps } from 'react'

function G({
  box,
  mirror = false,
  children,
  ...rest
}: { box: string; mirror?: boolean; children: ReactNode } & SVGProps<SVGSVGElement>) {
  return (
    <svg
      width="14"
      height="14"
      viewBox={box}
      fill="currentColor"
      className={mirror ? 'shrink-0 rtl:-scale-x-100' : 'shrink-0'}
      aria-hidden="true"
      {...rest}
    >
      {children}
    </svg>
  )
}
"""


def licence(name, source):
    for prefix, line in LICENCES:
        if source.startswith(prefix):
            return line
    if source.startswith(NO_LICENCE):
        return None
    raise SystemExit("%s comes from %r, which has no licence line in LICENCES" % (name, source))


def jsx(svg):
    """An entry's markup as JSX lines, without what the wrapper already sets.

    Streamline exports wrap their paths in a bare <g> and repeat the fill and a
    stroke width on every path; the wrapper's fill reaches them anyway.
    """
    s = svg.strip()
    bare = re.fullmatch(r"<g>\s*(.*?)\s*</g>", s, re.S)
    if bare:
        s = bare.group(1)
    s = re.sub(r'\s(?:fill="currentColor"|stroke-width="1")(?=[\s/>])', "", s)
    s = re.sub(r"<(\w+)([^<>]*?)\s*>\s*</\1>", r"<\1\2 />", s)
    s = re.sub(r"\s*/>", " />", s)
    s = re.sub(r"\b([a-z]+)-([a-z]+)=", lambda m: m.group(1) + m.group(2).capitalize() + "=", s)
    lines, depth = [], 0
    for tag in re.findall(r"<[^<>]+>", s):
        if tag.startswith("</"):
            depth -= 1
        lines.append("  " * depth + tag)
        if not tag.startswith("</") and not tag.endswith("/>"):
            depth += 1
    return lines


def component(entry):
    name = entry["name"]
    mirror = " mirror" if name in MIRRORED else ""
    body = "\n".join("      " + line for line in jsx(entry["svg"]))
    return (
        "\n/** %s. %s. */\n"
        "export function %s(props: SVGProps<SVGSVGElement>) {\n"
        "  return (\n"
        '    <G box="%s"%s {...props}>\n'
        "%s\n"
        "    </G>\n"
        "  )\n"
        "}\n" % (entry["means"], entry["source"].rstrip("."), name, entry["viewBox"], mirror, body)
    )


def wrap(text, width=80):
    lines, line = [], "//"
    for word in text.split():
        if len(line) + 1 + len(word) > width:
            lines.append(line)
            line = "//"
        line += " " + word
    lines.append(line)
    return "\n".join(lines)


def main():
    own = {e["name"] for e in APP}
    clash = own & set(ASSORTMENT)
    if clash:
        raise SystemExit("ArrowLoop's own table reuses assortment names: %s" % ", ".join(sorted(clash)))
    missing = [n for n in STANDARD if n not in ASSORTMENT]
    if missing:
        raise SystemExit("not in glyphs.json: %s" % ", ".join(missing))

    # The assortment's own order, so a refreshed copy moves nothing it did not change.
    entries = [e for e in ASSORTMENT.values() if e["name"] in STANDARD] + APP

    used = []
    for e in entries:
        line = licence(e["name"], e["source"])
        if line and line not in used:
            used.append(line)
    licences = "\n".join("//   " + line for line in sorted(used, key=[l for _, l in LICENCES].index))
    marks = ["%s (%s)" % (n, TRADEMARKS[n]) for n in STANDARD if n in TRADEMARKS]
    trademarks = ""
    if marks:
        joined = marks[0] if len(marks) == 1 else ", ".join(marks[:-1]) + " and " + marks[-1]
        text = "%s %s of %s, used unmodified and only to name what the control leads to, with no claim of endorsement or affiliation." % (
            joined,
            "is a trademark" if len(marks) == 1 else "are trademarks",
            "its owner" if len(marks) == 1 else "their owners",
        )
        trademarks = "//\n" + wrap(text) + "\n"

    out = [HEADER % {"licences": licences, "trademarks": trademarks}]
    out.extend(component(e) for e in entries)
    OUT.write_text("".join(out), encoding="utf-8", newline="")
    print("wrote %d glyphs to %s" % (len(entries), OUT.relative_to(ROOT)))


if __name__ == "__main__":
    main()
