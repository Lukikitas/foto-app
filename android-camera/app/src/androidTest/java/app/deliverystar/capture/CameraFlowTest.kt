package app.deliverystar.capture

import android.Manifest
import android.os.Bundle
import android.view.accessibility.AccessibilityNodeInfo
import androidx.test.core.app.ActivityScenario
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Assert.*
import org.junit.Test
import org.junit.Before
import org.junit.runner.RunWith
import java.io.File
import java.util.UUID

@RunWith(AndroidJUnit4::class)
class CameraFlowTest {
    private val instrumentation = InstrumentationRegistry.getInstrumentation()
    private val application = ApplicationProvider.getApplicationContext<CaptureApplication>()
    @Before fun isolateIncompleteTestDraft() {
        org.junit.Assume.assumeFalse("Capture is intentionally closed in this release; TemporaryClosureTest covers its entry points", BuildConfig.CAPTURE_TEMPORARILY_CLOSED)
        assertTrue(BuildConfig.DEBUG)
        assertEquals("https://android-test.invalid", BuildConfig.SUPABASE_URL)
        application.repository.dao.draft()?.let { draft ->
            assertTrue("Only our own synthetic draft can be discarded", draft.author.startsWith("QA"))
            kotlinx.coroutines.runBlocking { application.repository.discardTicket(draft.id) }
        }
    }
    private fun waitFor(label: String, predicate: () -> Boolean) {
        val deadline = System.currentTimeMillis() + 25_000
        while (System.currentTimeMillis() < deadline) {
            // UiAutomation may retain virtual Compose nodes across text/state
            // updates. Re-fetch the current tree instead of a cached shutter.
            if (android.os.Build.VERSION.SDK_INT >= 34) instrumentation.uiAutomation.clearCache()
            if (predicate()) return
            Thread.sleep(150)
        }
        instrumentation.uiAutomation.takeScreenshot()?.let { screenshot ->
            File(application.cacheDir, "failed-camera-test.png").outputStream().use { screenshot.compress(android.graphics.Bitmap.CompressFormat.PNG, 100, it) }
            screenshot.recycle()
        }
        fail("Timed out: $label; UI=${describe(instrumentation.uiAutomation.rootInActiveWindow).take(5000)}")
    }
    // Compose exposes virtual accessibility descendants; Android's native
    // find-by-text shortcut does not traverse all provider implementations.
    private fun findText(text: String, root: AccessibilityNodeInfo? = instrumentation.uiAutomation.rootInActiveWindow): AccessibilityNodeInfo? {
        if (root == null) return null
        if (root.text?.toString() == text || root.contentDescription?.toString() == text) return root
        for (index in 0 until root.childCount) findText(text, root.getChild(index))?.let { return it }
        return null
    }
    private fun describe(root: AccessibilityNodeInfo?): String {
        if (root == null) return "no active window"
        return "[${root.className}:${root.text}:enabled=${root.isEnabled}]" +
            (0 until root.childCount).joinToString { describe(root.getChild(it)) }
    }
    private fun clickable(text: String): AccessibilityNodeInfo? {
        var node = findText(text)
        while (node != null && !node.isClickable) node = node.parent
        return node
    }
    private fun editable(root: AccessibilityNodeInfo?): AccessibilityNodeInfo? {
        if (root == null) return null
        if (root.isEditable) return root
        for (index in 0 until root.childCount) editable(root.getChild(index))?.let { return it }
        return null
    }
    private fun setAuthor(author: String) {
        if (editable(instrumentation.uiAutomation.rootInActiveWindow) == null) {
            waitFor("options") { clickable("Opciones") != null }
            clickable("Opciones")!!.performAction(AccessibilityNodeInfo.ACTION_CLICK)
            waitFor("author option") { clickable("Quién saca las fotos") != null }
            clickable("Quién saca las fotos")!!.performAction(AccessibilityNodeInfo.ACTION_CLICK)
        }
        waitFor("author field") { editable(instrumentation.uiAutomation.rootInActiveWindow) != null }
        editable(instrumentation.uiAutomation.rootInActiveWindow)!!.performAction(AccessibilityNodeInfo.ACTION_SET_TEXT,
            Bundle().apply { putCharSequence(AccessibilityNodeInfo.ACTION_ARGUMENT_SET_TEXT_CHARSEQUENCE, author) })
        waitFor("confirm author") { clickable("Listo")?.isEnabled == true }
        clickable("Listo")!!.performAction(AccessibilityNodeInfo.ACTION_CLICK)
    }
    private fun screenshot(name: String) {
        instrumentation.uiAutomation.takeScreenshot()?.let { bitmap ->
            File(application.cacheDir, name).outputStream().use { bitmap.compress(android.graphics.Bitmap.CompressFormat.PNG, 100, it) }
            bitmap.recycle()
        }
    }

