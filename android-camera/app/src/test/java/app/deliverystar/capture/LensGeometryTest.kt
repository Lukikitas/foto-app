package app.deliverystar.capture

import org.junit.Assert.*
import org.junit.Test

class LensGeometryTest {
    @Test fun logicalCameraUsesDefaultFocalInsteadOfMistakingTheShortestLensForMain() {
        val normal = LensGeometry.defaultFocal(floatArrayOf(4f, 2f))
        assertEquals(4f, normal, 0f)
        assertEquals(.5f, LensGeometry.relativeZoom(2f, 6f, normal, 6f), .001f)
        assertEquals(0f, LensGeometry.defaultFocal(null), 0f)
    }
    @Test fun missingReportedZoomDoesNotHideAnOpticallyWiderCamera() {
        assertEquals(.5f, LensGeometry.resolvedZoom(1f, 2f, 6f, 4f, 6f), .001f)
        assertEquals(.6f, LensGeometry.resolvedZoom(.6f, 0f, 0f, 4f, 6f), .001f)
        assertEquals(0f, LensGeometry.resolvedZoom(-1f, 0f, 0f, 4f, 6f), 0f)
    }
    @Test fun sensorOrientationAndActiveAreaAreIncludedWithoutRequiringMissingMetadata() {
        assertEquals(3f, LensGeometry.effectiveSensorSpan(6f, 4f, 90, 3000, 1500, 4000, 2000), .001f)
        assertEquals(4.5f, LensGeometry.effectiveSensorSpan(6f, 4f, 0, 3000, 1500, 4000, 2000), .001f)
        assertEquals(4f, LensGeometry.effectiveSensorSpan(6f, 4f, 270, 0, 0, 0, 0), .001f)
    }
    @Test fun focalLengthAndSensorSizeIdentifyAnActuallyWiderFieldOfView() {
        assertEquals(.5f, LensGeometry.relativeZoom(2f, 6f, 4f, 6f), .001f)
        // A short-focal macro camera with a small sensor is not ultra wide.
        assertEquals(1.5f, LensGeometry.relativeZoom(2f, 2f, 4f, 6f), .001f)
        assertEquals(0f, LensGeometry.relativeZoom(0f, 6f, 4f, 6f), 0f)
    }
}
