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
    var themeMode by mutableStateOf(prefs.getString("appearance", "system") ?: "system"); private set
    fun cycleTheme() { themeMode = when (themeMode) { "system" -> "light"; "light" -> "dark"; else -> "system" }; prefs.edit().putString("appearance", themeMode).apply() }
    var draft by mutableStateOf<Capture?>(null); private set
    var lastPair by mutableStateOf<Capture?>(null); private set
    var busy by mutableStateOf(false); private set
    var loading by mutableStateOf(true); private set
    var message by mutableStateOf(""); private set
    var error by mutableStateOf(""); private set
    var qualityWarning by mutableStateOf(""); private set
    var update by mutableStateOf(AppUpdates.cached(application)); private set
    var updateNotice by mutableStateOf(""); private set
    private var updateCheckAt = 0L
    private var checkingUpdate = false

    fun checkUpdates(force: Boolean = false) {
        if (checkingUpdate || !force && System.currentTimeMillis() - updateCheckAt < 15 * 60_000) return
        checkingUpdate = true; updateCheckAt = System.currentTimeMillis()
        viewModelScope.launch {
            try {
                update = withContext(Dispatchers.IO) { AppUpdates.check(getApplication()) }
                if (force && update == null) updateNotice = "Ya tenés la versión más reciente."
            } catch (_: Exception) { if (force) updateNotice = "No se pudo comprobar la actualización. Reintentá con conexión." }
            finally { checkingUpdate = false }
        }
    }
    fun clearUpdateNotice() { updateNotice = "" }

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
        if (BuildConfig.CAPTURE_TEMPORARILY_CLOSED) return
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
            try { draft = repository.repeatEvidence(row.id); lastPair = null; qualityWarning = ""; message = "Ticket conservado. Volvé a sacar la bolsa."; error = "" }
            catch (_: Exception) {
                val stored = withContext(Dispatchers.IO) { runCatching { repository.dao.get(row.id) }.getOrNull() }
                if (stored?.state == "DRAFT") { draft = stored; lastPair = null }
                error = if (draft != null) "Ticket conservado. Reintentá sacar la bolsa."
                    else "El par ya entró en la cola. Empezá uno nuevo para repetirlo."
            }
            finally { busy = false }
        }
    }
    fun repeatTicket() {
        val row = draft ?: lastPair ?: return
        if (busy) return
        busy = true
        viewModelScope.launch {
            try {
                if (draft == null) {
                    // The same atomic review guard used for Repetir bolsa must
                    // win before either file can be discarded.
                    draft = repository.repeatEvidence(row.id)
                    lastPair = null
                }
                repository.discardTicket(row.id)
                draft = null; qualityWarning = ""; error = ""; message = "Volvé a sacar el ticket."
            } catch (_: Exception) {
                val stored = withContext(Dispatchers.IO) { runCatching { repository.dao.get(row.id) }.getOrNull() }
                if (stored?.state == "DRAFT") { draft = stored; lastPair = null }
                error = if (draft != null) "No se pudo reemplazar el ticket. El anterior sigue guardado."
                    else "El par ya entró en la cola y no se cambió. Podés empezar otro par."
            }
            finally { busy = false }
        }
    }
    fun retry(id: String) { viewModelScope.launch { repository.retry(id) } }
}