    @Test fun webLinkReturnsToCameraAndPreservesTheIncompleteTicketOnWarmAndColdLaunch() {
        android.os.ParcelFileDescriptor.AutoCloseInputStream(instrumentation.uiAutomation.executeShellCommand("pm grant ${application.packageName} ${Manifest.permission.CAMERA}"))
            .bufferedReader().use { it.readText() }
        val link = android.content.Intent(android.content.Intent.ACTION_VIEW, android.net.Uri.parse("deliverystar://capture"))
            .setPackage(application.packageName).addCategory(android.content.Intent.CATEGORY_BROWSABLE)
            .addFlags(android.content.Intent.FLAG_ACTIVITY_NEW_TASK)
            .putExtra("author", "must not replace author").putExtra("return_url", "https://invalid.example")
        val resolved = application.packageManager.resolveActivity(link, android.content.pm.PackageManager.MATCH_DEFAULT_ONLY)
        assertEquals(MainActivity::class.java.name, resolved?.activityInfo?.name)
        val author = "QA enlace web"
        var ticket: Capture? = null
        var bytes = byteArrayOf()
        ActivityScenario.launch(MainActivity::class.java).use { scenario ->
            var original: MainActivity? = null
            scenario.onActivity { original = it }
            setAuthor(author)
            waitFor("ticket shutter for link") { clickable("Sacar ticket")?.isEnabled == true }
            clickable("Sacar ticket")!!.performAction(AccessibilityNodeInfo.ACTION_CLICK)
            waitFor("ticket saved before link") { application.repository.dao.draft()?.author == author }
            ticket = application.repository.dao.draft()!!
            bytes = File(ticket!!.ticketPath).readBytes()
            waitFor("bag shutter before link") { clickable("Sacar bolsa")?.isEnabled == true }
            clickable("Envíos")!!.performAction(AccessibilityNodeInfo.ACTION_CLICK)
            waitFor("queue before link") { findText("Sacar bolsa") == null }
            application.startActivity(link)
            waitFor("warm link resumes bag") { clickable("Sacar bolsa")?.isEnabled == true }
            scenario.onActivity { assertSame("The link must reuse the existing activity", original, it) }
            assertEquals(ticket!!.id, application.repository.dao.draft()?.id)
            assertEquals(author, application.repository.dao.draft()?.author)
            assertArrayEquals(bytes, File(ticket!!.ticketPath).readBytes())
        }
        ActivityScenario.launch<MainActivity>(link).use {
            waitFor("cold link recovers bag") { clickable("Sacar bolsa")?.isEnabled == true }
            assertEquals(ticket!!.id, application.repository.dao.draft()?.id)
            assertEquals(author, application.repository.dao.draft()?.author)
            assertArrayEquals(bytes, File(ticket!!.ticketPath).readBytes())
        }
        assertTrue(Diagnostics.export(application).readText().contains("web.camera.open"))
    }

    @Test fun rearLensChooserRemainsAvailableWithoutChangingSavedCaptures() {
        android.os.ParcelFileDescriptor.AutoCloseInputStream(instrumentation.uiAutomation.executeShellCommand("pm grant ${application.packageName} ${Manifest.permission.CAMERA}"))
            .bufferedReader().use { it.readText() }
        val before = application.repository.dao.pending().map { it.id }.toSet()
        ActivityScenario.launch(MainActivity::class.java).use {
            val author = "QA lentes"
            setAuthor(author)
            waitFor("lens selector") { clickable("Lentes")?.isEnabled == true }
            clickable("Lentes")!!.performAction(AccessibilityNodeInfo.ACTION_CLICK)
            waitFor("rear lens choices") { findText("Cámaras traseras") != null && clickable("Principal · 1×") != null }
            screenshot("lens-choices.png")
            clickable("Principal · 1×")!!.performAction(AccessibilityNodeInfo.ACTION_CLICK)
            waitFor("ready after selecting principal") { clickable("Sacar ticket")?.isEnabled == true }
            assertEquals(before, application.repository.dao.pending().map { row -> row.id }.toSet())
            val diagnostic = Diagnostics.export(application).readText()
            val inventory = org.json.JSONObject(diagnostic).getJSONObject("cameras")
            assertTrue(inventory.getInt("rearLogicalCount") > 0)
            assertTrue(inventory.getJSONArray("lenses").length() > 0)
            assertFalse(diagnostic.contains(author))
        }
    }

