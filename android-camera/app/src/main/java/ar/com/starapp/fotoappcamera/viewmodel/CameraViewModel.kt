package ar.com.starapp.fotoappcamera.viewmodel

import android.app.Application
import android.content.Context
import android.content.Intent
import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities
import android.net.NetworkRequest
import android.net.Uri
import android.os.Build
import androidx.camera.core.ImageCapture
import androidx.camera.view.PreviewView
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.LifecycleOwner
import androidx.lifecycle.viewModelScope
import ar.com.starapp.fotoappcamera.camera.CameraDetector
import ar.com.starapp.fotoappcamera.camera.CameraDiagnosticReport
import ar.com.starapp.fotoappcamera.camera.CameraXManager
import ar.com.starapp.fotoappcamera.camera.LensMode
import ar.com.starapp.fotoappcamera.data.AppDatabase
import ar.com.starapp.fotoappcamera.data.NativeCapturePair
import ar.com.starapp.fotoappcamera.data.NativeCaptureSession
import ar.com.starapp.fotoappcamera.data.SupabaseApiClient
import ar.com.starapp.fotoappcamera.upload.UploadScheduler
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.io.File

enum class CaptureStep {
    READY_FOR_TICKET,
    CAPTURING_TICKET,
    REVIEW_TICKET,
    READY_FOR_EVIDENCE,
    CAPTURING_EVIDENCE,
    REVIEW_EVIDENCE,
    SAVING_PAIR
}

class CameraViewModel(application: Application) : AndroidViewModel(application) {

    private val db = AppDatabase.getInstance(application)
    private val api = SupabaseApiClient()

    private val _session = MutableStateFlow<NativeCaptureSession?>(null)
    val session: StateFlow<NativeCaptureSession?> = _session.asStateFlow()

    private val _captureStep = MutableStateFlow(CaptureStep.READY_FOR_TICKET)
    val captureStep: StateFlow<CaptureStep> = _captureStep.asStateFlow()

    private val _takenBy = MutableStateFlow("")
    val takenBy: StateFlow<String> = _takenBy.asStateFlow()

    private val _pairsCount = MutableStateFlow(0)
    val pairsCount: StateFlow<Int> = _pairsCount.asStateFlow()

    private val _pendingCount = MutableStateFlow(0)
    val pendingCount: StateFlow<Int> = _pendingCount.asStateFlow()

    private val _errorCount = MutableStateFlow(0)
    val errorCount: StateFlow<Int> = _errorCount.asStateFlow()

    private val _lensMode = MutableStateFlow(LensMode.NORMAL)
    val lensMode: StateFlow<LensMode> = _lensMode.asStateFlow()

    private val _zoomRatio = MutableStateFlow(1.0f)
    val zoomRatio: StateFlow<Float> = _zoomRatio.asStateFlow()

    private val _flashMode = MutableStateFlow(ImageCapture.FLASH_MODE_OFF)
    val flashMode: StateFlow<Int> = _flashMode.asStateFlow()

    private val _isTorchOn = MutableStateFlow(false)
    val isTorchOn: StateFlow<Boolean> = _isTorchOn.asStateFlow()

    private val _isOffline = MutableStateFlow(false)
    val isOffline: StateFlow<Boolean> = _isOffline.asStateFlow()

    private val _ticketFile = MutableStateFlow<File?>(null)
    val ticketFile: StateFlow<File?> = _ticketFile.asStateFlow()

    private val _evidenceFile = MutableStateFlow<File?>(null)
    val evidenceFile: StateFlow<File?> = _evidenceFile.asStateFlow()

    private val _incompleteTicketDialog = MutableStateFlow(false)
    val incompleteTicketDialog: StateFlow<Boolean> = _incompleteTicketDialog.asStateFlow()

    private val _diagnosticsOpen = MutableStateFlow(false)
    val diagnosticsOpen: StateFlow<Boolean> = _diagnosticsOpen.asStateFlow()

    private val _diagnosticReport = MutableStateFlow<CameraDiagnosticReport?>(null)
    val diagnosticReport: StateFlow<CameraDiagnosticReport?> = _diagnosticReport.asStateFlow()

    private val _errorMessage = MutableStateFlow<String?>(null)
    val errorMessage: StateFlow<String?> = _errorMessage.asStateFlow()

    private var preferredEvidenceLens: LensMode = LensMode.NORMAL
    private var networkCallback: ConnectivityManager.NetworkCallback? = null

    init {
        monitorNetwork()
    }

    private fun monitorNetwork() {
        val cm = getApplication<Application>().getSystemService(Context.CONNECTIVITY_SERVICE) as? ConnectivityManager
            ?: return

        val active = cm.activeNetwork
        val caps = cm.getNetworkCapabilities(active)
        _isOffline.value = caps == null || !caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)

