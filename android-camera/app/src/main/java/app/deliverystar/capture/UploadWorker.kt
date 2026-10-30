package app.deliverystar.capture

import android.content.Context
import android.net.Uri
import androidx.work.CoroutineWorker
import androidx.work.WorkerParameters
import com.google.mlkit.vision.common.InputImage
import com.google.mlkit.vision.text.TextRecognition
import com.google.mlkit.vision.text.latin.TextRecognizerOptions
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.TimeoutCancellationException
import kotlinx.coroutines.delay
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.tasks.await
import kotlinx.coroutines.withTimeout
import java.io.File
import java.io.IOException

class UploadWorker(context: Context, parameters: WorkerParameters) : CoroutineWorker(context, parameters) {
    companion object { private val processing = Mutex() }
    override suspend fun doWork(): Result = processing.withLock {
        val app = applicationContext as CaptureApplication
        val repository = app.repository
        val dao = repository.dao
        val id = inputData.getString("captureId") ?: return@withLock Result.failure()
        var row = dao.get(id) ?: return@withLock Result.success()
        if (row.state in listOf("DRAFT", "SENT", "ERROR")) return@withLock Result.success()
        if (row.state == "REVIEW") {
            if (row.reviewUntil > System.currentTimeMillis()) return@withLock Result.retry()
        }
        // Claim and Repetir race through a single SQL state transition. If the
        // user wins, no worker may upload the replaced draft's stale file.
        if (dao.claim(id, System.currentTimeMillis()) != 1) return@withLock Result.success()
        row = dao.get(id)!!
        val api = CaptureApi()
        val evidence = File(applicationContext.cacheDir, "evidence-$id.jpg")
        val ticket = File(applicationContext.cacheDir, "ticket-$id.jpg")
        try {
            dao.attempt(id)
            // Yield CPU-heavy work to a shutter press. Network transfer itself
            // can continue while the next photos are captured.
            while (repository.capturing) delay(200)
            if (!row.evidenceStored) {
                ImageFiles.prepare(File(row.evidencePath), evidence, 2400, 90)
                api.uploadEvidence(row, evidence)
                dao.evidenceStored(id)
            }
            while (repository.capturing) delay(200)
            if (!row.ocrAttempted) {
                ImageFiles.prepare(File(row.ticketPath), ticket, 1600, 86)
                val reader = TextRecognition.getClient(TextRecognizerOptions.DEFAULT_OPTIONS)
                try {
                    val text = withTimeout(10_000) { reader.process(InputImage.fromFilePath(applicationContext, Uri.fromFile(ticket))).await().text }
                    dao.ocr(id, text.take(16_000))
                } catch (error: Exception) {
                    if (error is CancellationException && error !is TimeoutCancellationException) throw error
                    // The ticket stays available for existing web/cloud review.
                    dao.ocr(id, "")
                    Diagnostics.record(applicationContext, "ocr.unread")
                } finally { reader.close() }
            }
            row = dao.get(id)!!
            if (row.photoId.isBlank()) {
                val photo = api.register(row)
                dao.registered(id, photo.getString("id"), photo.optString("name"))
                row = dao.get(id)!!
            }
            if (!row.ticketStored && !row.ticketExpired) {
                if (!ticket.exists()) ImageFiles.prepare(File(row.ticketPath), ticket, 1600, 86)
                try {
                    if (!api.uploadTicket(row.photoId, ticket)) throw ApiFailure(503)
                    dao.ticketStored(id)
                } catch (error: ApiFailure) {
                    if (error.status == 409 && System.currentTimeMillis() - row.createdAt >= 72L * 60 * 60 * 1000) dao.ticketExpired(id)
                    else throw error
                }
            }
            dao.state(id, "SENT", "")
            // Acknowledged evidence and ticket (or explicit TTL expiry) no
            // longer require local full-size copies. Keep bounded thumbnails.
            saveThumbnail(File(row.evidencePath))
            saveThumbnail(File(row.ticketPath))
            repository.pruneSent()
            Diagnostics.record(applicationContext, "upload.sent")
            Result.success()
        } catch (error: CancellationException) {
            throw error
        } catch (error: Exception) {
            val retry = error is ApiFailure && error.retryable || error is IOException && error !is ApiFailure
            dao.state(id, if (retry) "READY" else "ERROR", if (retry)
                "Esperando conexión o reintento automático. Las fotos siguen guardadas."
                else if (error is ApiFailure && error.status in listOf(401, 403)) "La conexión requiere revisión. Conservamos las fotos."
                else "No se pudo completar el envío. Conservamos las fotos; reintentá o compartí el diagnóstico.")
            Diagnostics.record(applicationContext, if (retry) "upload.retry" else "upload.error", (error as? ApiFailure)?.status ?: 0)
            if (retry) Result.retry() else Result.failure()
        } finally { evidence.delete(); ticket.delete() }
    }
    private fun saveThumbnail(original: File) {
        if (!original.exists()) return
        val small = File(original.path + ".thumb")
        runCatching { ImageFiles.prepare(original, small, 480, 80) }
        // The full original is retained if thumbnail generation fails.
        if (small.length() > 0) original.delete()
    }
}
