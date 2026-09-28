package ar.com.starapp.fotoappcamera.camera

import android.content.Context
import android.os.Build
import android.view.Surface
import androidx.camera.core.Camera
import androidx.camera.core.CameraControl
import androidx.camera.core.CameraInfo
import androidx.camera.core.CameraSelector
import androidx.camera.core.FocusMeteringAction
import androidx.camera.core.ImageCapture
import androidx.camera.core.ImageCaptureException
import androidx.camera.core.MeteringPointFactory
import androidx.camera.core.Preview
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.camera.view.PreviewView
import androidx.core.content.ContextCompat
import androidx.lifecycle.LifecycleOwner
import java.io.File
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors

data class ActiveLensState(
    val lensMode: LensMode,
    val currentZoom: Float,
    val boundPhysicalCameraId: String?,
    val displayDescription: String
)

class CameraXManager(private val context: Context) {

    private var cameraProvider: ProcessCameraProvider? = null
    private var currentCamera: Camera? = null
    private var imageCapture: ImageCapture? = null
    private var preview: Preview? = null
    private val cameraExecutor: ExecutorService = Executors.newSingleThreadExecutor()

    private var activeLensMode: LensMode = LensMode.NORMAL
    private var logicalCameraInfo: LogicalCameraInfo? = null
    private var currentlyBoundPhysicalId: String? = null
    private var flashMode: Int = ImageCapture.FLASH_MODE_OFF
    private var torchEnabled: Boolean = false

    fun init(onReady: () -> Unit) {
        val cameraProviderFuture = ProcessCameraProvider.getInstance(context)
        cameraProviderFuture.addListener({
            cameraProvider = cameraProviderFuture.get()
            val cameras = CameraDetector.inspectCameras(context)
            logicalCameraInfo = cameras.firstOrNull { it.facing == CameraSelector.LENS_FACING_BACK }
            onReady()
        }, ContextCompat.getMainExecutor(context))
    }

    fun startCamera(
        lifecycleOwner: LifecycleOwner,
        previewView: PreviewView,
        onError: (Throwable) -> Unit
    ) {
        val provider = cameraProvider ?: run {
            onError(IllegalStateException("ProcessCameraProvider no está inicializado."))
            return
        }

        try {
            provider.unbindAll()

            preview = Preview.Builder().build().also {
                it.surfaceProvider = previewView.surfaceProvider
            }

            imageCapture = ImageCapture.Builder()
                .setCaptureMode(ImageCapture.CAPTURE_MODE_MINIMIZE_LATENCY)
                .setTargetRotation(previewView.display?.rotation ?: Surface.ROTATION_0)
                .setFlashMode(flashMode)
                .build()

            val selectorBuilder = CameraSelector.Builder()
                .requireLensFacing(CameraSelector.LENS_FACING_BACK)

            currentlyBoundPhysicalId = null

            // Validate and apply physical wide camera ID if in WIDE mode
            if (activeLensMode == LensMode.WIDE && logicalCameraInfo?.bestWidePhysicalId != null) {
                val candidateId = logicalCameraInfo!!.bestWidePhysicalId!!
                val isValidPhysicalWide = logicalCameraInfo!!.physicalLenses.any {
                    it.id == candidateId && it.isUltrawide && it.hasValidMetadata
                }

                if (isValidPhysicalWide && Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
                    try {
                        selectorBuilder.setPhysicalCameraId(candidateId)
                        currentlyBoundPhysicalId = candidateId
                    } catch (e: Exception) {
                        onError(IllegalStateException("No se pudo configurar la cámara física gran angular ($candidateId): ${e.message}", e))
                    }
                }
            }

            val cameraSelector = selectorBuilder.build()

            // Both Preview and ImageCapture are bound to the identical CameraSelector ensuring same lens
            currentCamera = provider.bindToLifecycle(
                lifecycleOwner,
                cameraSelector,
                preview,
                imageCapture
            )

            applyZoomForCurrentMode()
            if (torchEnabled) {
                currentCamera?.cameraControl?.enableTorch(true)
            }
        } catch (e: Exception) {
            onError(e)
        }
    }

