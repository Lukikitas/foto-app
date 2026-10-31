package app.deliverystar.capture

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.view.accessibility.AccessibilityNodeInfo
import androidx.test.core.app.ActivityScenario
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import kotlinx.coroutines.runBlocking
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File

@RunWith(AndroidJUnit4::class)
class TemporaryClosureTest {
    private val app = ApplicationProvider.getApplicationContext<CaptureApplication>()
    private val instrumentation = InstrumentationRegistry.getInstrumentation()
    private val title = "La app se encuentra momentáneamente cerrada"
    private fun find(text: String, root: AccessibilityNodeInfo? = instrumentation.uiAutomation.rootInActiveWindow): AccessibilityNodeInfo? {
        if (root == null) return null
        if (root.text?.toString() == text || root.contentDescription?.toString() == text) return root
        for (i in 0 until root.childCount) find(text, root.getChild(i))?.let { return it }
        return null
    }
    private fun waitFor(label: String, test: () -> Boolean) {
        val deadline = System.currentTimeMillis() + 25_000
        while (System.currentTimeMillis() < deadline) {
            if (android.os.Build.VERSION.SDK_INT >= 34) instrumentation.uiAutomation.clearCache()
            if (test()) return
            Thread.sleep(150)
        }
        fail("Timed out: $label")
    }
    private fun assertClosed() {
        waitFor("closure notice") { find(title) != null }
        assertNotNull(find("Gracias por haberla usado y por ayudarnos en su desarrollo. Cada prueba y cada aporte nos ayudaron a mejorarla."))
        assertNull(find("Buscar actualizaciones"))
        assertNull(find("Ver envíos pendientes"))
        assertNull(find("Recientes"))
        assertNull(find("Gestión ↗"))
        assertNull(find("Compartir diagnóstico"))
        assertNull(find("Sacar ticket"))
        assertNull(find("Sacar bolsa"))
        assertNull(find("Quién saca las fotos"))
    }
    @Test fun launcherAndWebLinksStayClosedAndPreserveTheOriginalTicket() = runBlocking {
        assertTrue(BuildConfig.DEBUG && BuildConfig.CAPTURE_TEMPORARILY_CLOSED)
        assertEquals("https://android-test.invalid", BuildConfig.SUPABASE_URL)
        val bitmap = android.graphics.Bitmap.createBitmap(80, 120, android.graphics.Bitmap.Config.ARGB_8888)
        bitmap.eraseColor(android.graphics.Color.GRAY)
        val temporary = app.repository.temporaryFile()
        temporary.outputStream().use { bitmap.compress(android.graphics.Bitmap.CompressFormat.JPEG, 90, it) }
        bitmap.recycle()
        val ticket = app.repository.saveTicket(temporary, "QA cierre temporal")
        val original = File(ticket.ticketPath).readBytes()
        val link = Intent(Intent.ACTION_VIEW, Uri.parse("deliverystar://capture")).setClass(app, MainActivity::class.java)
            .addCategory(Intent.CATEGORY_BROWSABLE).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        try {
            ActivityScenario.launch(MainActivity::class.java).use {
                assertClosed()
                instrumentation.uiAutomation.takeScreenshot()?.let { image ->
                    File(app.cacheDir, "temporary-closure.png").outputStream().use { output -> image.compress(android.graphics.Bitmap.CompressFormat.PNG, 100, output) }
                    image.recycle()
                }
                app.startActivity(link)
                assertClosed()
                assertEquals("DRAFT", app.repository.dao.get(ticket.id)?.state)
                assertEquals(ticket.author, app.repository.dao.get(ticket.id)?.author)
                assertArrayEquals(original, File(ticket.ticketPath).readBytes())
            }
            ActivityScenario.launch<MainActivity>(link).use {
                assertClosed()
                assertEquals(ticket.createdAt, app.repository.dao.get(ticket.id)!!.createdAt)
                assertArrayEquals(original, File(ticket.ticketPath).readBytes())
            }
        } finally { app.repository.discardTicket(ticket.id) }
    }
    @Test fun closureKeepsTheFutureUpdateNoticeAvailableOffline() {
        assertTrue(BuildConfig.DEBUG && BuildConfig.CAPTURE_TEMPORARILY_CLOSED)
        val prefs = app.getSharedPreferences("app-updates", Context.MODE_PRIVATE)
        val previous = prefs.getString("manifest", null)
        prefs.edit().putString("manifest", org.json.JSONObject().put("versionCode", 999).put("versionName", "próxima versión")
            .put("downloadUrl", "https://github.com/Lukikitas/foto-app/releases/download/test/test.apk").toString()).commit()
        try {
            ActivityScenario.launch(MainActivity::class.java).use {
                assertClosed()
                assertNotNull(find("Actualización pendiente · próxima versión"))
                assertNotNull(find("Actualizar"))
            }
        } finally { prefs.edit().apply { if (previous == null) remove("manifest") else putString("manifest", previous) }.commit() }
    }
}