        val request = NetworkRequest.Builder()
            .addCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
            .build()

        networkCallback = object : ConnectivityManager.NetworkCallback() {
            override fun onAvailable(network: Network) {
                _isOffline.value = false
                val curSession = _session.value
                if (curSession != null) {
                    UploadScheduler.triggerUpload(getApplication(), curSession.sessionId, curSession.tokenHash)
                }
            }

            override fun onLost(network: Network) {
                _isOffline.value = true
            }
        }
        cm.registerNetworkCallback(request, networkCallback!!)
    }

    fun handleIntent(intent: Intent?) {
        if (intent == null) return

        viewModelScope.launch {
            val uri: Uri? = intent.data
            var sessionId: String? = null
            var sessionToken: String? = intent.getStringExtra("sessionToken")

            if (uri != null) {
                // scheme fotoapp://capture/<sessionId> or https://delivery.star-app.com.ar/capture/<sessionId>
                val pathSegments = uri.pathSegments
                if (uri.scheme == "fotoapp" && uri.host == "capture") {
                    sessionId = pathSegments.firstOrNull()
                } else if (uri.scheme == "https" && uri.path?.startsWith("/capture") == true) {
                    sessionId = pathSegments.getOrNull(1)
                }
                if (sessionToken.isNullOrBlank()) {
                    sessionToken = uri.getQueryParameter("token")
                }
            }

            if (sessionId.isNullOrBlank()) {
                sessionId = intent.getStringExtra("sessionId")
            }

            if (!sessionId.isNullOrBlank()) {
                loadOrCreateSession(sessionId, sessionToken.orEmpty())
            } else {
                // Check if there is an active session already in Room
                val existing = db.captureDao().getActiveSession()
                if (existing != null) {
                    attachSession(existing)
                } else {
                    _errorMessage.value = "Abrí la cámara desde la sección «Sacar foto» de Foto-app."
                }
            }
        }
    }

    private suspend fun loadOrCreateSession(sessionId: String, sessionToken: String) {
        val existing = db.captureDao().getSession(sessionId)
        if (existing != null) {
            if (sessionToken.isNotBlank() && SupabaseApiClient.calculateSha256(sessionToken) != existing.tokenHash) {
                _errorMessage.value = "El enlace de sesión no coincide con la sesión guardada."
                return
            }
            attachSession(existing)
            return
        }

        if (sessionToken.isBlank()) {
            _errorMessage.value = "El enlace de Foto-app no incluye una credencial de sesión válida."
            return
        }

        val tokenHash = SupabaseApiClient.calculateSha256(sessionToken)
        val appVersion = "1.0.1"
        val deviceModel = "${Build.MANUFACTURER} ${Build.MODEL}"

        // Activate session in Supabase
        val activationResult = api.activateSession(sessionId, tokenHash, appVersion, deviceModel)
        if (activationResult.isFailure) {
            _errorMessage.value = activationResult.exceptionOrNull()?.message
                ?: "No se pudo validar la sesión con Foto-app."
            return
        }

        val takenByFromRemote = activationResult.getOrNull()
            ?.get("takenBy")
            ?.toString()
            ?.replace("\"", "")
            .orEmpty()

        val newSession = NativeCaptureSession(
            sessionId = sessionId,
            sessionToken = sessionToken,
            tokenHash = tokenHash,
            takenBy = takenByFromRemote.ifBlank { "Fotógrafo" },
            state = NativeCaptureSession.STATE_ACTIVE
        )

        db.captureDao().insertSession(newSession)
        attachSession(newSession)
    }

    private fun attachSession(session: NativeCaptureSession) {
        _session.value = session
        _takenBy.value = session.takenBy

        viewModelScope.launch {
            db.captureDao().getTotalPairsCount(session.sessionId).collect { _pairsCount.value = it }
        }
        viewModelScope.launch {
            db.captureDao().getPendingPairsCount(session.sessionId).collect { _pendingCount.value = it }
        }
        viewModelScope.launch {
            db.captureDao().getErrorPairsCount(session.sessionId).collect { _errorCount.value = it }
        }

        // Trigger any pending uploads for this session
        UploadScheduler.triggerUpload(getApplication(), session.sessionId, session.tokenHash)
    }

    fun onCaptureClicked(cameraXManager: CameraXManager) {
        val step = _captureStep.value
        if (step != CaptureStep.READY_FOR_TICKET && step != CaptureStep.READY_FOR_EVIDENCE) return

        val sessionVal = _session.value ?: return
        val sessionDir = File(getApplication<Application>().filesDir, "sessions/${sessionVal.sessionId}")
        sessionDir.mkdirs()

        if (step == CaptureStep.READY_FOR_TICKET) {
            _captureStep.value = CaptureStep.CAPTURING_TICKET
            val targetFile = File(sessionDir, "ticket_${System.currentTimeMillis()}.jpg")
            cameraXManager.takePicture(
                targetFile,
                onSuccess = { file ->
                    _ticketFile.value = file
                    _captureStep.value = CaptureStep.REVIEW_TICKET
                },
                onError = { exc ->
                    _errorMessage.value = "Error al capturar ticket: ${exc.message}"
                    _captureStep.value = CaptureStep.READY_FOR_TICKET
                }
            )
        } else if (step == CaptureStep.READY_FOR_EVIDENCE) {
            _captureStep.value = CaptureStep.CAPTURING_EVIDENCE
            val targetFile = File(sessionDir, "evidence_${System.currentTimeMillis()}.jpg")
            cameraXManager.takePicture(
                targetFile,
                onSuccess = { file ->
                    _evidenceFile.value = file
                    _captureStep.value = CaptureStep.REVIEW_EVIDENCE
                },
                onError = { exc ->
                    _errorMessage.value = "Error al capturar pedido: ${exc.message}"
                    _captureStep.value = CaptureStep.READY_FOR_EVIDENCE
                }
            )
        }
    }

    fun isWideSupported(): Boolean {
        return _diagnosticReport.value?.ultrawideAvailable ?: true
    }

    fun onUsePhotoClicked(cameraXManager: CameraXManager, lifecycleOwner: LifecycleOwner, previewView: PreviewView) {
        when (_captureStep.value) {
            CaptureStep.REVIEW_TICKET -> {
                // Switch to evidence step and apply remembered lens preference for evidence if supported
                _captureStep.value = CaptureStep.READY_FOR_EVIDENCE
                val targetLens = if (isWideSupported()) preferredEvidenceLens else LensMode.NORMAL
                onLensModeChanged(targetLens, cameraXManager, lifecycleOwner, previewView)
            }
            CaptureStep.REVIEW_EVIDENCE -> {
                saveCurrentPairAndReset(cameraXManager, lifecycleOwner, previewView)
            }
            else -> {}
        }
    }

    fun onRetakePhotoClicked() {
        when (_captureStep.value) {
            CaptureStep.REVIEW_TICKET -> {
                _ticketFile.value?.delete()
                _ticketFile.value = null
                _captureStep.value = CaptureStep.READY_FOR_TICKET
            }
            CaptureStep.REVIEW_EVIDENCE -> {
                _evidenceFile.value?.delete()
                _evidenceFile.value = null
                _captureStep.value = CaptureStep.READY_FOR_EVIDENCE
            }
            else -> {}
        }
    }

    fun onBackToTicketClicked() {
        if (_captureStep.value == CaptureStep.REVIEW_EVIDENCE || _captureStep.value == CaptureStep.READY_FOR_EVIDENCE) {
            _evidenceFile.value?.delete()
            _evidenceFile.value = null
            _captureStep.value = CaptureStep.REVIEW_TICKET
        }
    }

    private fun saveCurrentPairAndReset(
        cameraXManager: CameraXManager,
        lifecycleOwner: LifecycleOwner,
        previewView: PreviewView
    ) {
        val sessionVal = _session.value ?: return
        val ticket = _ticketFile.value ?: return
        val evidence = _evidenceFile.value ?: return

        _captureStep.value = CaptureStep.SAVING_PAIR

        viewModelScope.launch {
            try {
                withContext(Dispatchers.IO) {
                    val currentMax = db.captureDao().getMaxPairNumber(sessionVal.sessionId) ?: 0
                    val pairNumber = currentMax + 1

                    val pair = NativeCapturePair(
                        sessionId = sessionVal.sessionId,
                        pairNumber = pairNumber,
                        takenBy = sessionVal.takenBy,
                        ticketFilePath = ticket.absolutePath,
                        evidenceFilePath = evidence.absolutePath,
                        selectedLens = if (_lensMode.value == LensMode.WIDE) "wide" else "normal",
                        uploadState = NativeCapturePair.STATE_LOCAL
                    )

                    db.captureDao().insertPair(pair)
                    UploadScheduler.triggerUpload(getApplication(), sessionVal.sessionId, sessionVal.tokenHash)
                }

                // Local save confirmed: reset file references and loop back to ticket step immediately
                _ticketFile.value = null
                _evidenceFile.value = null
                _captureStep.value = CaptureStep.READY_FOR_TICKET

                // Always restore NORMAL (1×) lens for reading ticket
                onLensModeChanged(LensMode.NORMAL, cameraXManager, lifecycleOwner, previewView)
            } catch (e: Exception) {
                // Do NOT remain stuck in SAVING_PAIR!
                _errorMessage.value = "Error al guardar el par en este dispositivo: ${e.message}"
                // Revert step to REVIEW_EVIDENCE so photos are preserved for retrying
                _captureStep.value = CaptureStep.REVIEW_EVIDENCE
            }
        }
    }

    fun onLensModeChanged(mode: LensMode, cameraXManager: CameraXManager, lifecycleOwner: LifecycleOwner, previewView: PreviewView) {
        if (mode == LensMode.WIDE && !isWideSupported()) {
            _errorMessage.value = _diagnosticReport.value?.ultrawideExplanation
                ?: "Gran angular no disponible para aplicaciones de terceros en este dispositivo."
            _lensMode.value = LensMode.NORMAL
            cameraXManager.switchLensMode(LensMode.NORMAL, lifecycleOwner, previewView)
            _zoomRatio.value = cameraXManager.getZoomRatio()
            return
        }

        _lensMode.value = mode
        if (_captureStep.value == CaptureStep.READY_FOR_EVIDENCE || _captureStep.value == CaptureStep.REVIEW_EVIDENCE) {
            preferredEvidenceLens = mode
        }
        cameraXManager.switchLensMode(mode, lifecycleOwner, previewView)
        _zoomRatio.value = cameraXManager.getZoomRatio()
    }

    fun onZoomChanged(ratio: Float, cameraXManager: CameraXManager) {
        cameraXManager.setZoomRatio(ratio)
        _zoomRatio.value = cameraXManager.getZoomRatio()
    }

    fun onFlashToggled(cameraXManager: CameraXManager) {
        val nextMode = when (_flashMode.value) {
            ImageCapture.FLASH_MODE_OFF -> ImageCapture.FLASH_MODE_ON
            ImageCapture.FLASH_MODE_ON -> ImageCapture.FLASH_MODE_AUTO
            else -> ImageCapture.FLASH_MODE_OFF
        }
        _flashMode.value = nextMode
        cameraXManager.setFlashMode(nextMode)
    }

    fun onTorchToggled(cameraXManager: CameraXManager) {
        val next = !_isTorchOn.value
        _isTorchOn.value = next
        cameraXManager.enableTorch(next)
    }

    fun onFinishSessionRequested(onNavigateBackToPwa: (String) -> Unit) {
        // Check if there is an uncompleted ticket
        if (_ticketFile.value != null && _evidenceFile.value == null) {
            _incompleteTicketDialog.value = true
            return
        }
        completeSessionAndNavigate(onNavigateBackToPwa)
    }

    fun onDismissIncompleteDialog() {
        _incompleteTicketDialog.value = false
    }

    fun onDiscardIncompleteTicket(onNavigateBackToPwa: (String) -> Unit) {
        _ticketFile.value?.delete()
        _ticketFile.value = null
        _incompleteTicketDialog.value = false
        completeSessionAndNavigate(onNavigateBackToPwa)
    }

    private fun completeSessionAndNavigate(onNavigateBackToPwa: (String) -> Unit) {
        val sessionVal = _session.value ?: return

        viewModelScope.launch {
            val finishResult = withContext(Dispatchers.IO) {
                api.finishSession(sessionVal.sessionId, sessionVal.tokenHash)
            }

            if (finishResult.isFailure) {
                val err = finishResult.exceptionOrNull()?.message ?: "Error desconocido"
                _errorMessage.value = "No se pudo finalizar la sesión en el servidor ($err). La sesión local se mantiene activa."
                return@launch
            }

            withContext(Dispatchers.IO) {
                db.captureDao().updateSession(
                    sessionVal.copy(state = NativeCaptureSession.STATE_FINISHING)
                )
                UploadScheduler.triggerUpload(getApplication(), sessionVal.sessionId, sessionVal.tokenHash)
            }

            val returnUrl = "https://delivery.star-app.com.ar/camera-return?session=${sessionVal.sessionId}"
            onNavigateBackToPwa(returnUrl)
        }
    }

    fun openDiagnostics(context: Context) {
        _diagnosticReport.value = CameraDetector.buildDiagnosticReport(
            context = context,
            appVersion = "1.0.1",
            selectedLensMode = _lensMode.value,
            activeZoomRatio = _zoomRatio.value
        )
        _diagnosticsOpen.value = true
    }

    fun closeDiagnostics() {
        _diagnosticsOpen.value = false
    }

    fun reportCameraError(error: Throwable) {
        _errorMessage.value = error.message ?: "No se pudo iniciar la cámara."
    }

    fun clearError() {
        _errorMessage.value = null
    }

    override fun onCleared() {
        super.onCleared()
        val cm = getApplication<Application>().getSystemService(Context.CONNECTIVITY_SERVICE) as? ConnectivityManager
        networkCallback?.let { cm?.unregisterNetworkCallback(it) }
    }
}
