package app.deliverystar.capture

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject
import java.io.File

object Diagnostics {
    @Synchronized fun record(context: Context, event: String, status: Int = 0, duration: Long = 0) {
        // Event names are fixed at call sites. No raw exceptions, URLs or OCR text.
        runCatching {
            val prefs = context.getSharedPreferences("diagnostics", Context.MODE_PRIVATE)
            val old = JSONArray(prefs.getString("events", "[]"))
            val next = JSONArray()
            for (i in maxOf(0, old.length() - 148) until old.length()) next.put(old.get(i))
            next.put(JSONObject().put("event", event).put("at", System.currentTimeMillis()).put("status", status).put("duration", duration))
            prefs.edit().putString("events", next.toString()).commit()
        }
    }
    fun export(context: Context): File {
        val folder = File(context.filesDir, "diagnostics").apply { mkdirs() }
        return File(folder, "diagnostico-fotos.json").apply {
            writeText(JSONObject().put("version", BuildConfig.VERSION_NAME)
                .put("versionCode", BuildConfig.VERSION_CODE)
                .put("manufacturer", android.os.Build.MANUFACTURER).put("model", android.os.Build.MODEL)
                .put("androidApi", android.os.Build.VERSION.SDK_INT)
                .put("events", JSONArray(context.getSharedPreferences("diagnostics", Context.MODE_PRIVATE).getString("events", "[]"))).toString(2))
        }
    }
}
