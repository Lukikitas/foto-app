package app.deliverystar.capture

import android.content.Context
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
    var lenses by mutableStateOf<List<CameraLensOption>>(emptyList()); private set
    var selectedLensKey by mutableStateOf(""); private set
    var unavailableLenses by mutableStateOf<Set<String>>(emptySet()); private set
    var lensNotice by mutableStateOf(""); private set
    val isPrincipal get() = selectedLensKey == lenses.firstOrNull()?.key
    private var defaultMinimum = 1f
    private var requestedZoom: Float? = null
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
                if (lenses.isEmpty()) {
                    lenses = CameraLenses.discover(context, service.availableCameraInfos)
                    selectedLensKey = lenses.first().key
                    lensCount = lenses.size
                }
                val selected = lenses.firstOrNull { it.key == selectedLensKey } ?: lenses.first()
                selectedLensKey = selected.key
                scale = selected.ratio.takeIf { it > 0f } ?: 1f
                val selector = CameraSelector.Builder().requireLensFacing(CameraSelector.LENS_FACING_BACK)
                    .addCameraFilter { infos -> infos.filter { it == selected.info } }
                    .apply { selected.physicalId?.let { setPhysicalCameraId(it) } }.build()
                val previewBuilder = Preview.Builder()
                val captureBuilder = ImageCapture.Builder().setCaptureMode(ImageCapture.CAPTURE_MODE_MINIMIZE_LATENCY)
                    .setJpegQuality(95).setResolutionSelector(ResolutionSelector.Builder()
                        .setResolutionStrategy(ResolutionStrategy(Size(2560, 1920), ResolutionStrategy.FALLBACK_RULE_CLOSEST_LOWER_THEN_HIGHER)).build())
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
                    if (token != generation) return@observe
                    zoom = state.zoomRatio * scale; minZoom = state.minZoomRatio * scale; maxZoom = state.maxZoomRatio * scale
                    if (isPrincipal) defaultMinimum = state.minZoomRatio
                    wideRatio = if (defaultMinimum < .95f) defaultMinimum else
                        lenses.filter { it.key !in unavailableLenses && it.ratio in .1f.. .94f }.minOfOrNull { it.ratio } ?: 0f
                    requestedZoom?.let { wanted -> requestedZoom = null; requestZoom(wanted) }
                }
                bound.cameraInfo.cameraState.observe(owner) { state ->
                    if (token != generation) return@observe
                    ready = state.type == androidx.camera.core.CameraState.Type.OPEN
                    if (state.error != null) {
                        ready = false
                        if (!isPrincipal) view.post { if (token == generation) returnToPrincipal(context, owner, view) }
                        else error = "La cámara se interrumpió. Tocá Reiniciar cámara."
                    }
                    else if (state.type == androidx.camera.core.CameraState.Type.OPEN) { ready = true; error = "" }
                }
                bound.cameraInfo.torchState.observe(owner) { state -> if (token == generation) torch = state == TorchState.ON }
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
                if (lenses.isNotEmpty() && !isPrincipal) returnToPrincipal(context, owner, view)
                else error = "No se pudo iniciar la cámara. Revisá el permiso y tocá Reiniciar cámara."
            }
        }, ContextCompat.getMainExecutor(context))
    }
    private fun returnToPrincipal(context: Context, owner: LifecycleOwner, view: PreviewView) {
        unavailableLenses = unavailableLenses + selectedLensKey
        selectedLensKey = lenses.first().key; requestedZoom = 1f
        lensNotice = "Esta lente no se pudo abrir. Volvimos a la principal."
        Diagnostics.record(context, "camera.lens.unavailable")
        bind(context, owner, view)
    }
    fun clearLensNotice() { lensNotice = "" }
    fun selectLens(context: Context, owner: LifecycleOwner, view: PreviewView, key: String) {
        val lens = lenses.firstOrNull { it.key == key && it.key !in unavailableLenses } ?: return
        lensNotice = ""
        val target = lens.ratio.takeIf { it > 0f } ?: 1f
        if (selectedLensKey == key) requestZoom(target)
        else { selectedLensKey = key; requestedZoom = target; bind(context, owner, view) }
    }
    fun selectWide(context: Context, owner: LifecycleOwner, view: PreviewView) {
        if (defaultMinimum < .95f) {
            if (isPrincipal) requestZoom(defaultMinimum)
            else { selectedLensKey = lenses.first().key; requestedZoom = defaultMinimum; bind(context, owner, view) }
        } else lenses.filter { it.key !in unavailableLenses && it.ratio in .1f.. .94f }.minByOrNull { it.ratio }
            ?.let { selectLens(context, owner, view, it.key) }
    }
    fun selectNormal(context: Context, owner: LifecycleOwner, view: PreviewView, desiredZoom: Float = 1f) {
        val main = lenses.firstOrNull() ?: return
        lensNotice = ""
        if (isPrincipal) requestZoom(desiredZoom)
        else { selectedLensKey = main.key; requestedZoom = desiredZoom; bind(context, owner, view) }
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
