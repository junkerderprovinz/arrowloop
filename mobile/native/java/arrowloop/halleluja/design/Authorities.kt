package arrowloop.halleluja.design

import android.content.Context
import android.util.Base64
import android.util.Log
import java.io.File
import java.security.KeyStore

/**
 * The certificate authorities somebody installed under Security in Android's
 * settings, such as the one a self-hosted server's certificate is signed with.
 * Android keeps them where only the system can read them, and the engine is a
 * Go process that sees nothing but files, so they are written out for it as
 * PEM and named in SSL_CERT_FILE. See cmd/arrowloop/android.go.
 */
object Authorities {

    private const val TAG = "ArrowLoop"

    /** AndroidCAStore lists the system's authorities as `system:` and the user's as `user:`. */
    private const val USER = "user:"

    /** The bundle the engine this process started was given. */
    @Volatile
    private var handed: String? = null

    private fun file(context: Context) = File(Engine.home(context), "user-cas.pem")

    /** The installed authorities as one PEM bundle, in a stable order so a comparison means something. */
    private fun installed(): String {
        val store = KeyStore.getInstance("AndroidCAStore").apply { load(null) }
        val pem = StringBuilder()
        for (alias in store.aliases().toList().filter { it.startsWith(USER) }.sorted()) {
            val cert = store.getCertificate(alias) ?: continue
            pem.append("-----BEGIN CERTIFICATE-----\n")
            pem.append(Base64.encodeToString(cert.encoded, Base64.DEFAULT))
            pem.append("-----END CERTIFICATE-----\n")
        }
        return pem.toString()
    }

    /**
     * Writes the bundle the engine reads and returns it. An unreadable store
     * leaves the last bundle in place and returns null.
     */
    @Synchronized
    private fun refresh(context: Context): String? {
        val bundle = try {
            installed()
        } catch (e: Exception) {
            Log.w(TAG, "could not read the installed certificate authorities: ${e.javaClass.simpleName}")
            return null
        }
        val file = file(context)
        val before = try {
            if (file.exists()) file.readText() else ""
        } catch (_: Exception) {
            ""
        }
        if (bundle == before) return bundle
        try {
            if (bundle.isEmpty()) {
                file.delete()
            } else {
                val next = File(file.parentFile, "${file.name}.new")
                next.writeText(bundle)
                // Renamed into place, so an engine starting meanwhile never reads half a bundle.
                if (!next.renameTo(file)) Log.w(TAG, "could not replace the certificate bundle")
            }
        } catch (e: Exception) {
            Log.w(TAG, "could not write the certificate bundle: ${e.javaClass.simpleName}")
            return null
        }
        return bundle
    }

    /** The variable that hands the bundle to the engine; empty while nobody installed one. */
    fun environment(context: Context): Map<String, String> {
        handed = refresh(context)
        val file = file(context)
        return if (file.exists()) mapOf("SSL_CERT_FILE" to file.absolutePath) else emptyMap()
    }

    /**
     * Reports whether an authority was installed or removed since this
     * process last started the engine, which reads them only when it starts.
     */
    fun changed(context: Context): Boolean {
        val was = handed ?: return false
        val bundle = refresh(context) ?: return false
        return bundle != was
    }
}
