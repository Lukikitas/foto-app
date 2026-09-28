package ar.com.starapp.fotoappcamera.camera

import android.hardware.camera2.CameraCharacteristics
import android.util.SizeF

data class PhysicalLensInfo(
    val id: String,
    val focalLengths: List<Float> = emptyList(),
    val sensorWidthMm: Float? = null,
    val sensorHeightMm: Float? = null,
    val hfovDegrees: Float? = null,
    val hasValidMetadata: Boolean = true,
    val isUltrawide: Boolean = false,
    val displayLabel: String = "1×",
    val errorNote: String? = null
) {
    // Backwards compatibility property for existing unit tests
    val focalLength: Float
        get() = focalLengths.firstOrNull() ?: 0f
}

data class LogicalCameraInfo(
    val cameraId: String,
    val facing: Int, // CameraCharacteristics.LENS_FACING_BACK, etc.
    val minZoomRatio: Float,
    val maxZoomRatio: Float,
    val supportsSubOneZoom: Boolean,
    val isLogicalMultiCamera: Boolean = false,
    val availableCapabilities: List<String> = emptyList(),
    val availableFocalLengths: List<Float> = emptyList(),
    val physicalSensorSizeMm: SizeF? = null,
    val physicalLenses: List<PhysicalLensInfo> = emptyList(),
    val hardwareLevel: String,
    val bestWidePhysicalId: String? = null,
    val bestNormalPhysicalId: String? = null,
    val inspectionErrors: List<String> = emptyList()
)

enum class LensMode {
    NORMAL,
    WIDE
}

data class CameraDiagnosticReport(
    val deviceModel: String,
    val androidVersion: String,
    val appVersion: String,
    val cameras: List<LogicalCameraInfo>,
    val selectedLensMode: LensMode,
    val activeZoomRatio: Float,
    val ultrawideAvailable: Boolean,
    val ultrawideType: String, // "sub_one_zoom", "physical_camera", "not_available"
    val ultrawideExplanation: String = "",
    val inspectionWarnings: List<String> = emptyList()
) {
    fun toFormattedString(): String {
        val sb = StringBuilder()
        sb.appendLine("=== DIAGNÓSTICO TÉCNICO DE CÁMARA ===")
        sb.appendLine("Dispositivo: $deviceModel")
        sb.appendLine("Android: $androidVersion")
        sb.appendLine("Versión App: $appVersion")
        sb.appendLine("Gran angular disponible: $ultrawideAvailable ($ultrawideType)")
        if (ultrawideExplanation.isNotBlank()) {
            sb.appendLine("Detalle de disponibilidad: $ultrawideExplanation")
        }
        sb.appendLine("Modo activo: $selectedLensMode (${"%.2f".format(activeZoomRatio)}×)")
        if (inspectionWarnings.isNotEmpty()) {
            sb.appendLine("--- Advertencias de inspección ---")
            inspectionWarnings.forEach { sb.appendLine("  ⚠️ $it") }
        }
        sb.appendLine("--- Cámaras Detectadas ---")
        cameras.forEach { cam ->
            val facing = when (cam.facing) {
                CameraCharacteristics.LENS_FACING_BACK -> "Trasera"
                CameraCharacteristics.LENS_FACING_FRONT -> "Frontal"
                else -> "Externa"
            }
            sb.appendLine("Cámara ${cam.cameraId} ($facing, Nivel: ${cam.hardwareLevel}):")
            sb.appendLine("  Multicámara lógica: ${if (cam.isLogicalMultiCamera) "SÍ" else "NO"}")
            sb.appendLine("  Rango zoom: ${"%.2f".format(cam.minZoomRatio)}× - ${"%.2f".format(cam.maxZoomRatio)}×")
            sb.appendLine("  Sub-1× nativo: ${if (cam.supportsSubOneZoom) "SÍ" else "NO"}")
            if (cam.availableFocalLengths.isNotEmpty()) {
                sb.appendLine("  Distancias focales: ${cam.availableFocalLengths.joinToString(", ")} mm")
            }
            if (cam.physicalSensorSizeMm != null) {
                sb.appendLine("  Sensor físico: ${cam.physicalSensorSizeMm.width} x ${cam.physicalSensorSizeMm.height} mm")
            }
            if (cam.physicalLenses.isNotEmpty()) {
                sb.appendLine("  Lentes físicos:")
                cam.physicalLenses.forEach { lens ->
                    val hfovStr = lens.hfovDegrees?.let { "${"%.1f".format(it)}°" } ?: "Desconocido"
                    val sensorStr = if (lens.sensorWidthMm != null && lens.sensorHeightMm != null) {
                        "${lens.sensorWidthMm}x${lens.sensorHeightMm}mm"
                    } else "Sin metadatos"
                    sb.appendLine("    [${lens.id}] ${lens.displayLabel} - Focales: ${lens.focalLengths.joinToString(", ")}mm, Sensor: $sensorStr, HFOV: $hfovStr")
                    if (lens.errorNote != null) {
                        sb.appendLine("      Nota: ${lens.errorNote}")
                    }
                }
            }
            if (cam.inspectionErrors.isNotEmpty()) {
                cam.inspectionErrors.forEach { sb.appendLine("  ⚠️ Error de cámara: $it") }
            }
        }
        return sb.toString()
    }
}
