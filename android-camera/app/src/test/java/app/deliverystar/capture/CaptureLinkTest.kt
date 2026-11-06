package app.deliverystar.capture

import org.junit.Assert.*
import org.junit.Test

class CaptureLinkTest {
    @Test fun webAuthorIsPlainBoundedText() {
        assertEquals("", CaptureLink.normalizeAuthor(null))
        assertEquals("María López", CaptureLink.normalizeAuthor("  María\n\tLópez\u0000  "))
        assertEquals(80, CaptureLink.normalizeAuthor("a".repeat(200)).length)
    }
    @Test fun onlyTheCaptureNavigationRouteIsAccepted() {
        val view = "android.intent.action.VIEW"
        assertTrue(CaptureLink.matches(view, "deliverystar://capture"))
        assertTrue(CaptureLink.matches(view, "deliverystar://capture/"))
        for (uri in listOf(null, "", "deliverystar://capture?author=other", "deliverystar://capture#command", "deliverystar://capture/delete", "deliverystar://user@capture", "deliverystar://capture:80", "deliverystar://other", "https://capture", "deliverystar://capture%00", "deliverystar://capture/" + "x".repeat(300))) {
            assertFalse("Unexpected route: $uri", CaptureLink.matches(view, uri))
        }
        assertFalse(CaptureLink.matches(null, "deliverystar://capture"))
        assertFalse(CaptureLink.matches("android.intent.action.SEND", "deliverystar://capture"))
    }
}
