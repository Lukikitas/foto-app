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
import org.junit.runner.RunWith
import java.io.File
import java.util.UUID

@RunWith(AndroidJUnit4::class)
class CameraFlowTest {
    private val instrumentation = InstrumentationRegistry.getInstrumentation()
    private val application = ApplicationProvider.getApplicationContext<CaptureApplication>()
    private fun waitFor(label: String, predicate: () -> Boolean) {
        val deadline = System.currentTimeMillis() + 25_000
        while (System.currentTimeMillis() < deadline) {
            if (predicate()) return
            Thread.sleep(150)
        }
        fail("Timed out: $label; UI=${describe(instrumentation.uiAutomation.rootInActiveWindow).take(5000)}")
    }
    // Compose exposes virtual accessibility descendants; Android's native
    // find-by-text shortcut does not traverse all provider implementations.
    private fun findText(text: String, root: AccessibilityNodeInfo? = instrumentation.uiAutomation.rootInActiveWindow): AccessibilityNodeInfo? {
        if (root == null) return null
        if (root.text?.toString() == text) return root
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

    @Test fun cameraSavesTicketAndBagAndQueuesThePairWithoutWaitingForNetwork() {
        // This test must never send synthetic photos to the real backend.
        assertTrue(BuildConfig.DEBUG)
        assertEquals("https://android-test.invalid", BuildConfig.SUPABASE_URL)
        val packageName = application.packageName
        android.os.ParcelFileDescriptor.AutoCloseInputStream(instrumentation.uiAutomation.executeShellCommand("pm grant $packageName ${Manifest.permission.CAMERA}"))
            .bufferedReader().use { it.readText() }
        ActivityScenario.launch(MainActivity::class.java).use {
            val author = "QA-${UUID.randomUUID().toString().take(8)}"
            waitFor("author field") { editable(instrumentation.uiAutomation.rootInActiveWindow) != null }
            editable(instrumentation.uiAutomation.rootInActiveWindow)!!.performAction(AccessibilityNodeInfo.ACTION_SET_TEXT,
                Bundle().apply { putCharSequence(AccessibilityNodeInfo.ACTION_ARGUMENT_SET_TEXT_CHARSEQUENCE, author) })
            waitFor("ready shutter") { clickable("Sacar ticket")?.isEnabled == true }
            assertTrue(clickable("Sacar ticket")!!.performAction(AccessibilityNodeInfo.ACTION_CLICK))
            waitFor("durable incomplete ticket") { application.repository.dao.draft()?.author == author }
            val ticket = application.repository.dao.draft()!!
            assertTrue(File(ticket.ticketPath).length() > 0)
            waitFor("bag shutter") { clickable("Sacar bolsa")?.isEnabled == true }
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
            waitFor("author field for continuous capture") { editable(instrumentation.uiAutomation.rootInActiveWindow) != null }
            val author = "QA-stress-${UUID.randomUUID().toString().take(8)}"
            editable(instrumentation.uiAutomation.rootInActiveWindow)!!.performAction(AccessibilityNodeInfo.ACTION_SET_TEXT,
                Bundle().apply { putCharSequence(AccessibilityNodeInfo.ACTION_ARGUMENT_SET_TEXT_CHARSEQUENCE, author) })
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
