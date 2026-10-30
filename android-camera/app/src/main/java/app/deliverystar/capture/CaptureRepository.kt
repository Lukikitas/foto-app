package app.deliverystar.capture

import android.content.Context
import android.os.StatFs
import androidx.work.BackoffPolicy
import androidx.work.Constraints
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.workDataOf
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.io.File
import java.io.FileOutputStream
import java.util.UUID
import java.util.concurrent.TimeUnit

class CaptureRepository(private val context: Context, val dao: CaptureDao) {
    private val root = File(context.filesDir, "captures").apply { mkdirs() }
    @Volatile var capturing = false
    fun temporaryFile(): File {
        check(StatFs(root.path).availableBytes > 32L * 1024 * 1024) {
            "Falta espacio en este celular. Conservamos los pendientes; liberá espacio antes de sacar otra foto."
        }
        return File.createTempFile("capture-", ".part", root)
    }
    private fun durableFile(temporary: File, id: String, kind: String): File {
        check(temporary.length() > 0) { "La cámara no pudo guardar la foto. Reintentá." }
        FileOutputStream(temporary, true).use { it.fd.sync() }
        val folder = File(root, id).apply { check(mkdirs() || isDirectory) }
        val saved = File(folder, "$kind-${UUID.randomUUID()}.jpg")
        check(temporary.renameTo(saved)) { "No se pudo guardar la foto en este celular." }
        return saved
    }
    suspend fun saveTicket(file: File, author: String): Capture = withContext(Dispatchers.IO) {
        require(author.trim().isNotEmpty() && author.trim().length <= 120)
        val row = Capture().apply {
            id = UUID.randomUUID().toString(); this.author = author.trim(); createdAt = System.currentTimeMillis()
        }
        row.ticketPath = durableFile(file, row.id, "ticket").path
        dao.insert(row)
        Diagnostics.record(context, "capture.ticket.saved")
        row
    }
    suspend fun saveEvidence(id: String, file: File): Capture = withContext(Dispatchers.IO) {
        val saved = durableFile(file, id, "evidence")
        check(dao.complete(id, saved.path, System.currentTimeMillis() + 5_000) == 1) { "El pedido cambió. El ticket anterior se conserva." }
        schedule(id, 5_000)
        Diagnostics.record(context, "capture.pair.saved")
        dao.get(id)!!
    }
    suspend fun repeatEvidence(id: String): Capture = withContext(Dispatchers.IO) {
        check(dao.repeat(id) == 1) { "El par ya entró en la cola. Empezá un nuevo par para repetirlo." }
        // Workers check persisted state before sending, even if cancellation races.
        WorkManager.getInstance(context).cancelUniqueWork("capture-$id").result.get()
        dao.get(id)!!
    }
    suspend fun discardTicket(id: String) = withContext(Dispatchers.IO) {
        if (dao.discardDraft(id) == 1) {
            // Only an explicit Repetir ticket removes an incomplete draft.
            File(root, id).listFiles()?.forEach { it.delete() }
            File(root, id).delete()
        }
    }
    suspend fun commit(id: String) = withContext(Dispatchers.IO) {
        dao.commit(id)
        schedule(id)
    }
    fun schedule(id: String, delay: Long = 0) {
        val request = OneTimeWorkRequestBuilder<UploadWorker>()
            .setInputData(workDataOf("captureId" to id))
            .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
            .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 30, TimeUnit.SECONDS)
            .setInitialDelay(maxOf(0, delay), TimeUnit.MILLISECONDS).build()
        WorkManager.getInstance(context).enqueueUniqueWork("capture-$id", ExistingWorkPolicy.KEEP, request)
    }
    suspend fun retry(id: String) = withContext(Dispatchers.IO) {
        val row = dao.get(id) ?: return@withContext
        if (row.state == "ERROR") {
            dao.state(id, "READY", "")
            WorkManager.getInstance(context).cancelUniqueWork("capture-$id").result.get()
            schedule(id)
        }
    }
    suspend fun recover() = withContext(Dispatchers.IO) {
        for (row in dao.pendingWork()) {
            schedule(row.id, if (row.state == "REVIEW") row.reviewUntil - System.currentTimeMillis() else 0)
        }
        pruneSent()
    }
    fun pruneSent() {
        // The web is the historical gallery. Bound the native history to 200
        // acknowledged pairs; never prune drafts, errors or pending transfers.
        for (row in dao.sentToPrune()) {
            if (runCatching { UUID.fromString(row.id).toString() }.getOrNull() != row.id) continue
            if (dao.deleteSent(row.id) != 1) continue
            val folder = File(root, row.id)
            if (folder.canonicalFile.parentFile != root.canonicalFile) continue
            folder.listFiles()?.filter { it.isFile }?.forEach { it.delete() }
            folder.delete()
        }
    }
}
