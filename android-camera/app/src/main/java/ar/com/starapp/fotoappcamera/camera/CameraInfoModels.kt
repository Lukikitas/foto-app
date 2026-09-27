package ar.com.starapp.fotoappcamera.camera

import android.hardware.camera2.CameraCharacteristics

data class PhysicalLensInfo(
    val id: String,
    val focalLength: Float,
    val sensorWidthMm: Float,
    val sensorHeightMm: Float,
    val hfovDegrees: Float,
    val isUltrawide: Boolean,
    val displayLabel: String
)

data class LogicalCameraInfo(
    val cameraId: String,
    val facing: Int, // CameraCharacteristics.LENS_FACING_BACK, etc.
    val minZoomRatio: Float,
    val maxZoomRatio: Float,
    val supportsSubOneZoom: Boolean,
    val physicalLenses: List<PhysicalLensInfo>,
    val hardwareLevel: String,
    val bestWidePhysicalId: String? = null,
    val bestNormalPhysicalId: String? = null
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
    val ultrawideType: String // "sub_one_zoom", "physical_camera", "not_available"
) {
    fun toFormattedString(): String {
        val sb = StringBuilder()
        sb.appendLine("=== DIAGNÓSTICO TÉCNICO DE CÁMARA ===")
        sb.appendLine("Dispositivo: $deviceModel")
        sb.appendLine("Android: $androidVersion")
        sb.appendLine("Versión App: $appVersion")
        sb.appendLine("Gran angular disponible: $ultrawideAvailable ($ultrawideType)")
        sb.appendLine("Modo activo: $selectedLensMode (${"%.2f".format(activeZoomRatio)}×)")
        sb.appendLine("--- Cámaras Detectadas ---")
        cameras.forEach { cam ->
            val facing = when (cam.facing) {
                CameraCharacteristics.LENS_FACING_BACK -> "Trasera"
                CameraCharacteristics.LENS_FACING_FRONT -> "Frontal"
                else -> "Externa"
            }
            sb.appendLine("Cámara ${cam.cameraId} ($facing, Nivel: ${cam.hardwareLevel}):")
            sb.appendLine("  Rango zoom: ${"%.2f".format(cam.minZoomRatio)}× - ${"%.2f".format(cam.maxZoomRatio)}×")
            sb.appendLine("  Sub-1× nativo: ${if (cam.supportsSubOneZoom) "SÍ" else "NO"}")
            if (cam.physicalLenses.isNotEmpty()) {
                sb.appendLine("  Lentes físicos:")
                cam.physicalLenses.forEach { lens ->
                    sb.appendLine("    [${lens.id}] ${lens.displayLabel} - Focal: ${lens.focalLength}mm, Sensor: ${lens.sensorWidthMm}x${lens.sensorHeightMm}mm, HFOV: ${"%.1f".format(lens.hfovDegrees)}°")
                }
            }
        }
        return sb.toString()
    }
}