    @Test fun pendingUpdateStaysVisibleOfflineWithoutChangingSavedCaptures() {
        assertTrue(BuildConfig.DEBUG)
        val prefs = application.getSharedPreferences("app-updates", android.content.Context.MODE_PRIVATE)
        val previous = prefs.getString("manifest", null)
        val ids = application.repository.dao.pending().map { it.id }.toSet()
        prefs.edit().putString("manifest", org.json.JSONObject().put("versionCode", 999)
            .put("versionName", "prueba futura").put("downloadUrl", "https://github.com/Lukikitas/foto-app/releases/download/test/test.apk").toString()).commit()
        try {
            ActivityScenario.launch(MainActivity::class.java).use {
                setAuthor("QA actualización")
                waitFor("pending update banner") { findText("Actualización pendiente · prueba futura") != null }
                assertTrue(clickable("Actualizar")!!.isEnabled)
                assertEquals(ids, application.repository.dao.pending().map { row -> row.id }.toSet())
                val screenshot = instrumentation.uiAutomation.takeScreenshot()
                File(application.cacheDir, "update-screen.png").outputStream().use { output -> screenshot.compress(android.graphics.Bitmap.CompressFormat.PNG, 100, output) }
                screenshot.recycle()
            }
        } finally {
            prefs.edit().apply { if (previous == null) remove("manifest") else putString("manifest", previous) }.commit()
        }
    }

