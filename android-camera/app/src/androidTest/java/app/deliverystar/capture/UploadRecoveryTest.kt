package app.deliverystar.capture

import android.content.Context
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.Typeface
import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.work.ListenableWorker
import androidx.work.testing.TestListenableWorkerBuilder
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.runBlocking
import okhttp3.OkHttpClient
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import okhttp3.tls.HandshakeCertificates
import okhttp3.tls.HeldCertificate
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File
import java.security.MessageDigest
import java.util.UUID
import java.util.concurrent.TimeUnit

@RunWith(AndroidJUnit4::class)
class UploadRecoveryTest {
    private val context = ApplicationProvider.getApplicationContext<Context>()
    private fun image(file: File) {
        val bitmap = Bitmap.createBitmap(1200, 800, Bitmap.Config.ARGB_8888)
        try {
            val canvas = Canvas(bitmap)
            canvas.drawColor(Color.WHITE)
            val paint = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = Color.BLACK; textSize = 90f; typeface = Typeface.MONOSPACE }
            canvas.drawText("PEDIDO", 80f, 180f, paint)
            canvas.drawText("1234567890", 80f, 340f, paint)
            file.outputStream().use { assertTrue(bitmap.compress(Bitmap.CompressFormat.JPEG, 95, it)) }
        } finally { bitmap.recycle() }
    }
    private fun hash(file: File) = MessageDigest.getInstance("SHA-256").digest(file.readBytes())

    @Test fun failedThumbnailCannotDeleteTheAcknowledgedOriginal() = runBlocking(Dispatchers.IO) {
        val db = Room.inMemoryDatabaseBuilder(context, CaptureDatabase::class.java).build()
        val repository = CaptureRepository(context, db.captures())
        val id = UUID.randomUUID().toString()
        val folder = File(context.filesDir, "captures/$id").apply { mkdirs() }
        val ticket = File(folder, "ticket-${UUID.randomUUID()}.jpg").also(::image)
        val evidence = File(folder, "evidence-${UUID.randomUUID()}.jpg").also(::image)
        val expected = hash(ticket)
        // Reproduce a non-empty destination that cannot be written as JPEG.
        // Its length alone must never be treated as successful preparation.
        val blockedThumbnail = File(ticket.path + ".thumb").apply { mkdirs() }
        File(blockedThumbnail, "blocker").writeText("test")
        try {
            db.captures().insert(Capture().apply {
                this.id = id; author = "QA miniatura"; createdAt = System.currentTimeMillis(); state = "READY"
                ticketPath = ticket.path; evidencePath = evidence.path
                evidenceStored = true; photoId = id; ticketStored = true; ocrAttempted = true
            })
            val worker = TestListenableWorkerBuilder<UploadWorker>(context).build()
            assertEquals(ListenableWorker.Result.success(), worker.processCapture(repository, CaptureApi(), id))
            assertEquals("SENT", db.captures().get(id)!!.state)
            assertTrue(ticket.exists())
            assertArrayEquals(expected, hash(ticket))
            assertFalse(evidence.exists())
            assertNotNull(ImageFiles.thumbnail(evidence.path + ".thumb")?.also { it.recycle() })
        } finally {
            db.close()
            blockedThumbnail.listFiles()?.forEach { it.delete() }; blockedThumbnail.delete()
            folder.listFiles()?.forEach { it.delete() }; folder.delete()
        }
    }

    @Test fun fullNativePipelineResumesEachStageAndKeepsOriginalsUntilTicketAcknowledgement() = exerciseRecovery(false)
    @Test fun unavailableRecognizerStillRegistersAndUploadsThePreservedPhotos() = exerciseRecovery(true)

    private fun exerciseRecovery(failRecognizer: Boolean) = runBlocking(Dispatchers.IO) {
        assertTrue(BuildConfig.DEBUG)
        assertEquals("https://android-test.invalid", BuildConfig.SUPABASE_URL)
        val id = UUID.randomUUID().toString()
        val databaseName = "upload-recovery-$id.db"
        var db = Room.databaseBuilder(context, CaptureDatabase::class.java, databaseName).build()
        var repository = CaptureRepository(context, db.captures())
        fun reopenDatabase() {
            db.close()
            db = Room.databaseBuilder(context, CaptureDatabase::class.java, databaseName).build()
            repository = CaptureRepository(context, db.captures())
        }
        val folder = File(context.filesDir, "captures/$id").apply { mkdirs() }
        val ticket = File(folder, "ticket-${UUID.randomUUID()}.jpg").also(::image)
        val evidence = File(folder, "evidence-${UUID.randomUUID()}.jpg").also(::image)
        val replaced = File(folder, "evidence-${UUID.randomUUID()}.jpg").apply { writeText("discarded retake") }
        val unrelated = File(folder, "notes.txt").apply { writeText("keep") }
        val expectedTicket = hash(ticket)
        val expectedEvidence = hash(evidence)
        val certificate = HeldCertificate.Builder().commonName("localhost").addSubjectAlternativeName("localhost").build()
        val serverCertificates = HandshakeCertificates.Builder().heldCertificate(certificate).build()
        val clientCertificates = HandshakeCertificates.Builder().addTrustedCertificate(certificate.certificate).build()
        val server = MockWebServer().apply { useHttps(serverCertificates.sslSocketFactory(), false); start() }
        try {
            val http = OkHttpClient.Builder().sslSocketFactory(clientCertificates.sslSocketFactory(), clientCertificates.trustManager)
                .callTimeout(5, TimeUnit.SECONDS).retryOnConnectionFailure(false).build()
            val api = CaptureApi(server.url("/").toString(), "isolated-test", http)
            val worker = TestListenableWorkerBuilder<UploadWorker>(context).build()
            db.captures().insert(Capture().apply {
                this.id = id; author = "QA integración"; createdAt = System.currentTimeMillis(); state = "READY"
                ticketPath = ticket.path; evidencePath = evidence.path
            })
            // Evidence succeeds, then registration loses its acknowledgement.
            server.enqueue(MockResponse().setBody("{}"))
            server.enqueue(MockResponse().setResponseCode(503))
            assertEquals(ListenableWorker.Result.retry(), worker.processCapture(repository, api, id) {
                if (failRecognizer) throw IllegalStateException("Synthetic unavailable recognizer")
                com.google.mlkit.vision.text.TextRecognition.getClient(com.google.mlkit.vision.text.latin.TextRecognizerOptions.DEFAULT_OPTIONS)
            })
            val afterEvidence = db.captures().get(id)!!
            assertTrue(afterEvidence.evidenceStored)
            assertTrue(afterEvidence.ocrAttempted)
            assertEquals("READY", afterEvidence.state)
            assertEquals("", afterEvidence.photoId)
            val evidenceRequest = server.takeRequest(3, TimeUnit.SECONDS)!!
            assertEquals("/storage/v1/object/photos/orders/mobile/$id.jpg", evidenceRequest.path)
            assertTrue(evidenceRequest.body.size > 1000)
            val registration = JSONObject(server.takeRequest(3, TimeUnit.SECONDS)!!.body.readUtf8())
            assertEquals(id, registration.getString("captureId"))
            val readings = registration.getJSONArray("ocrTexts")
            // A busy cold boot may exhaust the shared OCR deadline after the
            // first reading. That partial result must be preserved exactly;
            // decoding errors must not be mistaken for the documented timeout.
            if (failRecognizer) assertEquals(0, readings.length())
            else assertTrue("The bundled recognizer must read the generated ticket offline", readings.length() in 1..2)
            repeat(readings.length()) { assertTrue(readings.getString(it).contains("1234567890")) }
            val events = JSONArray(context.getSharedPreferences("diagnostics", Context.MODE_PRIVATE).getString("events", "[]"))
            val lastOcr = (0 until events.length()).map { events.getJSONObject(it) }.last { it.getString("event").startsWith("ocr.") }
            assertEquals(if (failRecognizer) "ocr.unread" else if (readings.length() == 2) "ocr.complete" else "ocr.timeout", lastOcr.getString("event"))
            assertEquals(readings.length(), lastOcr.getInt("status"))
            if (readings.length() == 1) assertTrue(lastOcr.getLong("duration") >= 9_000)
            assertEquals(registration.getJSONArray("ocrTexts").toString(), afterEvidence.ocrText)
            repository.pruneReplacedFiles(id)
            assertTrue(replaced.exists())
            reopenDatabase()

            // Resume registration without re-uploading evidence, then lose the
            // ticket response. Its stored checkpoint must not be invented.
            server.enqueue(MockResponse().setBody(JSONObject().put("photo", JSONObject().put("id", id).put("name", "PEYA1234567890")).toString()))
            server.enqueue(MockResponse().setResponseCode(503))
            assertEquals(ListenableWorker.Result.retry(), worker.processCapture(repository, api, id))
            assertEquals("/functions/v1/capture-sync", server.takeRequest(3, TimeUnit.SECONDS)!!.path)
            assertEquals("/functions/v1/order-code-recovery", server.takeRequest(3, TimeUnit.SECONDS)!!.path)
            assertEquals(id, db.captures().get(id)!!.photoId)
            assertFalse(db.captures().get(id)!!.ticketStored)
            reopenDatabase()

            // A successful HTTP response without stored=true is still pending.
            server.enqueue(MockResponse().setBody("{\"stored\":false}"))
            assertEquals(ListenableWorker.Result.retry(), worker.processCapture(repository, api, id))
            assertEquals("/functions/v1/order-code-recovery", server.takeRequest(3, TimeUnit.SECONDS)!!.path)
            assertArrayEquals(expectedTicket, hash(ticket))
            assertArrayEquals(expectedEvidence, hash(evidence))
            assertTrue(replaced.exists())
            assertFalse(File(context.cacheDir, "ticket-$id.jpg").exists())
            assertFalse(File(context.cacheDir, "evidence-$id.jpg").exists())

            server.enqueue(MockResponse().setBody("{\"stored\":true}"))
            assertEquals(ListenableWorker.Result.success(), worker.processCapture(repository, api, id))
            val ticketRequest = server.takeRequest(3, TimeUnit.SECONDS)!!
            assertEquals("/functions/v1/order-code-recovery", ticketRequest.path)
            assertTrue(ticketRequest.getHeader("Content-Type")!!.startsWith("multipart/form-data"))
            assertTrue(ticketRequest.body.size > 1000)
            val sent = db.captures().get(id)!!
            assertEquals("SENT", sent.state)
            assertTrue(sent.evidenceStored && sent.ticketStored)
            assertEquals(4, sent.attempts)
            assertEquals(6, server.requestCount)
            assertFalse(ticket.exists())
            assertFalse(evidence.exists())
            assertNotNull(ImageFiles.thumbnail(ticket.path + ".thumb")?.also { it.recycle() })
            assertNotNull(ImageFiles.thumbnail(evidence.path + ".thumb")?.also { it.recycle() })
            assertFalse("Acknowledged retakes must not accumulate full-size files", replaced.exists())
            assertTrue(unrelated.exists())
        } finally {
            server.shutdown(); db.close(); context.deleteDatabase(databaseName)
            folder.listFiles()?.forEach { it.delete() }; folder.delete()
        }
    }
}
