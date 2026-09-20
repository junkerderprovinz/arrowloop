package design.halleluja.arrowloop

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities
import android.net.NetworkRequest
import android.os.BatteryManager
import java.net.HttpURLConnection
import java.net.URL

/**
 * Watches power and network and tells the engine whether a condition holds
 * automatic runs; runs started by hand are never held. It lives in Kotlin,
 * with its settings in SharedPreferences, because it has to keep working
 * after React Native's context is gone. The engine gets a sentence for its
 * log rather than flags.
 */
object Device {

    private const val PREFS = "device"
    private const val ONLY_CHARGING = "onlyCharging"
    private const val ONLY_WIFI = "onlyWifi"

    /** The battery floor in percent; zero, the default, is off. */
    private const val MIN_BATTERY = "minBattery"
    private const val NOT_ROAMING = "notRoaming"
    private const val NOT_METERED = "notMetered"

    /** The last verdict sent; Android rebroadcasts the battery level every few seconds. */
    private var sent: String? = null

    /** The verdict being sent, so a burst of broadcasts sends it once. */
    private var inFlight: String? = null

    private var power: BroadcastReceiver? = null
    private var network: ConnectivityManager.NetworkCallback? = null

    fun onlyCharging(context: Context): Boolean = prefs(context).getBoolean(ONLY_CHARGING, false)

    fun onlyWifi(context: Context): Boolean = prefs(context).getBoolean(ONLY_WIFI, false)

    fun minBattery(context: Context): Int = prefs(context).getInt(MIN_BATTERY, 0)

    fun notRoaming(context: Context): Boolean = prefs(context).getBoolean(NOT_ROAMING, false)

    fun notMetered(context: Context): Boolean = prefs(context).getBoolean(NOT_METERED, false)

    /**
     * Stores the given conditions and tells the engine at once. Keys the map
     * leaves out keep their stored value.
     */
    fun setPolicy(context: Context, values: Map<String, Any?>) {
        val edit = prefs(context).edit()
        for (key in listOf(ONLY_CHARGING, ONLY_WIFI, NOT_ROAMING, NOT_METERED)) {
            (values[key] as? Boolean)?.let { edit.putBoolean(key, it) }
        }
        (values[MIN_BATTERY] as? Number)?.let {
            // A floor above 100 would hold every run for ever.
            edit.putInt(MIN_BATTERY, it.toInt().coerceIn(0, 95))
        }
        edit.apply()
        synchronized(Device) {
            sent = null
            inFlight = null
        }
        report(context)
    }

    /**
     * Reports whether a cable, dock or wireless pad supplies power. It reads
     * the sticky broadcast rather than BatteryManager.isCharging, which
     * `dumpsys battery set ac 1` does not move on an emulator. A full battery on
     * the charger reports FULL, which counts as charging.
     */
    fun charging(context: Context): Boolean {
        val now = context.registerReceiver(null, IntentFilter(Intent.ACTION_BATTERY_CHANGED))
        if (now != null) {
            val plugged = now.getIntExtra(BatteryManager.EXTRA_PLUGGED, -1)
            if (plugged > 0) return true
            val status = now.getIntExtra(BatteryManager.EXTRA_STATUS, -1)
            if (status == BatteryManager.BATTERY_STATUS_CHARGING ||
                status == BatteryManager.BATTERY_STATUS_FULL
            ) {
                return true
            }
            if (plugged == 0 || status != -1) return false
        }
        // No broadcast yet, as in the seconds after a boot; assume charging so
        // runs go through.
        return context.getSystemService(BatteryManager::class.java)?.isCharging ?: true
    }

