package ar.com.starapp.fotoappcamera.ui

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import androidx.camera.view.PreviewView
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.gestures.detectTransformGestures
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Snackbar
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.LocalLifecycleOwner
import ar.com.starapp.fotoappcamera.camera.CameraXManager
import ar.com.starapp.fotoappcamera.ui.theme.DarkSurface
import ar.com.starapp.fotoappcamera.ui.theme.RedPrimary
import ar.com.starapp.fotoappcamera.ui.theme.TextWhite
import ar.com.starapp.fotoappcamera.viewmodel.CameraViewModel
import ar.com.starapp.fotoappcamera.viewmodel.CaptureStep
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.io.File
import kotlin.math.roundToInt

@Composable
fun CameraScreen(
    viewModel: CameraViewModel,
    onNavigateBackToPwa: (String) -> Unit
) {
    val context = LocalContext.current
    val lifecycleOwner = LocalLifecycleOwner.current
    val scope = rememberCoroutineScope()
    val density = LocalDensity.current

    val cameraXManager = remember { CameraXManager(context) }
    var previewViewRef by remember { mutableStateOf<PreviewView?>(null) }

    DisposableEffect(cameraXManager) {
        onDispose { cameraXManager.shutdown() }
    }

    val step by viewModel.captureStep.collectAsState()
    val takenBy by viewModel.takenBy.collectAsState()
    val pairsCount by viewModel.pairsCount.collectAsState()
    val pendingCount by viewModel.pendingCount.collectAsState()
    val errorCount by viewModel.errorCount.collectAsState()
    val lensMode by viewModel.lensMode.collectAsState()
    val zoomRatio by viewModel.zoomRatio.collectAsState()
    val flashMode by viewModel.flashMode.collectAsState()
    val isTorchOn by viewModel.isTorchOn.collectAsState()
    val isOffline by viewModel.isOffline.collectAsState()
    val ticketFile by viewModel.ticketFile.collectAsState()
    val evidenceFile by viewModel.evidenceFile.collectAsState()
    val incompleteDialog by viewModel.incompleteTicketDialog.collectAsState()
    val diagnosticsOpen by viewModel.diagnosticsOpen.collectAsState()
    val diagnosticReport by viewModel.diagnosticReport.collectAsState()
    val errorMessage by viewModel.errorMessage.collectAsState()

    // Focus indicator state
    var focusPoint by remember { mutableStateOf<Offset?>(null) }
    val focusAlpha = remember { Animatable(0f) }

    fun triggerFocus(offset: Offset) {
        val pv = previewViewRef ?: return
        cameraXManager.focusOnPoint(pv.meteringPointFactory, offset.x, offset.y)
        focusPoint = offset
        scope.launch {
            focusAlpha.snapTo(1f)
            delay(1000)
            focusAlpha.animateTo(0f, animationSpec = tween(500))
            focusPoint = null
        }
    }

    Box(modifier = Modifier.fillMaxSize()) {
        // --- 1. Camera Preview with Gestures ---
        androidx.compose.ui.viewinterop.AndroidView(
            factory = { ctx ->
                PreviewView(ctx).apply {
                    implementationMode = PreviewView.ImplementationMode.PERFORMANCE
                    scaleType = PreviewView.ScaleType.FILL_CENTER
                    previewViewRef = this
                    cameraXManager.init {
                        cameraXManager.startCamera(lifecycleOwner, this) { error ->
                            viewModel.reportCameraError(error)
                        }
                    }
                }
            },
            modifier = Modifier
                .fillMaxSize()
                .pointerInput(Unit) {
                    detectTransformGestures { _, _, zoom, _ ->
                        if (zoom != 1.0f) {
                            val newZoom = (cameraXManager.getZoomRatio() * zoom).coerceIn(0.5f, 10.0f)
                            viewModel.onZoomChanged(newZoom, cameraXManager)
                        }
                    }
                }
                .pointerInput(Unit) {
                    detectTapGestures { offset ->
                        triggerFocus(offset)
                    }
                }
        )

        // --- 2. Focus Indicator Overlay ---
        if (focusPoint != null && focusAlpha.value > 0f) {
            val sizeDp = 70.dp
            val sizePx = with(density) { sizeDp.toPx() }
            val x = (focusPoint!!.x - sizePx / 2).roundToInt()
            val y = (focusPoint!!.y - sizePx / 2).roundToInt()

            Box(
                modifier = Modifier
                    .offset { IntOffset(x, y) }
                    .size(sizeDp)
                    .border(2.dp, Color(0xFFE50914).copy(alpha = focusAlpha.value), RoundedCornerShape(8.dp))
            )
        }

        // --- 3. Review Image Overlay (when reviewing ticket or evidence) ---
        val reviewFile = when (step) {
            CaptureStep.REVIEW_TICKET -> ticketFile
            CaptureStep.REVIEW_EVIDENCE -> evidenceFile
            else -> null
        }

        if (reviewFile != null && reviewFile.exists()) {
            val bitmap by produceState<Bitmap?>(initialValue = null, key1 = reviewFile.absolutePath) {
                value = withContext(Dispatchers.IO) {
                    try {
                        val options = BitmapFactory.Options().apply {
                            inSampleSize = 2 // downsample slightly for responsive UI review
                        }
                        BitmapFactory.decodeFile(reviewFile.absolutePath, options)
                    } catch (e: Exception) {
                        null
                    }
                }
            }

            bitmap?.let { b ->
                Image(
                    bitmap = b.asImageBitmap(),
                    contentDescription = "Foto capturada",
                    contentScale = ContentScale.Crop,
                    modifier = Modifier.fillMaxSize()
                )
            }
        }

        // --- 4. Controls and Overlays ---
        CameraOverlay(
            step = step,
            takenBy = takenBy,
            pairsCount = pairsCount,
            pendingCount = pendingCount,
            errorCount = errorCount,
            lensMode = lensMode,
            zoomRatio = zoomRatio,
            flashMode = flashMode,
            isTorchOn = isTorchOn,
            isOffline = isOffline,
            onCaptureClick = { viewModel.onCaptureClicked(cameraXManager) },
            onUsePhotoClick = {
                previewViewRef?.let { pv ->
                    viewModel.onUsePhotoClicked(cameraXManager, lifecycleOwner, pv)
                }
            },
            onRetakeClick = { viewModel.onRetakePhotoClicked() },
            onBackToTicketClick = { viewModel.onBackToTicketClicked() },
            onLensModeToggle = { mode ->
                previewViewRef?.let { pv ->
                    viewModel.onLensModeChanged(mode, cameraXManager, lifecycleOwner, pv)
                }
            },
            onFlashToggle = { viewModel.onFlashToggled(cameraXManager) },
            onTorchToggle = { viewModel.onTorchToggled(cameraXManager) },
            onFinishClick = {
                viewModel.onFinishSessionRequested(onNavigateBackToPwa)
            },
            onDiagnosticsClick = {
                viewModel.openDiagnostics(context)
            }
        )

        // --- 5. Incomplete Ticket Dialog ---
        if (incompleteDialog) {
            AlertDialog(
                onDismissRequest = { viewModel.onDismissIncompleteDialog() },
                title = { Text("Ticket sin pedido", color = TextWhite) },
                text = {
                    Text(
                        "Tenés una foto de ticket tomada pero falta la foto del pedido para completar este par.",
                        color = TextWhite
                    )
                },
                containerColor = DarkSurface,
                confirmButton = {
                    Button(
                        onClick = { viewModel.onDismissIncompleteDialog() },
                        colors = ButtonDefaults.buttonColors(containerColor = RedPrimary)
                    ) {
                        Text("Completar pedido")
                    }
                },
                dismissButton = {
                    OutlinedButton(
                        onClick = { viewModel.onDiscardIncompleteTicket(onNavigateBackToPwa) }
                    ) {
                        Text("Descartar ticket y finalizar", color = Color(0xFFF87171))
                    }
                }
            )
        }

        // --- 6. Diagnostics Fullscreen Overlay ---
        if (diagnosticsOpen) {
            DiagnosticsScreen(
                report = diagnosticReport,
                onClose = { viewModel.closeDiagnostics() }
            )
        }

        // --- 7. Error Toast/Snackbar ---
        errorMessage?.let { msg ->
            Snackbar(
                action = {
                    TextButton(onClick = { viewModel.clearError() }) {
                        Text("Cerrar", color = Color.White)
                    }
                },
                modifier = Modifier
                    .align(Alignment.BottomCenter)
                    .padding(16.dp),
                containerColor = Color(0xFFDC2626)
            ) {
                Text(msg, color = Color.White)
            }
        }
    }
}
