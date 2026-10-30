package app.deliverystar.capture

import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

class AppUpdatesTest {
    private fun manifest(code: Int, url: String = "https://github.com/Lukikitas/foto-app/releases/download/android-capture-pilot-v0.3.0/Delivery-Star-Fotos-0.3.0-pilot.apk") =
        JSONObject().put("versionCode", code).put("versionName", "0.3.0-pilot").put("downloadUrl", url).toString()
    @Test fun newerVersionProducesAnUpdateWithoutPromptingForInstalledOrOlderVersions() {
        assertEquals(3, AppUpdates.parse(manifest(3), 2)!!.code)
        assertNull(AppUpdates.parse(manifest(2), 2))
        assertNull(AppUpdates.parse(manifest(1), 2))
    }
    @Test fun updateCannotRedirectTheInstallerToAnotherSiteOrRepository() {
        for (url in listOf("http://github.com/Lukikitas/foto-app/releases/download/a/a.apk", "https://example.test/a.apk", "https://github.com/other/repo/releases/download/a/a.apk")) {
            try { AppUpdates.parse(manifest(3, url), 2); fail("Untrusted APK origin") } catch (_: IllegalArgumentException) { }
        }
    }
}
