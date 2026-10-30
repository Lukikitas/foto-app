package app.deliverystar.capture

import android.content.Context
import android.hardware.camera2.CameraCharacteristics
import android.os.Build
import androidx.camera.camera2.interop.Camera2CameraInfo
import androidx.camera.camera2.interop.Camera2Interop
import androidx.camera.camera2.interop.ExperimentalCamera2Interop
import android.util.Size
import android.view.ScaleGestureDetector
import android.view.MotionEvent
import androidx.camera.core.Camera
import androidx.camera.core.CameraInfo
import androidx.camera.core.TorchState
import androidx.camera.core.CameraSelector
import androidx.camera.core.FocusMeteringAction
import androidx.camera.core.ImageCapture
import androidx.camera.core.ImageCaptureException
import androidx.camera.core.Preview
import androidx.camera.core.UseCaseGroup
import androidx.camera.core.resolutionselector.ResolutionSelector
import androidx.camera.core.resolutionselector.ResolutionStrategy
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.camera.view.PreviewView
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.setValue
import androidx.core.content.ContextCompat
import androidx.lifecycle.LifecycleOwner
import kotlinx.coroutines.suspendCancellableCoroutine
import java.io.File
import java.util.concurrent.TimeUnit
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException

@androidx.annotation.OptIn(markerClass = [ExperimentalCamera2Interop::class])
class CameraSession {
    var ready by mutableStateOf(false); private set
    var error by mutableStateOf(""); private set
    var zoom by mutableFloatStateOf(1f); private set
    var maxZoom by mutableFloatStateOf(1f); private set
    var minZoom by mutableFloatStateOf(1f); private set
    var torch by mutableStateOf(false); private set
    var hasFlash by mutableStateOf(false); private set
    var lensCount by mutableIntStateOf(0); private set
    var wideRatio by mutableFloatStateOf(0f); private set
    private data class Lens(val info: CameraInfo, val physical: String?, val ratio: Float)
    private var wide: Lens? = null
    private var useWide = false
    private var wideRejected = false
    private var scale = 1f
    private var camera: Camera? = null
    private var capture: ImageCapture? = null
    private var provider: ProcessCameraProvider? = null
    private var binding: Triple<Context, LifecycleOwner, PreviewView>? = null
    private var generation = 0
    private var observedInfo: CameraInfo? = null
    private var observedOwner: LifecycleOwner? = null
    private fun detachObservers() {
        observedOwner?.let { owner ->
            observedInfo?.zoomState?.removeObservers(owner)
            observedInfo?.cameraState?.removeObservers(owner)
            observedInfo?.torchState?.removeObservers(owner)
        }
        observedInfo = null; observedOwner = null
    }

