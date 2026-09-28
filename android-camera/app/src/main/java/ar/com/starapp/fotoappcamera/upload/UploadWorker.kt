package ar.com.starapp.fotoappcamera.upload

import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.Context
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.work.CoroutineWorker
import androidx.work.ForegroundInfo
import androidx.work.WorkerParameters
import ar.com.starapp.fotoappcamera.R
import ar.com.starapp.fotoappcamera.data.AppDatabase
import ar.com.starapp.fotoappcamera.data.NativeCapturePair
import ar.com.starapp.fotoappcamera.data.SupabaseApiClient
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import java.io.File

class UploadWorker(
    private val context: Context,
    workerParams: WorkerParameters
) : CoroutineWorker(context, workerParams) {

    companion object {
        const val KEY_SESSION_ID = "sessionId"
        const val KEY_SESSION_TOKEN = "sessionToken"
        const val KEY_TOKEN_HASH = "tokenHash"
        const val NOTIFICATION_CHANNEL_ID = "fotoapp_upload_channel"
        const val NOTIFICATION_ID = 1001
    }

    private val db = AppDatabase.getInstance(context)
    private val api = SupabaseApiClient()

    override suspend fun doWork(): Result = withContext(Dispatchers.IO) {
        val sessionId = inputData.getString(KEY_SESSION_ID) ?: return@withContext Result.failure()
        val tokenHash = inputData.getString(KEY_TOKEN_HASH) ?: return@withContext Result.failure()

        val pendingPairs = db.captureDao().getPendingUploadPairs(sessionId)
        if (pendingPairs.isEmpty()) {
            return@withContext Result.success()
        }

        try {
            setForeground(createForegroundInfo(pendingPairs.size))
        } catch (_: Exception) {
            // Notification permission might not be granted; worker continues in background
        }

        var anyFailed = false

        for (pair in pendingPairs) {
            db.captureDao().updatePair(pair.copy(uploadState = NativeCapturePair.STATE_PREPARING))

            val ticketFile = File(pair.ticketFilePath)
            val evidenceFile = File(pair.evidenceFilePath)

            if (!ticketFile.exists() || !evidenceFile.exists()) {
                db.captureDao().updatePair(
                    pair.copy(
                        uploadState = NativeCapturePair.STATE_ERROR,
                        errorMessage = "Los archivos locales no se encontraron."
                    )
                )
                anyFailed = true
                continue
            }

            try {
                // 1. Calculate hashes
                val ticketHash = SupabaseApiClient.calculateSha256(ticketFile)
                val evidenceHash = SupabaseApiClient.calculateSha256(evidenceFile)

                // 2. Storage paths under session folder
                val remoteTicketPath = "$sessionId/${pair.pairNumber}/ticket.jpg"
                val remoteEvidencePath = "$sessionId/${pair.pairNumber}/evidence.jpg"

                // 3. Upload ticket
                db.captureDao().updatePair(pair.copy(uploadState = NativeCapturePair.STATE_UPLOADING))
                val ticketUploadResult = api.uploadCaptureFile(remoteTicketPath, ticketFile, sessionId, tokenHash, ticketHash)
                if (ticketUploadResult.isFailure) {
                    throw ticketUploadResult.exceptionOrNull() ?: Exception("Fallo al subir ticket")
                }

                // 4. Upload evidence
                val evidenceUploadResult = api.uploadCaptureFile(remoteEvidencePath, evidenceFile, sessionId, tokenHash, evidenceHash)
                if (evidenceUploadResult.isFailure) {
                    throw evidenceUploadResult.exceptionOrNull() ?: Exception("Fallo al subir evidencia")
                }

                // 5. Register pair in Postgres via RPC
                val metadata = buildJsonObject {
                    pair.selectedLens?.let { put("selected_lens", it) }
                }

                val registerResult = api.registerPair(
                    sessionId = sessionId,
                    tokenHash = tokenHash,
                    pairNumber = pair.pairNumber,
                    ticketPath = remoteTicketPath,
                    evidencePath = remoteEvidencePath,
                    ticketHash = ticketHash,
                    evidenceHash = evidenceHash,
                    selectedLens = pair.selectedLens,
                    metadata = metadata
                )

                if (registerResult.isFailure) {
                    throw registerResult.exceptionOrNull() ?: Exception("Fallo al registrar par en base de datos")
                }

                // 6. Update local pair state to uploaded
                db.captureDao().updatePair(
                    pair.copy(
                        uploadState = NativeCapturePair.STATE_UPLOADED,
                        ticketHash = ticketHash,
                        evidenceHash = evidenceHash,
                        remoteTicketPath = remoteTicketPath,
                        remoteEvidencePath = remoteEvidencePath,
                        errorMessage = null,
                        updatedAt = System.currentTimeMillis()
                    )
                )

                // Files are preserved locally in STATE_UPLOADED until final destination/publication
                // is confirmed, ensuring no loss of the only local copy during transfer.
            } catch (e: Exception) {
                db.captureDao().updatePair(
                    pair.copy(
                        uploadState = NativeCapturePair.STATE_ERROR,
                        retryCount = pair.retryCount + 1,
                        errorMessage = e.message,
                        updatedAt = System.currentTimeMillis()
                    )
                )
                anyFailed = true
            }
        }

        if (anyFailed) {
            Result.retry()
        } else {
            Result.success()
        }
    }

    private fun createForegroundInfo(pendingCount: Int): ForegroundInfo {
        createNotificationChannel()

        val notification = NotificationCompat.Builder(context, NOTIFICATION_CHANNEL_ID)
            .setContentTitle("Foto-app Cámara")
            .setContentText("Subiendo $pendingCount fotos en segundo plano…")
            .setSmallIcon(R.drawable.ic_launcher_foreground)
            .setOngoing(true)
            .setSilent(true)
            .build()

        return ForegroundInfo(NOTIFICATION_ID, notification)
    }

    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                NOTIFICATION_CHANNEL_ID,
                "Subida de fotos",
                NotificationManager.IMPORTANCE_LOW
            ).apply {
                description = "Progreso de subida de fotos de Foto-app"
            }
            val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
            manager.createNotificationChannel(channel)
        }
    }
}
