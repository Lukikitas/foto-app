package app.deliverystar.capture

import java.net.URI

/** Navigation route only. A plain author name may arrive in a separate typed extra. */
object CaptureLink {
    const val AUTHOR_EXTRA = "capture_author"
    fun normalizeAuthor(value: String?): String = value.orEmpty().trim().replace(Regex("\\s+"), " ")
        .filterNot { it.isISOControl() }.take(80)
    fun matches(action: String?, rawUri: String?): Boolean {
        if (action != "android.intent.action.VIEW" || rawUri == null || rawUri.length > 256) return false
        return runCatching {
            val uri = URI(rawUri)
            uri.scheme == "deliverystar" && uri.rawAuthority == "capture" &&
                uri.path in listOf("", "/") && uri.rawQuery == null && uri.rawFragment == null
        }.getOrDefault(false)
    }
}
