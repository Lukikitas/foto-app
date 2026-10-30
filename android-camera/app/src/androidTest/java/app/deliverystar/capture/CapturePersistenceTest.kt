package app.deliverystar.capture

import android.content.Context
import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import kotlinx.coroutines.runBlocking
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File
import java.security.MessageDigest
import java.util.UUID

@RunWith(AndroidJUnit4::class)
class CapturePersistenceTest {
    private val context = ApplicationProvider.getApplicationContext<Context>()
    @Test fun fiveHundredPairsSurviveDatabaseReopenWithOriginalBytesAndAcknowledgements() {
        val name = "recovery-${UUID.randomUUID()}.db"
        var db = Room.databaseBuilder(context, CaptureDatabase::class.java, name).build()
        val folder = File(context.cacheDir, "persistence-${UUID.randomUUID()}").apply { mkdirs() }
        val expected = mutableMapOf<String, ByteArray>()
        try {
            for (index in 0 until 500) {
                val bytes = ByteArray(4096) { ((index + it) % 251).toByte() }
                val ticket = File(folder, "$index-ticket.jpg").apply { writeBytes(bytes) }
                val evidence = File(folder, "$index-evidence.jpg").apply { writeBytes(bytes.reversedArray()) }
                val capture = Capture().apply { id = UUID.randomUUID().toString(); author = "Prueba"; createdAt = 1_700_000_000_000 + index; ticketPath = ticket.path; evidencePath = evidence.path; state = "READY" }
                db.captures().insert(capture)
                expected[capture.id] = MessageDigest.getInstance("SHA-256").digest(evidence.readBytes())
                if (index % 3 == 0) { db.captures().evidenceStored(capture.id); db.captures().registered(capture.id, "server-$index", "PEYA1234567890") }
            }
            db.close()
            db = Room.databaseBuilder(context, CaptureDatabase::class.java, name).build()
            val restored = db.captures().pending()
            assertEquals(500, restored.size)
            for (row in restored) {
                assertArrayEquals(expected[row.id], MessageDigest.getInstance("SHA-256").digest(File(row.evidencePath).readBytes()))
                assertEquals(4096L, File(row.ticketPath).length())
                assertEquals(row.evidenceStored, row.photoId.isNotBlank())
            }
        } finally { db.close(); context.deleteDatabase(name); folder.listFiles()?.forEach { it.delete() }; folder.delete() }
    }

    @Test fun repeatCannotChangeAPairAfterTheWorkerCommitsIt() {
        val db = Room.inMemoryDatabaseBuilder(context, CaptureDatabase::class.java).build()
        try {
            val row = Capture().apply { id = UUID.randomUUID().toString(); author = "Prueba" }
            db.captures().insert(row)
            assertEquals(1, db.captures().complete(row.id, "evidence.jpg", System.currentTimeMillis() + 5000))
            assertEquals(1, db.captures().repeat(row.id))
            assertEquals("DRAFT", db.captures().get(row.id)!!.state)
            assertEquals(0, db.captures().claim(row.id, System.currentTimeMillis() + 60_000))
            assertEquals(1, db.captures().complete(row.id, "replacement.jpg", System.currentTimeMillis() + 5000))
            assertEquals(1, db.captures().commit(row.id))
            assertEquals(0, db.captures().repeat(row.id))
            assertEquals(1, db.captures().claim(row.id, System.currentTimeMillis()))
            assertEquals("replacement.jpg", db.captures().get(row.id)!!.evidencePath)
            val retake = Capture().apply { id = UUID.randomUUID().toString(); author = "QA" }
            db.captures().insert(retake)
            assertEquals(1, db.captures().complete(retake.id, "previous-bag.jpg", System.currentTimeMillis() + 5000))
            assertEquals(1, db.captures().repeat(retake.id))
            assertEquals(1, db.captures().discardDraft(retake.id))
            assertNull(db.captures().get(retake.id))
        } finally { db.close() }
    }
    @Test fun pruningCanOnlySelectAcknowledgedHistoryAndKeepsTheLastTwoHundred() {
        val db = Room.inMemoryDatabaseBuilder(context, CaptureDatabase::class.java).build()
        try {
            for (index in 0 until 250) db.captures().insert(Capture().apply {
                id = UUID.randomUUID().toString(); author = "QA"; createdAt = index.toLong(); state = "SENT"
            })
            for (state in listOf("READY", "ERROR", "DRAFT", "UPLOADING")) db.captures().insert(Capture().apply {
                id = "pending-$state"; author = "QA"; this.state = state
            })
            val old = db.captures().sentToPrune()
            assertEquals(50, old.size)
            assertTrue(old.all { it.state == "SENT" && it.createdAt < 50 })
            assertEquals(0, db.captures().deleteSent("pending-READY"))
            assertEquals(0, db.captures().deleteSent("pending-ERROR"))
            for (row in old) assertEquals(1, db.captures().deleteSent(row.id))
            assertTrue(db.captures().sentToPrune().isEmpty())
        } finally { db.close() }
    }
}
