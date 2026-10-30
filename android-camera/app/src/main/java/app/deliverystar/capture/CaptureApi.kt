package app.deliverystar.capture

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withContext
import okhttp3.Call
import okhttp3.Callback
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.MultipartBody
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody
import okhttp3.RequestBody.Companion.asRequestBody
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.Response
import org.json.JSONObject
import java.io.File
import java.io.IOException
import java.time.Instant
import java.util.concurrent.TimeUnit
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException

class ApiFailure(val status: Int) : IOException("HTTP $status") {
    val retryable get() = status == 0 || status in listOf(408, 425, 429) || status >= 500
}

class CaptureApi(
    private val base: String = BuildConfig.SUPABASE_URL,
    private val key: String = BuildConfig.SUPABASE_ANON_KEY,
    private val client: OkHttpClient = sharedHttp
) {
    companion object {
        private val sharedHttp = OkHttpClient.Builder().connectTimeout(15, TimeUnit.SECONDS)
            .readTimeout(45, TimeUnit.SECONDS).writeTimeout(45, TimeUnit.SECONDS)
            .callTimeout(60, TimeUnit.SECONDS).retryOnConnectionFailure(false).build()
    }
    suspend fun request(path: String, body: RequestBody, method: String = "POST", extraHeaders: Map<String, String> = emptyMap()): Pair<Int, String> {
        check(base.startsWith("https://") || BuildConfig.DEBUG && base.startsWith("http://127.0.0.1")) { "Falta configurar la conexión de esta instalación." }
        check(key.isNotBlank()) { "Falta configurar la conexión de esta instalación." }
        val builder = Request.Builder().url(base.trimEnd('/') + path).header("apikey", key)
            .header("Authorization", "Bearer $key").method(method, body)
        extraHeaders.forEach { (name, value) -> builder.header(name, value) }
        val call = client.newCall(builder.build())
        // Consume the body inside the cancellable callback, keeping OkHttp's
        // call deadline active through a stalled JSON response.
        return suspendCancellableCoroutine { continuation ->
            continuation.invokeOnCancellation { call.cancel() }
            call.enqueue(object : Callback {
                override fun onFailure(call: Call, e: IOException) { if (continuation.isActive) continuation.resumeWithException(e) }
                override fun onResponse(call: Call, response: Response) {
                    try {
                        val result = response.use { it.code to (it.body?.string() ?: "") }
                        if (continuation.isActive) continuation.resume(result)
                    } catch (e: IOException) { if (continuation.isActive) continuation.resumeWithException(e) }
                }
            })
        }
    }
    suspend fun uploadEvidence(row: Capture, file: File) {
        val (status, text) = request("/storage/v1/object/photos/orders/mobile/${row.id}.jpg", file.asRequestBody("image/jpeg".toMediaType()))
        // This UUID path is immutable. A duplicate confirms an earlier upload
        // whose acknowledgement was lost; never upsert/rewrite that evidence.
        val duplicate = status == 409 || (status == 400 && runCatching { JSONObject(text).optString("error") == "Duplicate" }.getOrDefault(false))
        if (status !in 200..299 && !duplicate) throw ApiFailure(status)
    }
    suspend fun register(row: Capture): JSONObject {
        val payload = JSONObject().put("captureId", row.id).put("takenBy", row.author)
            .put("capturedAt", Instant.ofEpochMilli(row.createdAt).toString()).put("ocrText", row.ocrText)
        val (status, text) = request("/functions/v1/capture-sync", payload.toString().toRequestBody("application/json".toMediaType()))
        if (status !in 200..299) throw ApiFailure(status)
        return JSONObject(text).getJSONObject("photo").also { check(it.optString("id").isNotBlank()) }
    }
    suspend fun uploadTicket(photoId: String, file: File): Boolean {
        val body = MultipartBody.Builder().setType(MultipartBody.FORM).addFormDataPart("photoId", photoId)
            .addFormDataPart("ticket", "ticket.jpg", file.asRequestBody("image/jpeg".toMediaType())).build()
        val (status, text) = request("/functions/v1/order-code-recovery", body)
        if (status !in 200..299) throw ApiFailure(status)
        return JSONObject(text).optBoolean("stored")
    }
}
