package app.deliverystar.capture

import java.net.URI

/** A navigation request only. Never accepts authors, photos, URLs or commands. */
object CaptureLink {
    fun matches(action: String?, rawUri: String?): Boolean {
        if (action != "android.intent.action.VIEW" || rawUri == null || rawUri.length > 256) return false
        return runCatching {
            val uri = URI(rawUri)
            uri.scheme == "deliverystar" && uri.rawAuthority == "capture" &&
                uri.path in listOf("", "/") && uri.rawQuery == null && uri.rawFragment == null
        }.getOrDefault(false)
    }
}
