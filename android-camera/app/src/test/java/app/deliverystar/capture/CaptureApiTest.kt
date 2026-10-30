package app.deliverystar.capture

import kotlinx.coroutines.async
import kotlinx.coroutines.cancelAndJoin
import kotlinx.coroutines.runBlocking
import okhttp3.OkHttpClient
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import okhttp3.mockwebserver.SocketPolicy
import org.junit.Assert.*
import org.junit.Test
import java.io.File
import java.util.concurrent.TimeUnit

class CaptureApiTest {
    @Test fun anAcknowledgementLostOnFirstUploadCanBeReconciledWithoutOverwritingEvidence() = runBlocking {
        val server = MockWebServer().apply { start() }
        val file = File.createTempFile("test-evidence", ".jpg").apply { writeText("original bytes") }
        try {
            val api = CaptureApi(server.url("/").toString().replace("localhost", "127.0.0.1"), "test-only")
            val row = Capture().apply { id = "11111111-1111-4111-8111-111111111111" }
            server.enqueue(MockResponse().setResponseCode(200).setBody("{}"))
            api.uploadEvidence(row, file)
            server.enqueue(MockResponse().setResponseCode(409).setBody("{\"error\":\"Duplicate\"}"))
            api.uploadEvidence(row, file)
            repeat(2) {
                val request = server.takeRequest()
                assertEquals("POST", request.method)
                assertNull(request.getHeader("x-upsert"))
                assertEquals("original bytes", request.body.readUtf8())
                assertTrue(request.path!!.endsWith("${row.id}.jpg"))
            }
        } finally { file.delete(); server.shutdown() }
    }

    @Test fun responseBodyStallHasABoundedDeadline() = runBlocking {
        val server = MockWebServer().apply { start() }
        try {
            server.enqueue(MockResponse().setSocketPolicy(SocketPolicy.NO_RESPONSE))
            val client = OkHttpClient.Builder().callTimeout(150, TimeUnit.MILLISECONDS).build()
            val api = CaptureApi(server.url("/").toString().replace("localhost", "127.0.0.1"), "test-only", client)
            val start = System.nanoTime()
            try { api.register(Capture()); fail("The request must time out") } catch (_: java.io.IOException) { }
            assertTrue(TimeUnit.NANOSECONDS.toSeconds(System.nanoTime() - start) < 3)
        } finally { server.shutdown() }
    }

    @Test fun invalidAuthorizationIsActionableAndServerErrorsRetry() {
        assertFalse(ApiFailure(401).retryable)
        assertFalse(ApiFailure(403).retryable)
        assertFalse(ApiFailure(400).retryable)
        assertTrue(ApiFailure(429).retryable)
        assertTrue(ApiFailure(503).retryable)
    }
}
