package app.deliverystar.capture

import org.junit.Assert.*
import org.junit.Test

class LensGeometryTest {
    @Test fun focalLengthAndSensorSizeIdentifyAnActuallyWiderFieldOfView() {
        assertEquals(.5f, LensGeometry.relativeZoom(2f, 6f, 4f, 6f), .001f)
        // A short-focal macro camera with a small sensor is not ultra wide.
        assertEquals(1.5f, LensGeometry.relativeZoom(2f, 2f, 4f, 6f), .001f)
        assertEquals(0f, LensGeometry.relativeZoom(0f, 6f, 4f, 6f), 0f)
    }
}
