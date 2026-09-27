package ar.com.starapp.fotoappcamera

import ar.com.starapp.fotoappcamera.data.SupabaseApiClient
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.net.URI

class SessionValidationUnitTest {

    @Test
    fun testSha256CalculationMatchesKnownVector() {
        // Test standard SHA-256 test vectors
        val emptyHash = SupabaseApiClient.calculateSha256("")
        assertEquals("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855", emptyHash)

        val testHash = SupabaseApiClient.calculateSha256("test-token-12345678901234567890123456789012")
        assertTrue(testHash.matches(Regex("^[0-9a-f]{64}$")))
    }

    @Test
    fun testReturnUrlValidation() {
        // Safe and allowed callback
        val validUrl = "https://delivery.star-app.com.ar/camera-return?session=550e8400-e29b-41d4-a716-446655440000"
        val validUri = URI(validUrl)

        assertTrue(validUri.scheme == "https")
        assertTrue(validUri.host == "delivery.star-app.com.ar")
        assertTrue(validUri.path == "/camera-return")

        // Malicious or invalid callbacks
        val phishingUrl = "https://evil-site.com/camera-return?session=550e8400-e29b-41d4-a716-446655440000"
        val phishingUri = URI(phishingUrl)
        assertFalse(phishingUri.host == "delivery.star-app.com.ar")

        val httpUrl = "http://delivery.star-app.com.ar/camera-return?session=550e8400-e29b-41d4-a716-446655440000"
        val httpUri = URI(httpUrl)
        assertFalse(httpUri.scheme == "https")

        val pathTraversalUrl = "https://delivery.star-app.com.ar/camera-return/../../admin"
        val pathTraversalUri = URI(pathTraversalUrl).normalize()
        assertFalse(pathTraversalUri.path == "/camera-return")
    }

    @Test
    fun testIntentUriFormat() {
        val sessionId = "d3b07384-d113-4660-9c29-373356075936"
        val customSchemeUri = URI("fotoapp://capture/$sessionId")

        assertEquals("fotoapp", customSchemeUri.scheme)
        assertEquals("capture", customSchemeUri.host)
        assertEquals("/$sessionId", customSchemeUri.path)

        val appLinkUri = URI("https://delivery.star-app.com.ar/capture/$sessionId")
        assertEquals("https", appLinkUri.scheme)
        assertEquals("delivery.star-app.com.ar", appLinkUri.host)
        assertTrue(appLinkUri.path.startsWith("/capture/"))
    }
}
