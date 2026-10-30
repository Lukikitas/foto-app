package app.deliverystar.capture

import org.junit.Assert.*
import org.junit.Test

class CaptureQualityTest {
    @Test fun darkAndFlatPhotosWarnWithoutRejectingTheirCapture() {
        assertTrue(CaptureQuality.score(IntArray(19200) { 0xFF080808.toInt() }, 160, 120, true).contains("oscura"))
        assertTrue(CaptureQuality.score(IntArray(19200) { 0xFF808080.toInt() }, 160, 120, false).contains("movida"))
        assertEquals("", CaptureQuality.score(intArrayOf(), 0, 0, true))
    }
    @Test fun detailedNonWhiteEdgesDoNotShowFalseCroppingOrBlurWarnings() {
        val pixels = IntArray(19200) { index -> if ((index / 160 + index % 160) % 2 == 0) 0xFF303030.toInt() else 0xFFB0B0B0.toInt() }
        assertEquals("", CaptureQuality.score(pixels, 160, 120, true))
    }
}
