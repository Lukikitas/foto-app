package ar.com.starapp.fotoappcamera

import android.hardware.camera2.CameraCharacteristics
import ar.com.starapp.fotoappcamera.camera.CameraDetector
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class CameraDetectionUnitTest {

    @Test
    fun testHorizontalFovCalculation() {
        // Typical ultrawide sensor: 6.4mm width, 2.0mm focal length
        // HFOV = 2 * atan(6.4 / (2 * 2.0)) = 2 * atan(1.6) ~= 2 * 58 deg ~= 116 degrees
        val wideFov = CameraDetector.calculateHfov(sensorWidthMm = 6.4f, focalLengthMm = 2.0f)
        assertTrue("Ultrawide FOV should be > 100 degrees", wideFov > 100f)

        // Typical normal/main sensor: 6.4mm width, 4.5mm focal length
        // HFOV = 2 * atan(6.4 / (2 * 4.5)) = 2 * atan(0.711) ~= 2 * 35.4 deg ~= 70.8 degrees
        val normalFov = CameraDetector.calculateHfov(sensorWidthMm = 6.4f, focalLengthMm = 4.5f)
        assertTrue("Normal lens FOV should be between 60 and 80 degrees", normalFov in 60f..80f)

        // Typical telephoto sensor: 6.4mm width, 12.0mm focal length
        // HFOV = 2 * atan(6.4 / 24.0) ~= 30 degrees
        val teleFov = CameraDetector.calculateHfov(sensorWidthMm = 6.4f, focalLengthMm = 12.0f)
        assertTrue("Telephoto FOV should be < 50 degrees", teleFov < 50f)

        // Invalid inputs
        val zeroFov = CameraDetector.calculateHfov(sensorWidthMm = 0f, focalLengthMm = 2.0f)
        assertEquals(0f, zeroFov, 0.001f)
    }

    @Test
    fun testHardwareLevelName() {
        assertEquals("LEGACY", CameraDetector.hardwareLevelName(CameraCharacteristics.INFO_SUPPORTED_HARDWARE_LEVEL_LEGACY))
        assertEquals("LIMITED", CameraDetector.hardwareLevelName(CameraCharacteristics.INFO_SUPPORTED_HARDWARE_LEVEL_LIMITED))
        assertEquals("FULL", CameraDetector.hardwareLevelName(CameraCharacteristics.INFO_SUPPORTED_HARDWARE_LEVEL_FULL))
        assertEquals("LEVEL_3", CameraDetector.hardwareLevelName(CameraCharacteristics.INFO_SUPPORTED_HARDWARE_LEVEL_3))
        assertEquals("UNKNOWN", CameraDetector.hardwareLevelName(null))
    }

    @Test
    fun testLensLabelHeuristic() {
        // Physical lens with >= 100 deg FOV gets "0,5×"
        val wideFov = CameraDetector.calculateHfov(sensorWidthMm = 6.4f, focalLengthMm = 2.0f)
        val wideLabel = if (wideFov >= 80.0f) {
            if (wideFov >= 100.0f) "0,5×" else "Amplio"
        } else {
            "1×"
        }
        assertEquals("0,5×", wideLabel)

        // Physical lens with 85 deg FOV gets "Amplio"
        val modWideFov = CameraDetector.calculateHfov(sensorWidthMm = 5.5f, focalLengthMm = 3.0f)
        val modWideLabel = if (modWideFov >= 80.0f) {
            if (modWideFov >= 100.0f) "0,5×" else "Amplio"
        } else {
            "1×"
        }
        assertEquals("Amplio", modWideLabel)

        // Normal lens gets "1×"
        val normalFov = CameraDetector.calculateHfov(sensorWidthMm = 6.4f, focalLengthMm = 4.5f)
        val normalLabel = if (normalFov >= 80.0f) {
            if (normalFov >= 100.0f) "0,5×" else "Amplio"
        } else {
            "1×"
        }
        assertEquals("1×", normalLabel)
    }
}
