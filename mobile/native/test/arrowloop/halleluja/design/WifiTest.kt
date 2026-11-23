package arrowloop.halleluja.design

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class WifiTest {

    @Test
    fun `a name in quotes is read without them`() {
        assertEquals("Home", ssidOf("\"Home\""))
    }

    @Test
    fun `a name Android keeps back is none`() {
        assertNull(ssidOf("<unknown ssid>"))
        assertNull(ssidOf("\"\""))
        assertNull(ssidOf(""))
    }

    @Test
    fun `a name that is not text keeps its hex digits`() {
        assertEquals("c3a4ff", ssidOf("c3a4ff"))
    }

    @Test
    fun `any character of a name stays readable JSON`() {
        assertEquals("\"Caf\\\"e\\\\ \\u0009\"", quote("Caf\"e\\ \t"))
    }
}
