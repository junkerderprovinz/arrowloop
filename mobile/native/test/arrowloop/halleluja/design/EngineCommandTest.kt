package arrowloop.halleluja.design

import org.junit.Assert.assertEquals
import org.junit.Test

class EngineCommandTest {

    @Test
    fun `an engine the screens start runs the jobs set to run at start`() {
        assertEquals(listOf("/e", "web", "-config", "/c.json"), engineCommand("/e", "/c.json", forScreens = true))
    }

    @Test
    fun `an engine a wake-up starts leaves them to the wake-up`() {
        assertEquals(
            listOf("/e", "web", "-config", "/c.json", "-no-start-runs"),
            engineCommand("/e", "/c.json", forScreens = false),
        )
    }
}
