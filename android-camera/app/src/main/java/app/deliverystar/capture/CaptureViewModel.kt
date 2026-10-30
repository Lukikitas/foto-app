package app.deliverystar.capture

import android.app.Application
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeout
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.TimeoutCancellationException
import java.io.File

class CaptureViewModel(application: Application) : AndroidViewModel(application) {
    val repository = (application as CaptureApplication).repository
    private val prefs = application.getSharedPreferences("capture-settings", Application.MODE_PRIVATE)
    var author by mutableStateOf(prefs.getString("author", "") ?: "")
    var draft by mutableStateOf<Capture?>(null); private set
    var lastPair by mutableStateOf<Capture?>(null); private set
    var busy by mutableStateOf(false); private set
    var loading by mutableStateOf(true); private set
    var message by mutableStateOf(""); private set
    var error by mutableStateOf(""); private set
    var qualityWarning by mutableStateOf(""); private set

    init {
        viewModelScope.launch {
            try {
                draft = withContext(Dispatchers.IO) { repository.dao.draft() }
                draft?.let { author = it.author; message = "Ticket recuperado. Ahora sacá la bolsa." }
            } catch (_: Exception) { error = "No se pudieron leer los pendientes. Conservá los datos de la app y compartí el diagnóstico." }
            finally { loading = false }
        }
    }
    fun take(session: CameraSession) {
        if (busy || loading || !session.ready) return
        if (author.trim().isEmpty()) { error = "Elegí quién está sacando las fotos."; return }
        busy = true; error = ""; message = ""; qualityWarning = ""; repository.capturing = true
        viewModelScope.launch {
            var temporary: File? = null
            try {
                lastPair?.let { repository.commit(it.id); lastPair = null }
                temporary = withContext(Dispatchers.IO) { repository.temporaryFile() }
                val photo = withTimeout(12_000) { session.take(getApplication(), temporary!!) }
                val current = draft
                if (current == null) {
                    draft = repository.saveTicket(photo, author)
                    prefs.edit().putString("author", author.trim()).apply()
                    message = "Ticket guardado. Ahora sacá la bolsa."
                    qualityWarning = withContext(Dispatchers.IO) { runCatching { CaptureQuality.inspect(draft!!.ticketPath, true) }.getOrDefault("") }
                } else {
                    lastPair = repository.saveEvidence(current.id, photo)
                    draft = null
                    message = "Par guardado en este celular. Podés seguir."
                    qualityWarning = withContext(Dispatchers.IO) { runCatching { CaptureQuality.inspect(lastPair!!.evidencePath, false) }.getOrDefault("") }
                }
                session.requestZoom(1f)
            } catch (failure: Exception) {
                if (failure is CancellationException && failure !is TimeoutCancellationException) throw failure
                if (failure is TimeoutCancellationException) session.recover()
                Diagnostics.record(getApplication(), "capture.failed")
                error = if (failure is TimeoutCancellationException) "La cámara tardó demasiado y se reinició. El ticket anterior sigue guardado; reintentá."
                    else "No se pudo guardar la captura. Revisá el espacio y reintentá. Conservamos el ticket anterior."
            }
            finally {
                temporary?.takeIf { it.exists() }?.delete()
                repository.capturing = false; busy = false
            }
        }
    }
    fun repeatEvidence() {
        val row = lastPair ?: return
        if (busy) return
        busy = true
        viewModelScope.launch {
            try { draft = repository.repeatEvidence(row.id); lastPair = null; message = "Ticket conservado. Volvé a sacar la bolsa."; error = "" }
            catch (_: Exception) { error = "El par ya entró en la cola. Empezá uno nuevo para repetirlo." }
            finally { busy = false }
        }
    }
    fun repeatTicket() {
        val row = draft ?: return
        if (busy) return
        busy = true
        viewModelScope.launch {
            try { repository.discardTicket(row.id); draft = null; error = ""; message = "Volvé a sacar el ticket." }
            catch (_: Exception) { error = "No se pudo reemplazar el ticket. El anterior sigue guardado." }
            finally { busy = false }
        }
    }
    fun retry(id: String) { viewModelScope.launch { repository.retry(id) } }
}
