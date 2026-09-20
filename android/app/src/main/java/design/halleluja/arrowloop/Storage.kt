package design.halleluja.arrowloop

import android.Manifest
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.provider.Settings
import androidx.core.content.ContextCompat

/**
 * Whether the engine can reach the phone's files, and how to ask for it.
 *
 * The Storage Access Framework does not work here. It cannot set a modification
 * time (`DocumentsProvider.update()` is `public final` and throws, still at API
 * 36), and a two-way sync compares on size and mtime. It is also unreachable from
 * the engine, which runs as its own POSIX process with no ContentResolver or JNI
 * environment; binding it into the app with gomobile would mean a separate engine
 * build for one platform and would still not fix the mtime.
 *
 * MANAGE_EXTERNAL_STORAGE lets the engine use the filesystem as it does
 * everywhere else. Google permits it for backup and restore apps, but it is the
 * broadest file permission Android has: the Play listing has to justify it, and
 * granting it takes a full-screen system page rather than a dialog.
 */
object Storage {

    /**
     * False on Android 10 only. Below it WRITE_EXTERNAL_STORAGE grants broad
     * access, from 11 MANAGE_EXTERNAL_STORAGE does, but on 10 scoped storage is
     * enforced and `requestLegacyExternalStorage` is ignored for an app targeting
     * above 29, so the app can sync its own folder and nothing else.
     */
    val possible: Boolean =
        Build.VERSION.SDK_INT >= Build.VERSION_CODES.R ||
            Build.VERSION.SDK_INT < Build.VERSION_CODES.Q

    fun granted(context: Context): Boolean = when {
        Build.VERSION.SDK_INT >= Build.VERSION_CODES.R -> Environment.isExternalStorageManager()
        Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q -> false
        else -> ContextCompat.checkSelfPermission(
            context, Manifest.permission.WRITE_EXTERNAL_STORAGE,
        ) == PackageManager.PERMISSION_GRANTED
    }

    /**
     * The system page that grants the permission to this app. Without the
     * package it opens a list of every app; some builds refuse the targeted form,
     * so the caller falls back to [manageIntentFallback].
     */
    fun manageIntent(context: Context): Intent =
        Intent(
            Settings.ACTION_MANAGE_APP_ALL_FILES_ACCESS_PERMISSION,
            Uri.parse("package:${context.packageName}"),
        )

    /** The same page without the package, for builds that refuse the above. */
    fun manageIntentFallback(): Intent =
        Intent(Settings.ACTION_MANAGE_ALL_FILES_ACCESS_PERMISSION)
}
