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
 * The engine uses MANAGE_EXTERNAL_STORAGE rather than the Storage Access
 * Framework. SAF cannot set a modification time (`DocumentsProvider.update()`
 * is final and throws, still at API 36), and the sync compares size and
 * mtime. SAF is also unreachable from the engine, which runs as its own
 * process with no ContentResolver (see Engine.kt). Google allows the
 * permission for backup and restore apps.
 */
object Storage {

    /**
     * False on Android 10, where scoped storage is enforced,
     * MANAGE_EXTERNAL_STORAGE does not exist yet, and
     * `requestLegacyExternalStorage` is ignored for this app's target SDK.
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
     * package it opens a list of every app instead.
     */
    fun manageIntent(context: Context): Intent =
        Intent(
            Settings.ACTION_MANAGE_APP_ALL_FILES_ACCESS_PERMISSION,
            Uri.parse("package:${context.packageName}"),
        )

    /** The app list, for builds that refuse the targeted page. */
    fun manageIntentFallback(): Intent =
        Intent(Settings.ACTION_MANAGE_ALL_FILES_ACCESS_PERMISSION)
}
