package arrowloop.halleluja.design

import java.security.MessageDigest
import javax.crypto.Mac
import javax.crypto.spec.SecretKeySpec

/**
 * The one thing an automation app such as Tasker or MacroDroid may ask of
 * ArrowLoop through the Locale plug-in API: start a job, or all of them. Every
 * app on the phone can send the broadcast, so the bundle the automation app
 * keeps carries a proof drawn with a key only this install holds. Another app
 * can then at most repeat a choice somebody made in StartJobActivity, never
 * name a job of its own.
 */
object StartJob {

    /** Raised whenever the bundle changes shape, so an old one is refused rather than misread. */
    const val VERSION = 1

    /** What the bundle names in place of a job id to start every job. */
    const val ALL = "all"

    // Outside com.twofortyfouram, which the plug-in API keeps for itself.
    const val KEY_VERSION = "arrowloop.halleluja.design.extra.VERSION"
    const val KEY_JOB = "arrowloop.halleluja.design.extra.JOB"
    const val KEY_PROOF = "arrowloop.halleluja.design.extra.PROOF"

    /** What internal/jobid hands out: six bytes as lower-case hex. */
    private val ID = Regex("[0-9a-f]{12}")

    sealed interface Asked {
        data class Start(val job: String) : Asked
        data class Refused(val why: String) : Asked
    }

    /** A job as the configuration file has it. */
    data class Entry(val id: String?, val name: String, val left: String, val right: String, val disabled: Boolean)

    /** A job the picker offers. */
    data class Job(val id: String, val name: String, val paused: Boolean)

    /** A job as the running engine lists it. */
    data class Listed(val id: String, val ready: Boolean, val paused: Boolean, val running: Boolean)

    /** The proof for a choice: HMAC-SHA256 over the version and the job, as hex. */
    fun proof(key: String, job: String): String {
        val mac = Mac.getInstance("HmacSHA256")
        mac.init(SecretKeySpec(key.toByteArray(), "HmacSHA256"))
        return mac.doFinal("$VERSION:$job".toByteArray()).joinToString("") { "%02x".format(it) }
    }

    /**
     * Reads what a bundle asks for. The values come from another app, so each
     * has to be exactly what StartJobActivity writes. A version of -1 means the
     * bundle had none.
     */
    fun read(version: Int, job: String?, proof: String?, key: String): Asked = when {
        version != VERSION -> Asked.Refused("the bundle is of version $version, this app reads $VERSION")
        job == null -> Asked.Refused("the bundle names no job")
        job != ALL && !ID.matches(job) -> Asked.Refused("the bundle names no job id")
        proof == null -> Asked.Refused("the bundle carries no proof")
        // Before the comparison, since an empty key would make every proof
        // somebody could compute valid.
        key.isEmpty() -> Asked.Refused("this install has no key yet")
        !MessageDigest.isEqual(proof.toByteArray(), proof(key, job).toByteArray()) ->
            Asked.Refused("the proof is not this install's, as after the app's data was cleared")
        else -> Asked.Start(job)
    }

    /**
     * The jobs the picker offers, with the ids the engine gives them: a job
     * without one, or with one an earlier job took, gets the id derived from
     * its name, as giveIDs in internal/job does. A draft without both sides
     * cannot run and is left out.
     */
    fun jobs(entries: List<Entry>): List<Job> {
        val taken = HashSet<String>()
        val out = ArrayList<Job>()
        for (e in entries) {
            val id = if (e.id.isNullOrEmpty() || e.id in taken) legacyId(e.name) else e.id
            taken += id
            if (e.left.isEmpty() || e.right.isEmpty() || !ID.matches(id)) continue
            out += Job(id, e.name, e.disabled)
        }
        return out
    }

    /** internal/jobid.Legacy: the first six bytes of SHA-256 over "job:" and the name. */
    private fun legacyId(name: String): String =
        MessageDigest.getInstance("SHA-256").digest("job:$name".toByteArray())
            .take(6).joinToString("") { "%02x".format(it) }

    /**
     * The ids to start. All of them means what Run all on the screens starts:
     * every job with both sides that is neither paused nor running. One job
     * starts even while paused, as Run now does.
     */
    fun toStart(job: String, listed: List<Listed>): List<String> =
        if (job == ALL) {
            listed.filter { it.ready && !it.paused && !it.running }.map { it.id }
        } else {
            listed.filter { it.id == job && it.ready }.map { it.id }
        }
}
