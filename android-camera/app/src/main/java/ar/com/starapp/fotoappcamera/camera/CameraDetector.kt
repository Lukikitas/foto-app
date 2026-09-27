package ar.com.starapp.fotoappcamera.camera

import android.content.Context
import android.hardware.camera2.CameraCharacteristics
import android.hardware.camera2.CameraManager
import android.os.Build
import android.util.SizeF
import kotlin.math.PI
import kotlin.math.atan

object CameraDetector {

    fun calculateHfov(sensorWidthMm: Float, focalLengthMm: Float): Float {
        if (focalLengthMm <= 0f || sensorWidthMm <= 0f) return 0f
        return (2.0 * atan((sensorWidthMm / (2.0 * focalLengthMm)).toDouble()) * (180.0 / PI)).toFloat()
    }

    fun hardwareLevelName(level: Int?): String {
        return when (level) {
            CameraCharacteristics.INFO_SUPPORTED_HARDWARE_LEVEL_LEGACY -> "LEGACY"
            CameraCharacteristics.INFO_SUPPORTED_HARDWARE_LEVEL_LIMITED -> "LIMITED"
            CameraCharacteristics.INFO_SUPPORTED_HARDWARE_LEVEL_FULL -> "FULL"
            CameraCharacteristics.INFO_SUPPORTED_HARDWARE_LEVEL_3 -> "LEVEL_3"
            else -> "UNKNOWN"
        }
    }

    fun inspectCameras(context: Context): List<LogicalCameraInfo> {
        val manager = context.getSystemService(Context.CAMERA_SERVICE) as? CameraManager ?: return emptyList()
        val result = mutableListOf<LogicalCameraInfo>()

        for (id in manager.cameraIdList) {
            try {
                val chars = manager.getCameraCharacteristics(id)
                val facing = chars.get(CameraCharacteristics.LENS_FACING) ?: continue

                // Hardware level
                val hwLevel = hardwareLevelName(chars.get(CameraCharacteristics.INFO_SUPPORTED_HARDWARE_LEVEL))

                // Zoom range
                var minZoom = 1.0f
                var maxZoom = 4.0f
                var hasSubOne = false

                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                    val zoomRange = chars.get(CameraCharacteristics.CONTROL_ZOOM_RATIO_RANGE)
                    if (zoomRange != null) {
                        minZoom = zoomRange.lower
                        maxZoom = zoomRange.upper
                        hasSubOne = minZoom < 0.99f
                    }
                }

                // Physical cameras
                val physicalLenses = mutableListOf<PhysicalLensInfo>()
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
                    val physicalIds = chars.physicalCameraIds
                    for (physId in physicalIds) {
                        try {
                            val physChars = manager.getCameraCharacteristics(physId)
                            val focals = physChars.get(CameraCharacteristics.LENS_INFO_AVAILABLE_FOCAL_LENGTHS)
                            val sensorSize = physChars.get(CameraCharacteristics.SENSOR_INFO_PHYSICAL_SIZE) ?: SizeF(4.0f, 3.0f)
                            val focal = focals?.firstOrNull() ?: 4.0f

                            val hfov = calculateHfov(sensorSize.width, focal)
                            // Ultrawide is typically considered when HFOV > 80 degrees
                            val isUltrawide = hfov >= 80.0f

                            val label = if (isUltrawide) {
                                if (hfov >= 100.0f) "0,5×" else "Amplio"
                            } else {
                                "1×"
                            }

                            physicalLenses.add(
                                PhysicalLensInfo(
                                    id = physId,
                                    focalLength = focal,
                                    sensorWidthMm = sensorSize.width,
                                    sensorHeightMm = sensorSize.height,
                                    hfovDegrees = hfov,
                                    isUltrawide = isUltrawide,
                                    displayLabel = label
                                )
                            )
                        } catch (_: Exception) {
                            // Ignore physical camera read failure
                        }
                    }
                }

                val bestWide = physicalLenses.filter { it.isUltrawide }.maxByOrNull { it.hfovDegrees }?.id
                val bestNormal = physicalLenses.filter { !it.isUltrawide }.minByOrNull { it.hfovDegrees }?.id

                result.add(
                    LogicalCameraInfo(
                        cameraId = id,
                        facing = facing,
                        minZoomRatio = minZoom,
                        maxZoomRatio = maxZoom,
                        supportsSubOneZoom = hasSubOne,
                        physicalLenses = physicalLenses,
                        hardwareLevel = hwLevel,
                        bestWidePhysicalId = bestWide,
                        bestNormalPhysicalId = bestNormal
                    )
                )
            } catch (_: Exception) {
                // Ignore camera inspection failure
            }
        }

        return result
    }

    fun buildDiagnosticReport(
        context: Context,
        appVersion: String,
        selectedLensMode: LensMode,
        activeZoomRatio: Float
    ): CameraDiagnosticReport {
        val cameras = inspectCameras(context)
        val backCamera = cameras.firstOrNull { it.facing == CameraCharacteristics.LENS_FACING_BACK }

        val hasSubOne = backCamera?.supportsSubOneZoom == true
        val hasPhysicalWide = backCamera?.physicalLenses?.any { it.isUltrawide } == true

        val ultrawideAvailable = hasSubOne || hasPhysicalWide
        val ultrawideType = when {
            hasSubOne -> "sub_one_zoom"
            hasPhysicalWide -> "physical_camera"
            else -> "not_available"
        }

        return CameraDiagnosticReport(
            deviceModel = "${Build.MANUFACTURER} ${Build.MODEL} (${Build.DEVICE})",
            androidVersion = "Android ${Build.VERSION.RELEASE} (API ${Build.VERSION.SDK_INT})",
            appVersion = appVersion,
            cameras = cameras,
            selectedLensMode = selectedLensMode,
            activeZoomRatio = activeZoomRatio,
            ultrawideAvailable = ultrawideAvailable,
            ultrawideType = ultrawideType
        )
    }
}