    @Test fun cameraSavesTicketAndBagAndQueuesThePairWithoutWaitingForNetwork() {
        // This test must never send synthetic photos to the real backend.
        assertTrue(BuildConfig.DEBUG)
        assertEquals("https://android-test.invalid", BuildConfig.SUPABASE_URL)
        val packageName = application.packageName
        android.os.ParcelFileDescriptor.AutoCloseInputStream(instrumentation.uiAutomation.executeShellCommand("pm grant $packageName ${Manifest.permission.CAMERA}"))
            .bufferedReader().use { it.readText() }
        ActivityScenario.launch(MainActivity::class.java).use {
            val author = "QA-${UUID.randomUUID().toString().take(8)}"
            setAuthor(author)
            waitFor("ready shutter") { clickable("Sacar ticket")?.isEnabled == true }
            waitFor("ticket stage") { findText("Foto del ticket · paso 1 de 2") != null }
            val flash = android.graphics.Rect()
            val initialScreen = android.graphics.Rect()
            findText("Flash")!!.getBoundsInScreen(flash)
            instrumentation.uiAutomation.rootInActiveWindow!!.getBoundsInScreen(initialScreen)
            assertTrue("Flash must be at the lower right", flash.centerX() > initialScreen.left + initialScreen.width() * .7f && flash.top > initialScreen.top + initialScreen.height() * .75f)
            assertTrue("Flash must remain on screen", flash.bottom <= initialScreen.bottom)
            screenshot("ticket-stage.png")
            assertTrue(clickable("Sacar ticket")!!.performAction(AccessibilityNodeInfo.ACTION_CLICK))
            waitFor("durable incomplete ticket") { application.repository.dao.draft()?.author == author }
            val ticket = application.repository.dao.draft()!!
            assertTrue(File(ticket.ticketPath).length() > 0)
            waitFor("bag shutter") { clickable("Sacar bolsa")?.isEnabled == true }
            waitFor("bag stage") { findText("Foto de la bolsa · paso 2 de 2") != null }
            screenshot("bag-stage.png")
            assertTrue(clickable("Sacar bolsa")!!.performAction(AccessibilityNodeInfo.ACTION_CLICK))
            waitFor("durable complete pair") { application.repository.dao.get(ticket.id)?.evidencePath?.isNotBlank() == true }
            val pair = application.repository.dao.get(ticket.id)!!
            assertEquals(author, pair.author)
            assertTrue(File(pair.evidencePath).length() > 0)
            assertTrue(File(pair.ticketPath).length() > 0)
            assertTrue(pair.photoId.isBlank())
            assertFalse(pair.ticketStored)
            assertNotEquals("SENT", pair.state)
            waitFor("next shutter after a completed pair") { clickable("Sacar ticket")?.isEnabled == true }
            val shutterBounds = android.graphics.Rect()
            val screenBounds = android.graphics.Rect()
            clickable("Sacar ticket")!!.getBoundsInScreen(shutterBounds)
            instrumentation.uiAutomation.rootInActiveWindow!!.getBoundsInScreen(screenBounds)
            assertTrue("The next shutter must stay on screen", shutterBounds.bottom <= screenBounds.bottom && shutterBounds.height() > 0)
        }
    }
    @Test fun switchingBetweenCameraAndQueueRestoresAReadyShutter() {
        assertTrue(BuildConfig.DEBUG)
        android.os.ParcelFileDescriptor.AutoCloseInputStream(instrumentation.uiAutomation.executeShellCommand("pm grant ${application.packageName} ${Manifest.permission.CAMERA}"))
            .bufferedReader().use { it.readText() }
        ActivityScenario.launch(MainActivity::class.java).use {
            setAuthor("QA navegación")
            repeat(3) {
                waitFor("camera ready before navigation") { clickable("Sacar ticket")?.isEnabled == true }
                assertTrue(clickable("Envíos")!!.performAction(AccessibilityNodeInfo.ACTION_CLICK))
                waitFor("capture view removed") { findText("Sacar ticket") == null }
                assertTrue(clickable("Cámara")!!.performAction(AccessibilityNodeInfo.ACTION_CLICK))
            }
            waitFor("camera ready after navigation") { clickable("Sacar ticket")?.isEnabled == true }
        }
    }
    @Test fun thirtyContinuousPairsStayDurableWithoutWaitingForUploads() {
        assertEquals("https://android-test.invalid", BuildConfig.SUPABASE_URL)
        android.os.ParcelFileDescriptor.AutoCloseInputStream(instrumentation.uiAutomation.executeShellCommand("pm grant ${application.packageName} ${Manifest.permission.CAMERA}"))
            .bufferedReader().use { it.readText() }
        val latencies = org.json.JSONArray()
        val memory = org.json.JSONArray().put(android.os.Debug.getPss())
        ActivityScenario.launch(MainActivity::class.java).use {
            val author = "QA-stress-${UUID.randomUUID().toString().take(8)}"
            setAuthor(author)
            repeat(30) { index ->
                waitFor("ticket shutter $index") { clickable("Sacar ticket")?.isEnabled == true }
                var started = android.os.SystemClock.elapsedRealtime()
                assertTrue(clickable("Sacar ticket")!!.performAction(AccessibilityNodeInfo.ACTION_CLICK))
                waitFor("saved ticket $index") { application.repository.dao.draft()?.author == author }
                latencies.put(android.os.SystemClock.elapsedRealtime() - started)
                val ticket = application.repository.dao.draft()!!
                waitFor("bag shutter $index") { clickable("Sacar bolsa")?.isEnabled == true }
                started = android.os.SystemClock.elapsedRealtime()
                assertTrue(clickable("Sacar bolsa")!!.performAction(AccessibilityNodeInfo.ACTION_CLICK))
                waitFor("saved bag $index") { application.repository.dao.get(ticket.id)?.evidencePath?.isNotBlank() == true }
                latencies.put(android.os.SystemClock.elapsedRealtime() - started)
                val pair = application.repository.dao.get(ticket.id)!!
                assertTrue(File(pair.ticketPath).length() > 0)
                assertTrue(File(pair.evidencePath).length() > 0)
                assertTrue(pair.photoId.isBlank())
                if ((index + 1) % 10 == 0) memory.put(android.os.Debug.getPss())
            }
            waitFor("next shutter after continuous capture") { clickable("Sacar ticket")?.isEnabled == true }
        }
        File(application.cacheDir, "capture-stress.json").writeText(org.json.JSONObject()
            .put("pairs", 30).put("captureMs", latencies).put("pssKiB", memory)
            .put("scope", "emulator-debug-offline-capture; not physical device or upload/OCR benchmark").toString(2))
    }
}
