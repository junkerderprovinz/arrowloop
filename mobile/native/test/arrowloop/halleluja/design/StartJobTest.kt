package arrowloop.halleluja.design

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class StartJobTest {

    private val key = "one install"
    private val photos = "e617ca282194"

    private fun read(version: Int = StartJob.VERSION, job: String? = photos, proof: String? = job?.let { StartJob.proof(key, it) }) =
        StartJob.read(version, job, proof, key)

    @Test
    fun `a bundle the picker wrote starts its job`() {
        assertEquals(StartJob.Asked.Start(photos), read())
    }

    @Test
    fun `a bundle for every job starts every job`() {
        assertEquals(StartJob.Asked.Start(StartJob.ALL), read(job = StartJob.ALL))
    }

    @Test
    fun `a bundle from a later version of the picker is refused`() {
        assertTrue(read(version = StartJob.VERSION + 1) is StartJob.Asked.Refused)
    }

    @Test
    fun `a bundle without a version is refused`() {
        assertTrue(read(version = -1) is StartJob.Asked.Refused)
    }

    @Test
    fun `a bundle without a job is refused`() {
        assertTrue(read(job = null, proof = StartJob.proof(key, photos)) is StartJob.Asked.Refused)
    }

    @Test
    fun `a job named other than by an engine id is refused`() {
        for (job in listOf("", "Photos", "E617CA282194", "e617ca28219", "e617ca2821945", "../settings", "e617ca28219g", "all ")) {
            assertTrue(job, read(job = job, proof = StartJob.proof(key, job)) is StartJob.Asked.Refused)
        }
    }

    @Test
    fun `a bundle without a proof is refused`() {
        assertTrue(read(proof = null) is StartJob.Asked.Refused)
    }

    @Test
    fun `a proof drawn for another job is refused`() {
        assertTrue(read(proof = StartJob.proof(key, StartJob.ALL)) is StartJob.Asked.Refused)
    }

    @Test
    fun `a proof drawn with another install's key is refused`() {
        val other = "another install"
        assertTrue(read(proof = StartJob.proof(other, photos)) is StartJob.Asked.Refused)
    }

    @Test
    fun `nothing is started while the install has no key`() {
        assertTrue(StartJob.read(StartJob.VERSION, photos, StartJob.proof(key, photos), "") is StartJob.Asked.Refused)
    }

    @Test
    fun `the same choice always gets the same proof`() {
        assertEquals(StartJob.proof(key, photos), StartJob.proof(key, photos))
        assertNotEquals(StartJob.proof(key, photos), StartJob.proof(key, StartJob.ALL))
    }

    @Test
    fun `a job without an id gets the one the engine derives from its name`() {
        // internal/jobid.Legacy("Photos") and ("Fotos vom Handy").
        val jobs = StartJob.jobs(
            listOf(
                StartJob.Entry(id = null, name = "Photos", left = "/a", right = "/b", disabled = false),
                StartJob.Entry(id = "", name = "Fotos vom Handy", left = "/a", right = "/b", disabled = false),
            ),
        )
        assertEquals(listOf("e617ca282194", "60c11e72c61e"), jobs.map { it.id })
    }

    @Test
    fun `a job repeating an earlier job's id gets the one derived from its name`() {
        val jobs = StartJob.jobs(
            listOf(
                StartJob.Entry(id = "0123456789ab", name = "First", left = "/a", right = "/b", disabled = false),
                StartJob.Entry(id = "0123456789ab", name = "Photos", left = "/a", right = "/b", disabled = false),
            ),
        )
        assertEquals(listOf("0123456789ab", "e617ca282194"), jobs.map { it.id })
    }

    @Test
    fun `a draft without both sides is not offered`() {
        val jobs = StartJob.jobs(
            listOf(
                StartJob.Entry(id = "0123456789ab", name = "Draft", left = "/a", right = "", disabled = false),
                StartJob.Entry(id = "ba9876543210", name = "Ready", left = "/a", right = "/b", disabled = true),
            ),
        )
        assertEquals(listOf(StartJob.Job("ba9876543210", "Ready", paused = true)), jobs)
    }

    @Test
    fun `a job whose id the engine would not hand out is not offered`() {
        val jobs = StartJob.jobs(
            listOf(StartJob.Entry(id = "hand-written", name = "Odd", left = "/a", right = "/b", disabled = false)),
        )
        assertEquals(emptyList<StartJob.Job>(), jobs)
    }

    private val listed = listOf(
        StartJob.Listed(id = "000000000001", ready = true, paused = false, running = false),
        StartJob.Listed(id = "000000000002", ready = true, paused = true, running = false),
        StartJob.Listed(id = "000000000003", ready = false, paused = false, running = false),
        StartJob.Listed(id = "000000000004", ready = true, paused = false, running = true),
        StartJob.Listed(id = "000000000005", ready = true, paused = false, running = false),
    )

    @Test
    fun `every job starts the ready ones that are neither paused nor running`() {
        assertEquals(listOf("000000000001", "000000000005"), StartJob.toStart(StartJob.ALL, listed))
    }

    @Test
    fun `one job starts that job even while paused`() {
        assertEquals(listOf("000000000002"), StartJob.toStart("000000000002", listed))
    }

    @Test
    fun `a job that is gone starts nothing`() {
        assertEquals(emptyList<String>(), StartJob.toStart("00000000000f", listed))
    }

    @Test
    fun `a draft starts nothing`() {
        assertEquals(emptyList<String>(), StartJob.toStart("000000000003", listed))
    }
}
