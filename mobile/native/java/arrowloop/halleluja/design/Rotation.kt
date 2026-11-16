package arrowloop.halleluja.design

import android.app.Activity
import android.content.pm.ActivityInfo
import android.content.res.Configuration

/** Where Android itself draws the line between a phone and a tablet, as sw600dp resources do. */
private const val TABLET_DP = 600

/**
 * Lets a tablet follow the device and holds a phone upright. A foldable
 * crosses the line when it opens or closes, so this runs on every
 * configuration change as well as at the start.
 */
fun Activity.followRotationOnTablets(config: Configuration) {
    val wanted =
        if (config.smallestScreenWidthDp >= TABLET_DP) ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED
        else ActivityInfo.SCREEN_ORIENTATION_PORTRAIT
    // Asking again for the orientation in force still goes through the window manager.
    if (requestedOrientation != wanted) requestedOrientation = wanted
}
