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
            val cameraErrors = mutableListOf<String>()
            try {
                val chars = manager.getCameraCharacteristics(id)
                val facing = chars.get(CameraCharacteristics.LENS_FACING) ?: continue

                // Hardware level
                val hwLevel = hardwareLevelName(chars.get(CameraCharacteristics.INFO_SUPPORTED_HARDWARE_LEVEL))

                // Capabilities & Multicamera support
                val caps = chars.get(CameraCharacteristics.REQUEST_AVAILABLE_CAPABILITIES) ?: intArrayOf()
                val isMultiCamera = caps.contains(CameraCharacteristics.REQUEST_AVAILABLE_CAPABILITIES_LOGICAL_MULTI_CAMERA)
                val capNames = caps.map { cap ->
                    when (cap) {
                        CameraCharacteristics.REQUEST_AVAILABLE_CAPABILITIES_LOGICAL_MULTI_CAMERA -> "LOGICAL_MULTI_CAMERA"
                        CameraCharacteristics.REQUEST_AVAILABLE_CAPABILITIES_BACKWARD_COMPATIBLE -> "BACKWARD_COMPATIBLE"
                        CameraCharacteristics.REQUEST_AVAILABLE_CAPABILITIES_RAW -> "RAW"
                        else -> "CAP_$cap"
                    }
                }

                // Logical focal lengths & sensor size
                val logicalFocals = chars.get(CameraCharacteristics.LENS_INFO_AVAILABLE_FOCAL_LENGTHS)?.toList() ?: emptyList()
                val logicalSensorSize = chars.get(CameraCharacteristics.SENSOR_INFO_PHYSICAL_SIZE)

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
                            val focals = physChars.get(CameraCharacteristics.LENS_INFO_AVAILABLE_FOCAL_LENGTHS)?.toList() ?: emptyList()
                            val sensorSize = physChars.get(CameraCharacteristics.SENSOR_INFO_PHYSICAL_SIZE)

                            // Do NOT invent dimensions if metadata is missing!
                            if (sensorSize == null || focals.isEmpty() || focals.first() <= 0f || sensorSize.width <= 0f) {
                                physicalLenses.add(
                                    PhysicalLensInfo(
                                        id = physId,
                                        focalLengths = focals,
                                        sensorWidthMm = sensorSize?.width,
                                        sensorHeightMm = sensorSize?.height,
                                        hfovDegrees = null,
                                        hasValidMetadata = false,
                                        isUltrawide = false,
                                        displayLabel = "Sin metadatos",
                                        errorNote = "Metadatos incompletos de hardware (sensorSize o focal ausente)"
                                    )
                                )
                                continue
                            }

                            val focal = focals.first()
                            val hfov = calculateHfov(sensorSize.width, focal)
                            val isUltrawide = hfov >= 80.0f
                            val label = if (isUltrawide) {
                                if (hfov >= 100.0f) "0,5×" else "Amplio"
                            } else {
                                "1×"
                            }

                            physicalLenses.add(
                                PhysicalLensInfo(
                                    id = physId,
                                    focalLengths = focals,
                                    sensorWidthMm = sensorSize.width,
                                    sensorHeightMm = sensorSize.height,
                                    hfovDegrees = hfov,
                                    hasValidMetadata = true,
                                    isUltrawide = isUltrawide,
                                    displayLabel = label
                                )
                            )
                        } catch (e: Exception) {
                            cameraErrors.add("Error al examinar lente físico $physId: ${e.message}")
                            physicalLenses.add(
                                PhysicalLensInfo(
                                    id = physId,
                                    focalLengths = emptyList(),
                                    sensorWidthMm = null,
                                    sensorHeightMm = null,
                                    hfovDegrees = null,
                                    hasValidMetadata = false,
                                    isUltrawide = false,
                                    displayLabel = "Error",
                                    errorNote = "Excepción: ${e.message}"
                                )
                            )
                        }
                    }
                }

                val bestWide = physicalLenses.filter { it.isUltrawide && it.hfovDegrees != null }
                    .maxByOrNull { it.hfovDegrees!! }?.id
                val bestNormal = physicalLenses.filter { !it.isUltrawide && it.hfovDegrees != null }
                    .minByOrNull { it.hfovDegrees!! }?.id

                result.add(
                    LogicalCameraInfo(
                        cameraId = id,
                        facing = facing,
                        minZoomRatio = minZoom,
                        maxZoomRatio = maxZoom,
                        supportsSubOneZoom = hasSubOne,
                        isLogicalMultiCamera = isMultiCamera,
                        availableCapabilities = capNames,
                        availableFocalLengths = logicalFocals,
                        physicalSensorSizeMm = logicalSensorSize,
                        physicalLenses = physicalLenses,
                        hardwareLevel = hwLevel,
                        bestWidePhysicalId = bestWide,
                        bestNormalPhysicalId = bestNormal,
                        inspectionErrors = cameraErrors
                    )
                )
            } catch (e: Exception) {
                cameraErrors.add("Error al inspeccionar cámara lógica $id: ${e.message}")
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

        val isXiaomiOrPoco = Build.MANUFACTURER.equals("Xiaomi", ignoreCase = true) ||
            Build.MANUFACTURER.equals("POCO", ignoreCase = true) ||
            Build.MODEL.contains("2311DRK48G", ignoreCase = true)

        val ultrawideAvailable = hasSubOne || hasPhysicalWide
        val ultrawideType = when {
            hasSubOne -> "sub_one_zoom"
            hasPhysicalWide -> "physical_camera"
            else -> "not_available"
        }

        val ultrawideExplanation = when {
            hasSubOne -> "Lente gran angular accesible por rango de zoom óptico sub-1× (${backCamera?.minZoomRatio}×)."
            hasPhysicalWide -> "Lente gran angular accesible por sensor físico independiente (ID: ${backCamera?.bestWidePhysicalId})."
            isXiaomiOrPoco -> "HyperOS / Xiaomi no expone el sensor ultra gran angular a aplicaciones de terceros a través de APIs públicas de Camera2 (zoom mín: ${backCamera?.minZoomRatio ?: 1.0f}×, sin lente físico <1× reportado). Opción 0,5× deshabilitada sin simular zoom digital."
            else -> "Este dispositivo no expone sensor ultra gran angular ni zoom sub-1× a través de Camera2."
        }

        val allWarnings = mutableListOf<String>()
        cameras.forEach { cam ->
            allWarnings.addAll(cam.inspectionErrors)
            cam.physicalLenses.forEach { lens ->
                lens.errorNote?.let { allWarnings.add("Lente físico [${lens.id}]: $it") }
            }
        }

        return CameraDiagnosticReport(
            deviceModel = "${Build.MANUFACTURER} ${Build.MODEL} (${Build.DEVICE})",
            androidVersion = "Android ${Build.VERSION.RELEASE} (API ${Build.VERSION.SDK_INT})",
            appVersion = appVersion,
            cameras = cameras,
            selectedLensMode = selectedLensMode,
            activeZoomRatio = activeZoomRatio,
            ultrawideAvailable = ultrawideAvailable,
            ultrawideType = ultrawideType,
            ultrawideExplanation = ultrawideExplanation,
            inspectionWarnings = allWarnings
        )
    }
}
