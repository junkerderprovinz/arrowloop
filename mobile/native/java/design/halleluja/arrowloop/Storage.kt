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
 * THE DECISION THIS FILE IMPLEMENTS, and it reverses an earlier one.
 *
 * The plan was the Storage Access Framework. Two things make that impossible
 * rather than merely awkward here, and both were found by reading Android's
 * own source rather than by trying it:
 *
 * SAF cannot set a modification time. `DocumentsProvider.update()` is declared
 * `public final` and throws `UnsupportedOperationException`, so no client can
 * override it and no client can call it usefully. That is still true at API 36.
 * A two-way sync whose whole comparison rests on size and mtime cannot use a
 * store that refuses to write one of the two.
 *
 * And SAF is not reachable from here AT ALL. ArrowLoop's engine is the same
 * static binary the container and the desktop run, started as its own POSIX
 * process - see Engine.kt for why that is the shape. SAF lives behind Binder
 * and the JVM: a child process has no ContentResolver, no JNI environment and
 * no way to get one. Syncthing hit exactly this and never got past it. Making
 * SAF work would mean binding the engine into the app process with gomobile,
 * which is a different build of the engine for one platform out of four, and
 * it still would not solve the mtime.
 *
 * So: MANAGE_EXTERNAL_STORAGE. The engine keeps talking to a filesystem the
 * way it does everywhere else, mtimes work, the three-way comparison works, and
 * there is one engine rather than one plus an Android variant. Google permits
 * the permission for exactly this category of app - "Backup and restore apps" -
 * and it is what FolderSync ships with. jdp chose this route on 2026-09-10
 * after the SAF finding was put to them.
 *
 * The price is honest and worth saying out loud: this is the broadest file
 * permission Android has, the Play listing has to justify it, and the person
 * installing sees a full-screen system page rather than a one-tap dialog.
 */
object Storage {

    /**
     * Android 10 is the gap, and pretending otherwise would be worse than
     * saying so.
     *
     * Below 29, WRITE_EXTERNAL_STORAGE still grants broad access and is a
     * normal runtime permission. From 30, MANAGE_EXTERNAL_STORAGE is the way.
     * On 29 exactly, scoped storage is enforced and MANAGE_EXTERNAL_STORAGE
     * does not exist yet - `requestLegacyExternalStorage` is the documented
     * escape and the system ignores it for an app targeting above 29, which
     * this one must. So an Android 10 phone can sync its own folder and
     * nothing else, and the panel says that rather than sending somebody to a
     * settings page that will not help.
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
     * The system page that grants it, addressed to THIS app.
     *
     * With the package in the data uri rather than the bare action: the bare
     * one opens a list of every app on the phone and leaves the person to find
     * ArrowLoop in it. Some builds refuse the targeted form, so the caller
     * falls back - see MainActivity.
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
