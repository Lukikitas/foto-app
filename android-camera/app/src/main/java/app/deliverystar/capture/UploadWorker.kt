package app.deliverystar.capture

import android.content.Context
import android.net.Uri
import android.os.SystemClock
import androidx.work.CoroutineWorker
import androidx.work.WorkerParameters
import com.google.mlkit.vision.common.InputImage
import com.google.mlkit.vision.text.TextRecognition
import com.google.mlkit.vision.text.TextRecognizer
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
import org.json.JSONArray

class UploadWorker(context: Context, parameters: WorkerParameters) : CoroutineWorker(context, parameters) {
    companion object { private val processing = Mutex() }
    override suspend fun doWork(): Result = processing.withLock {
        val app = applicationContext as CaptureApplication
        processCapture(app.repository, CaptureApi(), inputData.getString("captureId"))
    }
    // Keep the same durable pipeline usable with an isolated repository and
    // HTTPS server for instrumented recovery tests, without replacing app config.
    internal suspend fun processCapture(repository: CaptureRepository, api: CaptureApi, captureId: String?,
        recognizerFactory: () -> TextRecognizer = { TextRecognition.getClient(TextRecognizerOptions.DEFAULT_OPTIONS) }): Result {
        val dao = repository.dao
        val id = captureId ?: return Result.failure()
        var row = dao.get(id) ?: return Result.success()
        if (row.state in listOf("DRAFT", "SENT", "ERROR")) return Result.success()
        if (row.state == "REVIEW") {
            if (row.reviewUntil > System.currentTimeMillis()) return Result.retry()
        }
        // Claim and Repetir race through a single SQL state transition. If the
        // user wins, no worker may upload the replaced draft's stale file.
        if (dao.claim(id, System.currentTimeMillis()) != 1) return Result.success()
        row = dao.get(id)!!
        val evidence = File(applicationContext.cacheDir, "evidence-$id.jpg")
        val ticket = File(applicationContext.cacheDir, "ticket-$id.jpg")
        var stage = "evidence.prepare"
        return try {
            dao.attempt(id)
            // Yield CPU-heavy work to a shutter press. Network transfer itself
            // can continue while the next photos are captured.
            while (repository.capturing) delay(200)
            if (!row.evidenceStored) {
                ImageFiles.prepare(File(row.evidencePath), evidence, 2400, 90)
                stage = "evidence.upload"
                api.uploadEvidence(row, evidence)
                dao.evidenceStored(id)
            }
            while (repository.capturing) delay(200)
            if (!row.ocrAttempted) {
                var reader: TextRecognizer? = null
                val texts = JSONArray()
                val started = SystemClock.elapsedRealtime()
                try {
                    withTimeout(10_000) {
                        ImageFiles.prepare(File(row.ticketPath), ticket, 1600, 86)
                        reader = recognizerFactory()
                        for (source in listOf(ticket, evidence)) {
                            while (repository.capturing) delay(200)
                            if (!source.exists()) ImageFiles.prepare(File(row.evidencePath), evidence, 2400, 90)
                            texts.put(reader!!.process(InputImage.fromFilePath(applicationContext, Uri.fromFile(source))).await().text.take(8_000))
                        }
                    }
                    Diagnostics.record(applicationContext, "ocr.complete", texts.length(), SystemClock.elapsedRealtime() - started)
                } catch (error: Throwable) {
                    if (error is CancellationException && error !is TimeoutCancellationException) throw error
                    if (error !is Exception && error !is LinkageError) throw error
                    // The ticket stays available for existing web/cloud review.
                    Diagnostics.record(applicationContext, if (error is TimeoutCancellationException) "ocr.timeout" else "ocr.unread",
                        texts.length(), SystemClock.elapsedRealtime() - started)
                } finally { runCatching { reader?.close() } }
                // Preserve a successful first reading even if the second times out.
                dao.ocr(id, texts.toString())
            }
            row = dao.get(id)!!
            if (row.photoId.isBlank()) {
                stage = "registration"
                val photo = api.register(row)
                dao.registered(id, photo.getString("id"), photo.optString("name"))
                row = dao.get(id)!!
            }
            if (!row.ticketStored && !row.ticketExpired) {
                stage = "ticket.prepare"
                if (!ticket.exists()) ImageFiles.prepare(File(row.ticketPath), ticket, 1600, 86)
                try {
                    stage = "ticket.upload"
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
            repository.pruneReplacedFiles(id)
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
                else "${when (stage) { "registration" -> "No se pudo confirmar el pedido"; "ticket.upload", "ticket.prepare" -> "No se pudo enviar el ticket"; else -> "No se pudo enviar la foto" }}${(error as? ApiFailure)?.let { " (${it.status})" } ?: ""}. Fotos guardadas; reintentá o compartí el diagnóstico.")
            Diagnostics.record(applicationContext, "upload.$stage.${if (retry) "retry" else "error"}", (error as? ApiFailure)?.status ?: 0)
            if (retry) Result.retry() else Result.failure()
        } finally { evidence.delete(); ticket.delete() }
    }
    private fun saveThumbnail(original: File) {
        if (!original.exists()) return
        val small = File(original.path + ".thumb")
        val prepared = runCatching { ImageFiles.prepare(original, small, 480, 80) }.isSuccess
        // The full original is retained if thumbnail generation fails.
        if (prepared && small.length() > 0) original.delete()
    }
}