    fun bind(context: Context, owner: LifecycleOwner, view: PreviewView) {
        binding = Triple(context, owner, view)
        val token = ++generation
        detachObservers()
        ready = false
        val future = ProcessCameraProvider.getInstance(context)
        future.addListener(cameraReady@{
            if (token != generation) return@cameraReady
            runCatching {
                val service = future.get(); provider = service
                val cameras = service.availableCameraInfos.filter { CameraSelector.DEFAULT_BACK_CAMERA.filter(listOf(it)).isNotEmpty() }
                lensCount = cameras.size
                check(cameras.isNotEmpty()) { "No hay una cámara trasera disponible." }
                val normal = cameras.minByOrNull { kotlin.math.abs(runCatching { it.intrinsicZoomRatio }.getOrDefault(1f) - 1f) }!!
                val candidates = cameras.filter { it != normal }.mapNotNull { info ->
                    val ratio = runCatching { info.intrinsicZoomRatio }.getOrDefault(1f)
                    if (ratio in .1f.. .94f) Lens(info, null, ratio) else null
                }.toMutableList()
                if (Build.VERSION.SDK_INT >= 28) runCatching {
                    val normalInfo = Camera2CameraInfo.from(normal)
                    val focal = normalInfo.getCameraCharacteristic(CameraCharacteristics.LENS_INFO_AVAILABLE_FOCAL_LENGTHS)?.minOrNull() ?: 0f
                    val width = normalInfo.getCameraCharacteristic(CameraCharacteristics.SENSOR_INFO_PHYSICAL_SIZE)?.width ?: 0f
                    for (physical in normal.physicalCameraInfos) {
                        val info = Camera2CameraInfo.from(physical)
                        val ratio = LensGeometry.relativeZoom(info.getCameraCharacteristic(CameraCharacteristics.LENS_INFO_AVAILABLE_FOCAL_LENGTHS)?.minOrNull() ?: 0f,
                            info.getCameraCharacteristic(CameraCharacteristics.SENSOR_INFO_PHYSICAL_SIZE)?.width ?: 0f, focal, width)
                        if (ratio in .1f.. .94f) candidates.add(Lens(normal, info.cameraId, ratio))
                    }
                }.onFailure { Diagnostics.record(context, "camera.wide.enumeration.failed") }
                wide = if (wideRejected) null else candidates.minByOrNull { it.ratio }
                val selected = if (useWide) wide else null
                val chosen = selected?.info ?: normal
                scale = selected?.ratio ?: 1f
                val selector = CameraSelector.Builder().addCameraFilter { infos -> infos.filter { it == chosen } }.build()
                val previewBuilder = Preview.Builder()
                val captureBuilder = ImageCapture.Builder().setCaptureMode(ImageCapture.CAPTURE_MODE_MINIMIZE_LATENCY)
                    .setJpegQuality(95).setResolutionSelector(ResolutionSelector.Builder()
                        .setResolutionStrategy(ResolutionStrategy(Size(2560, 1920), ResolutionStrategy.FALLBACK_RULE_CLOSEST_LOWER_THEN_HIGHER)).build())
                if (Build.VERSION.SDK_INT >= 28) selected?.physical?.let { id ->
                    Camera2Interop.Extender(previewBuilder).setPhysicalCameraId(id)
                    Camera2Interop.Extender(captureBuilder).setPhysicalCameraId(id)
                }
                val preview = previewBuilder.build().also { it.surfaceProvider = view.surfaceProvider }
                val imageCapture = captureBuilder.build()
                val group = UseCaseGroup.Builder().addUseCase(preview).addUseCase(imageCapture)
                view.viewPort?.let { group.setViewPort(it) }
                service.unbindAll()
                val bound = service.bindToLifecycle(owner, selector, group.build())
                camera = bound; capture = imageCapture
                observedInfo = bound.cameraInfo; observedOwner = owner
                hasFlash = bound.cameraInfo.hasFlashUnit()
                bound.cameraInfo.zoomState.observe(owner) { state ->
                    zoom = state.zoomRatio * scale; minZoom = state.minZoomRatio * scale; maxZoom = state.maxZoomRatio * scale
                    wideRatio = if (!useWide && state.minZoomRatio < .95f) state.minZoomRatio else wide?.ratio ?: 0f
                }
                bound.cameraInfo.cameraState.observe(owner) { state ->
                    ready = state.type == androidx.camera.core.CameraState.Type.OPEN
                    if (state.error != null) {
                        ready = false
                        if (useWide) {
                            useWide = false; wideRejected = true
                            Diagnostics.record(context, "camera.wide.unavailable")
                            view.post { if (token == generation) bind(context, owner, view) }
                        } else error = "La cámara se interrumpió. Tocá Reiniciar cámara."
                    }
                    else if (state.type == androidx.camera.core.CameraState.Type.OPEN) { ready = true; error = "" }
                }
                bound.cameraInfo.torchState.observe(owner) { state -> torch = state == TorchState.ON }
                val gestures = ScaleGestureDetector(context, object : ScaleGestureDetector.SimpleOnScaleGestureListener() {
                    override fun onScale(detector: ScaleGestureDetector): Boolean { requestZoom(zoom * detector.scaleFactor); return true }
                })
                view.setOnTouchListener { _, event ->
                    gestures.onTouchEvent(event)
                    if (event.action == MotionEvent.ACTION_UP && !gestures.isInProgress) {
                        val point = view.meteringPointFactory.createPoint(event.x, event.y)
                        bound.cameraControl.startFocusAndMetering(FocusMeteringAction.Builder(point).setAutoCancelDuration(3, TimeUnit.SECONDS).build())
                        view.performClick()
                    }
                    true
                }
            }.onFailure {
                ready = false
                if (useWide) {
                    useWide = false; wideRejected = true
                    Diagnostics.record(context, "camera.wide.unavailable")
                    bind(context, owner, view)
                } else error = "No se pudo iniciar la cámara. Revisá el permiso y tocá Reiniciar cámara."
            }
        }, ContextCompat.getMainExecutor(context))
    }
    fun nextLens(context: Context, owner: LifecycleOwner, view: PreviewView) {
        if (zoom < .95f) selectNormal(context, owner, view) else selectWide(context, owner, view)
    }
    fun selectWide(context: Context, owner: LifecycleOwner, view: PreviewView) {
        if (!useWide && minZoom < .95f) requestZoom(minZoom)
        else if (wide != null) { useWide = true; bind(context, owner, view) }
    }
    fun selectNormal(context: Context, owner: LifecycleOwner, view: PreviewView) {
        if (useWide) { useWide = false; bind(context, owner, view) } else requestZoom(1f)
    }
    fun requestZoom(value: Float) { camera?.cameraControl?.setZoomRatio(value.coerceIn(minZoom, maxZoom) / scale) }
    fun toggleTorch() {
        if (hasFlash) { torch = !torch; camera?.cameraControl?.enableTorch(torch) }
    }
    suspend fun take(context: Context, file: File): File = suspendCancellableCoroutine { continuation ->
        val active = capture
        if (!ready || active == null) { continuation.resumeWithException(IllegalStateException("La cámara todavía no está lista.")); return@suspendCancellableCoroutine }
        active.takePicture(ImageCapture.OutputFileOptions.Builder(file).build(), ContextCompat.getMainExecutor(context), object : ImageCapture.OnImageSavedCallback {
            override fun onImageSaved(result: ImageCapture.OutputFileResults) { if (continuation.isActive) continuation.resume(file) }
            override fun onError(exception: ImageCaptureException) { if (continuation.isActive) continuation.resumeWithException(IllegalStateException("No se pudo sacar la foto. El ticket anterior sigue guardado.")) }
        })
    }
    fun recover() { binding?.let { (context, owner, view) -> provider?.unbindAll(); bind(context, owner, view) } }
    fun close() { generation++; detachObservers(); provider?.unbindAll(); camera = null; capture = null; ready = false; binding = null }
}
