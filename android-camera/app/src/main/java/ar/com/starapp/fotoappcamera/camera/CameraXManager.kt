package ar.com.starapp.fotoappcamera.camera

import android.content.Context
import android.os.Build
import android.view.Surface
import androidx.camera.camera2.interop.Camera2CameraControl
import androidx.camera.camera2.interop.CaptureRequestOptions
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

class CameraXManager(private val context: Context) {

    private var cameraProvider: ProcessCameraProvider? = null
    private var currentCamera: Camera? = null
    private var imageCapture: ImageCapture? = null
    private var preview: Preview? = null
    private val cameraExecutor: ExecutorService = Executors.newSingleThreadExecutor()

    private var activeLensMode: LensMode = LensMode.NORMAL
    private var logicalCameraInfo: LogicalCameraInfo? = null
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
        val provider = cameraProvider ?: return

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

            // If we have a physical wide camera ID and user is in WIDE mode
            if (activeLensMode == LensMode.WIDE && logicalCameraInfo?.bestWidePhysicalId != null) {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
                    try {
                        selectorBuilder.setPhysicalCameraId(logicalCameraInfo!!.bestWidePhysicalId!!)
                    } catch (_: Exception) {
                        // Fallback to logical selector if physical is rejected
                    }
                }
            }

            val cameraSelector = selectorBuilder.build()
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
            startCamera(lifecycleOwner, previewView) {}
        } else {
            // Fallback: apply min zoom ratio available
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
            logicalCameraInfo?.minZoomRatio ?: 0.5f,
            logicalCameraInfo?.maxZoomRatio ?: 4.0f
        )
        control.setZoomRatio(clamped)
    }

    fun getZoomRatio(): Float {
        return currentCamera?.cameraInfo?.zoomState?.value?.zoomRatio ?: 1.0f
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
        onError: (ImageCaptureException) -> Unit
    ) {
        val capture = imageCapture ?: return
        val outputOptions = ImageCapture.OutputFileOptions.Builder(outputFile).build()

        capture.takePicture(
            outputOptions,
            cameraExecutor,
            object : ImageCapture.OnImageSavedCallback {
                override fun onImageSaved(outputFileResults: ImageCapture.OutputFileResults) {
                    // Correct EXIF orientation in background thread
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