    /**
     * Reports whether the phone is on wifi or ethernet rather than mobile data,
     * regardless of cost. No network at all counts as not on wifi.
     */
    fun onWifi(context: Context): Boolean {
        val manager = context.getSystemService(ConnectivityManager::class.java) ?: return false
        val caps = manager.getNetworkCapabilities(manager.activeNetwork ?: return false)
            ?: return false
        return caps.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) ||
            caps.hasTransport(NetworkCapabilities.TRANSPORT_ETHERNET)
    }

    /**
     * Returns the battery level from 0 to 100, or -1 when unknown, from the
     * same sticky broadcast as `charging`. The level is scaled, since a device
     * may count in other units than percent.
     */
    fun batteryLevel(context: Context): Int {
        val now = context.registerReceiver(null, IntentFilter(Intent.ACTION_BATTERY_CHANGED))
            ?: return -1
        val level = now.getIntExtra(BatteryManager.EXTRA_LEVEL, -1)
        val scale = now.getIntExtra(BatteryManager.EXTRA_SCALE, -1)
        if (level < 0 || scale <= 0) return -1
        return level * 100 / scale
    }

    /**
     * Reports whether the phone is roaming. NET_CAPABILITY_NOT_ROAMING needs
     * API 28, and below that, or when unknown, the answer is not roaming so
     * runs are not held.
     */
    fun roaming(context: Context): Boolean {
        if (android.os.Build.VERSION.SDK_INT < 28) return false
        val manager = context.getSystemService(ConnectivityManager::class.java) ?: return false
        val caps = manager.getNetworkCapabilities(manager.activeNetwork ?: return false)
            ?: return false
        return !caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_NOT_ROAMING)
    }

    /**
     * Reports whether the connection is metered, which a wifi hotspot can be.
     * No connection at all counts as metered.
     */
    fun metered(context: Context): Boolean {
        val manager = context.getSystemService(ConnectivityManager::class.java) ?: return true
        val caps = manager.getNetworkCapabilities(manager.activeNetwork ?: return true)
            ?: return true
        return !caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_NOT_METERED)
    }

    /**
     * Returns the first condition holding automatic runs, as a sentence for the
     * engine's log, or an empty string. deviceConditions.ts checks in the same
     * order.
     */
    fun reason(context: Context): String {
        if (onlyCharging(context) && !charging(context)) {
            return "this phone is not charging"
        }
        // The floor applies only off the charger; a phone on the cable is climbing.
        val floor = minBattery(context)
        if (floor > 0 && !charging(context)) {
            val level = batteryLevel(context)
            if (level in 0 until floor) {
                return "this phone is below $floor percent"
            }
        }
        if (onlyWifi(context) && !onWifi(context)) {
            return "this phone is not on wifi"
        }
        if (notRoaming(context) && roaming(context)) {
            return "this phone is roaming"
        }
        if (notMetered(context) && metered(context)) {
            return "this connection is metered"
        }
        return ""
    }

    /**
     * Sends the verdict to the engine unless it already has it. The request
     * runs on its own thread, since this is called from broadcast receivers on
     * the main thread.
     */
    @Synchronized
    fun report(context: Context) {
        val now = reason(context)
        if (now == sent || now == inFlight) return
        // Claimed before the thread starts, since a cable going in fires
        // several broadcasts a second.
        inFlight = now
        android.util.Log.i("ArrowLoop", if (now.isEmpty()) "nothing holds automatic runs" else "holding automatic runs: $now")
        val body = """{"reason":${quote(now)}}"""
        Thread {
            try {
                val url = URL("http://${Engine.ADDRESS}/api/device")
                (url.openConnection() as HttpURLConnection).run {
                    requestMethod = "PUT"
                    doOutput = true
                    connectTimeout = 2000
                    readTimeout = 2000
                    setRequestProperty("Content-Type", "application/json")
                    outputStream.use { it.write(body.toByteArray()) }
                    if (responseCode in 200..299) sent = now
                    disconnect()
                }
            } catch (_: Exception) {
                // The engine is not up; `sent` stays unchanged so the next
                // broadcast tries again.
            } finally {
                synchronized(Device) { if (inFlight == now) inFlight = null }
            }
        }.start()
    }

    /**
     * Starts listening and reports straight away, since a phone already on
     * the charger sends no broadcast.
     */
    fun watch(context: Context) {
        if (power == null) {
            power = object : BroadcastReceiver() {
                override fun onReceive(c: Context, i: Intent) = report(context)
            }
            // ACTION_BATTERY_CHANGED cannot be declared in the manifest.
            val filter = IntentFilter().apply {
                addAction(Intent.ACTION_POWER_CONNECTED)
                addAction(Intent.ACTION_POWER_DISCONNECTED)
                addAction(Intent.ACTION_BATTERY_CHANGED)
            }
            context.registerReceiver(power, filter)
        }
        if (network == null) {
            val manager = context.getSystemService(ConnectivityManager::class.java)
            if (manager != null) {
                val callback = object : ConnectivityManager.NetworkCallback() {
                    override fun onAvailable(n: Network) = report(context)
                    override fun onLost(n: Network) = report(context)
                    override fun onCapabilitiesChanged(n: Network, c: NetworkCapabilities) =
                        report(context)
                }
                manager.registerNetworkCallback(NetworkRequest.Builder().build(), callback)
                network = callback
            }
        }
        report(context)
    }

    /** Stops listening when the service goes down. */
    fun forget(context: Context) {
        power?.let {
            try {
                context.unregisterReceiver(it)
            } catch (_: IllegalArgumentException) {
                // Already unregistered.
            }
        }
        power = null
        network?.let {
            try {
                context.getSystemService(ConnectivityManager::class.java)?.unregisterNetworkCallback(it)
            } catch (_: IllegalArgumentException) {
            }
        }
        network = null
        sent = null
        inFlight = null
    }

    private fun prefs(context: Context) =
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    /** Encodes a string as a JSON string literal. */
    private fun quote(s: String): String {
        val out = StringBuilder("\"")
        for (c in s) {
            when (c) {
                '"' -> out.append("\\\"")
                '\\' -> out.append("\\\\")
                '\n' -> out.append("\\n")
                else -> out.append(c)
            }
        }
        return out.append('"').toString()
    }
}
