package ar.com.starapp.fotoappcamera

import ar.com.starapp.fotoappcamera.data.ApiHttpException
import ar.com.starapp.fotoappcamera.upload.shouldRetryUploadFailure
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.IOException

class UploadFailurePolicyUnitTest {
    @Test
    fun permanentServerRejectionsDoNotHoldNewCapturesBehindRetries() {
        for (status in listOf(400, 401, 403, 404, 409, 410, 413, 422)) {
            assertFalse("HTTP $status", shouldRetryUploadFailure(ApiHttpException(status, "rejected")))
        }
    }

    @Test
    fun temporaryServerAndNetworkFailuresRemainRetryable() {
        for (status in listOf(408, 429, 500, 502, 503)) {
            assertTrue("HTTP $status", shouldRetryUploadFailure(ApiHttpException(status, "temporary")))
        }
        assertTrue(shouldRetryUploadFailure(IOException("connection lost")))
    }
}
