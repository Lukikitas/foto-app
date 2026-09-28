package ar.com.starapp.fotoappcamera

import ar.com.starapp.fotoappcamera.data.NativeCaptureSession
import ar.com.starapp.fotoappcamera.viewmodel.captureBlockReason
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class SessionCapturePolicyUnitTest {
    @Test
    fun activeSessionCanCaptureOnlyBeforeItsFixedDeadline() {
        assertNull(captureBlockReason(NativeCaptureSession.STATE_ACTIVE, 10_000L, 9_999L))
        assertTrue(captureBlockReason(NativeCaptureSession.STATE_ACTIVE, 10_000L, 10_000L)!!.contains("venció"))
    }

    @Test
    fun finishingSessionCannotStartAnotherPair() {
        assertTrue(captureBlockReason(NativeCaptureSession.STATE_FINISHING, 10_000L, 9_000L)!!.contains("terminó"))
    }
}
