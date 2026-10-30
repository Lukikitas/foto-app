package app.deliverystar.capture

import android.content.Context
import android.hardware.camera2.CameraCharacteristics
import android.hardware.camera2.CameraManager
import android.os.Build
import androidx.camera.camera2.interop.Camera2CameraInfo
import androidx.camera.camera2.interop.ExperimentalCamera2Interop
import androidx.camera.core.CameraInfo
import androidx.camera.core.CameraSelector
import org.json.JSONArray
import org.json.JSONObject

data class CameraLensOption(val key: String, val info: CameraInfo, val physicalId: String?,
    val ratio: Float, val label: String)

@androidx.annotation.OptIn(markerClass = [ExperimentalCamera2Interop::class])
object CameraLenses {
    private data class Optics(val focal: Float, val span: Float)
    private fun optics(chars: CameraCharacteristics): Optics {
        val sensor = chars.get(CameraCharacteristics.SENSOR_INFO_PHYSICAL_SIZE)
        val active = chars.get(CameraCharacteristics.SENSOR_INFO_ACTIVE_ARRAY_SIZE)
        val pixels = chars.get(CameraCharacteristics.SENSOR_INFO_PIXEL_ARRAY_SIZE)
        return Optics(LensGeometry.defaultFocal(chars.get(CameraCharacteristics.LENS_INFO_AVAILABLE_FOCAL_LENGTHS)),
            LensGeometry.effectiveSensorSpan(sensor?.width ?: 0f, sensor?.height ?: 0f,
                chars.get(CameraCharacteristics.SENSOR_ORIENTATION) ?: 0,
                active?.width() ?: 0, active?.height() ?: 0, pixels?.width ?: 0, pixels?.height ?: 0))
    }

    fun discover(context: Context, available: List<CameraInfo>): List<CameraLensOption> {
        val manager = context.getSystemService(CameraManager::class.java)
        val rear = available.filter { runCatching { it.lensFacing == CameraSelector.LENS_FACING_BACK }.getOrDefault(false) }
        check(rear.isNotEmpty())
        val normal = CameraSelector.DEFAULT_BACK_CAMERA.filter(rear).first()
        val normalId = Camera2CameraInfo.from(normal).cameraId
        val baseline = runCatching { optics(manager.getCameraCharacteristics(normalId)) }.getOrDefault(Optics(0f, 0f))
        val result = mutableListOf(CameraLensOption(normalId, normal, null, 1f, "Principal · 1×"))
        val inventory = JSONArray()
        val standaloneIds = rear.mapNotNull { runCatching { Camera2CameraInfo.from(it).cameraId }.getOrNull() }.toSet()
        val platformRear = runCatching { manager.cameraIdList.toList() }.getOrDefault(emptyList()).mapNotNull { id ->
            runCatching { manager.getCameraCharacteristics(id) }.getOrNull()?.let { chars ->
                if (runCatching { chars.get(CameraCharacteristics.LENS_FACING) }.getOrNull() == CameraCharacteristics.LENS_FACING_BACK) id to chars else null
            }
        }
        platformRear.forEachIndexed { index, (id, chars) ->
            val data = runCatching { optics(chars) }.getOrDefault(Optics(0f, 0f))
            inventory.put(JSONObject().put("camera", index).put("kind", "platform").put("cameraX", id in standaloneIds)
                .put("focal", data.focal).put("span", data.span)
                .put("resolvedZoom", LensGeometry.relativeZoom(data.focal, data.span, baseline.focal, baseline.span)))
        }
        // Inspect each route independently: a bad/missing child must not hide
        // the rest, including physical cameras belonging to another logical ID.
        rear.forEachIndexed { parentIndex, info ->
            val id = runCatching { Camera2CameraInfo.from(info).cameraId }.getOrNull() ?: return@forEachIndexed
            val chars = runCatching { manager.getCameraCharacteristics(id) }.getOrNull()
            val metadata = chars?.let { runCatching { optics(it) }.getOrNull() } ?: Optics(0f, 0f)
            val reported = runCatching { info.intrinsicZoomRatio }.getOrDefault(0f)
            val ratio = if (info == normal) 1f else LensGeometry.resolvedZoom(reported, metadata.focal, metadata.span, baseline.focal, baseline.span)
            inventory.put(JSONObject().put("parent", parentIndex).put("kind", "standalone")
                .put("focal", metadata.focal).put("span", metadata.span).put("reportedZoom", reported).put("resolvedZoom", ratio))
            if (info != normal) result.add(CameraLensOption(id, info, null, ratio, label(ratio, result.size)))
            if (Build.VERSION.SDK_INT >= 28 && chars != null) {
                val physicalIds = runCatching { chars.physicalCameraIds }.getOrDefault(emptySet())
                physicalIds.forEachIndexed physical@{ childIndex, physical ->
                    val child = runCatching { manager.getCameraCharacteristics(physical) }.getOrNull() ?: return@physical
                    val facing = runCatching { child.get(CameraCharacteristics.LENS_FACING) }.getOrNull()
                    if (facing != null && facing != CameraCharacteristics.LENS_FACING_BACK) return@physical
                    val data = runCatching { optics(child) }.getOrDefault(Optics(0f, 0f))
                    val relative = LensGeometry.relativeZoom(data.focal, data.span, baseline.focal, baseline.span)
                    inventory.put(JSONObject().put("parent", parentIndex).put("child", childIndex).put("kind", "physical")
                        .put("focal", data.focal).put("span", data.span).put("resolvedZoom", relative))
                    // Already selectable directly, or a physical copy of the
                    // principal lens: don't show duplicate choices to the user.
                    if (physical in standaloneIds || relative in .95f..1.05f) return@physical
                    val key = "$id/$physical"
                    result.add(CameraLensOption(key, info, physical, relative, label(relative, result.size)))
                }
            }
        }
        // Technical optics only, never camera IDs (which can contain vendor
        // identifiers), pictures, authors, order codes or captured text.
        val snapshot = JSONObject().put("rearLogicalCount", rear.size).put("rearPlatformCount", platformRear.size).put("choices", result.size)
            .put("lenses", JSONArray((0 until minOf(24, inventory.length())).map { inventory.get(it) }))
        context.getSharedPreferences("diagnostics", Context.MODE_PRIVATE).edit().putString("cameras", snapshot.toString()).apply()
        return result
    }

    private fun label(ratio: Float, index: Int): String = if (ratio in .1f.. .94f)
        "Gran angular · %.1f×".format(java.util.Locale.US, ratio)
        else "Trasera ${index + 1}" + if (ratio > 0f && ratio !in .95f..1.05f) " · %.1f×".format(java.util.Locale.US, ratio) else ""
}