    fun switchLensMode(mode: LensMode, lifecycleOwner: LifecycleOwner, previewView: PreviewView) {
        activeLensMode = mode
        val info = logicalCameraInfo

        if (info != null && info.supportsSubOneZoom) {
            // Smooth zoom ratio switch without rebinding camera
            applyZoomForCurrentMode()
        } else if (info?.bestWidePhysicalId != null) {
            // Rebind with physical camera ID
            startCamera(lifecycleOwner, previewView) { exc ->
                // If binding physical fails, fall back to normal mode
                activeLensMode = LensMode.NORMAL
                startCamera(lifecycleOwner, previewView) {}
            }
        } else {
            // If device has no ultrawide, remain on normal zoom
            applyZoomForCurrentMode()
        }
    }

    private fun applyZoomForCurrentMode() {
        val control = currentCamera?.cameraControl ?: return
        val info = logicalCameraInfo ?: return

        if (activeLensMode == LensMode.WIDE) {
            val targetZoom = if (info.supportsSubOneZoom) info.minZoomRatio else 1.0f
            control.setZoomRatio(targetZoom)
        } else {
            control.setZoomRatio(1.0f)
        }
    }

    fun setZoomRatio(ratio: Float) {
        val control = currentCamera?.cameraControl ?: return
        val clamped = ratio.coerceIn(
            logicalCameraInfo?.minZoomRatio ?: 1.0f,
            logicalCameraInfo?.maxZoomRatio ?: 4.0f
        )
        control.setZoomRatio(clamped)
    }

    fun getZoomRatio(): Float {
        return currentCamera?.cameraInfo?.zoomState?.value?.zoomRatio ?: 1.0f
    }

    fun getActuallyActiveLensState(): ActiveLensState {
        val zoom = getZoomRatio()
        val desc = when {
            currentlyBoundPhysicalId != null -> "Lente físico gran angular [$currentlyBoundPhysicalId] (${"%.2f".format(zoom)}×)"
            activeLensMode == LensMode.WIDE && (logicalCameraInfo?.supportsSubOneZoom == true) -> "Zoom gran angular nativo (${"%.2f".format(zoom)}×)"
            else -> "Lente normal 1× (${"%.2f".format(zoom)}×)"
        }
        return ActiveLensState(
            lensMode = activeLensMode,
            currentZoom = zoom,
            boundPhysicalCameraId = currentlyBoundPhysicalId,
            displayDescription = desc
        )
    }

    fun focusOnPoint(factory: MeteringPointFactory, x: Float, y: Float) {
        val control = currentCamera?.cameraControl ?: return
        val point = factory.createPoint(x, y)
        val action = FocusMeteringAction.Builder(point).build()
        control.startFocusAndMetering(action)
    }

    fun setFlashMode(mode: Int) {
        flashMode = mode
        imageCapture?.flashMode = mode
        if (mode != ImageCapture.FLASH_MODE_OFF && torchEnabled) {
            enableTorch(false)
        }
    }

    fun enableTorch(enabled: Boolean) {
        torchEnabled = enabled
        currentCamera?.cameraControl?.enableTorch(enabled)
    }

    fun isTorchEnabled(): Boolean = torchEnabled
    fun getFlashMode(): Int = flashMode
    fun getActiveLensMode(): LensMode = activeLensMode

    fun takePicture(
        outputFile: File,
        onSuccess: (File) -> Unit,
        onError: (Throwable) -> Unit
    ) {
        val capture = imageCapture ?: run {
            onError(IllegalStateException("La cámara todavía no está lista para capturar."))
            return
        }
        val outputOptions = ImageCapture.OutputFileOptions.Builder(outputFile).build()

        capture.takePicture(
            outputOptions,
            cameraExecutor,
            object : ImageCapture.OnImageSavedCallback {
                override fun onImageSaved(outputFileResults: ImageCapture.OutputFileResults) {
                    ImageExifUtils.fixOrientationAndSave(outputFile, outputFile)
                    onSuccess(outputFile)
                }

                override fun onError(exception: ImageCaptureException) {
                    onError(exception)
                }
            }
        )
    }

    fun shutdown() {
        cameraExecutor.shutdown()
    }
}
