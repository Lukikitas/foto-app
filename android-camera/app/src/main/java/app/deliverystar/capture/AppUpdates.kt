package app.deliverystar.capture

import android.content.Context
import okhttp3.OkHttpClient
import okhttp3.Request
import org.json.JSONObject
import java.util.concurrent.TimeUnit

data class AppUpdate(val code: Int, val name: String, val url: String)

object AppUpdates {
    private val http = OkHttpClient.Builder().callTimeout(8, TimeUnit.SECONDS).build()
    fun parse(text: String, installed: Int = BuildConfig.VERSION_CODE): AppUpdate? {
        val data = JSONObject(text)
        val code = data.getInt("versionCode")
        val name = data.getString("versionName").take(48)
        val url = data.getString("downloadUrl")
        require(url.startsWith("https://github.com/Lukikitas/foto-app/releases/download/") && url.endsWith(".apk"))
        return if (code > installed) AppUpdate(code, name, url) else null
    }
    fun cached(context: Context): AppUpdate? = runCatching {
        parse(context.getSharedPreferences("app-updates", Context.MODE_PRIVATE).getString("manifest", "{}")!!)
    }.getOrNull()
    fun check(context: Context): AppUpdate? {
        val request = Request.Builder().url(BuildConfig.WEB_URL + "/manual/piloto-android/update.json")
            .header("Cache-Control", "no-cache").build()
        val text = http.newCall(request).execute().use { response ->
            check(response.isSuccessful) { "No se pudo comprobar la actualización." }
            val reader = response.body!!.charStream()
            val buffer = CharArray(1024)
            val output = StringBuilder()
            while (true) {
                val count = reader.read(buffer)
                if (count < 0) break
                require(output.length + count <= 16_384)
                output.append(buffer, 0, count)
            }
            output.toString()
        }
        val update = parse(text)
        context.getSharedPreferences("app-updates", Context.MODE_PRIVATE).edit().putString("manifest", text).apply()
        return update
    }
}
