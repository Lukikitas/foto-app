package ar.com.starapp.fotoappcamera.data

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.asRequestBody
import okhttp3.RequestBody.Companion.toRequestBody
import java.io.File
import java.io.FileInputStream
import java.security.MessageDigest
import java.util.concurrent.TimeUnit

class ApiHttpException(val statusCode: Int, message: String) : Exception(message)

class SupabaseApiClient(
    private val baseUrl: String = DEFAULT_BASE_URL,
    private val anonKey: String = DEFAULT_ANON_KEY,
    private val client: OkHttpClient = defaultHttpClient()
) {
    companion object {
        const val DEFAULT_BASE_URL = "https://jngwzemzllyohrywzxew.supabase.co"
        const val DEFAULT_ANON_KEY = "sb_publishable_BhqqLWLK9aTa_75c__nNGQ_V1yLlzeu"
        const val BUCKET_NAME = "native-captures"

        private val JSON_MEDIA_TYPE = "application/json; charset=utf-8".toMediaType()
        private val JPEG_MEDIA_TYPE = "image/jpeg".toMediaType()

        private val json = Json { ignoreUnknownKeys = true }

        fun defaultHttpClient(): OkHttpClient {
            return OkHttpClient.Builder()
                .connectTimeout(30, TimeUnit.SECONDS)
                .readTimeout(60, TimeUnit.SECONDS)
                .writeTimeout(60, TimeUnit.SECONDS)
                .retryOnConnectionFailure(true)
                .build()
        }

        fun calculateSha256(file: File): String {
            val digest = MessageDigest.getInstance("SHA-256")
            FileInputStream(file).use { fis ->
                val buffer = ByteArray(8192)
                var bytesRead: Int
                while (fis.read(buffer).also { bytesRead = it } != -1) {
                    digest.update(buffer, 0, bytesRead)
                }
            }
            return digest.digest().joinToString("") { "%02x".format(it) }
        }

        fun calculateSha256(text: String): String {
            val digest = MessageDigest.getInstance("SHA-256")
            val hash = digest.digest(text.toByteArray(Charsets.UTF_8))
            return hash.joinToString("") { "%02x".format(it) }
        }
    }

    suspend fun activateSession(
        sessionId: String,
        tokenHash: String,
        appVersion: String,
        deviceModel: String
    ): Result<JsonObject> = withContext(Dispatchers.IO) {
        try {
            val bodyJson = buildJsonObject {
                put("p_session_id", sessionId)
                put("p_token_hash", tokenHash)
                put("p_native_app_version", appVersion)
                put("p_device_model", deviceModel)
            }.toString()

            val request = Request.Builder()
                .url("$baseUrl/rest/v1/rpc/activate_native_capture_session")
                .header("apikey", anonKey)
                .header("Authorization", "Bearer $anonKey")
                .header("Content-Type", "application/json")
                .post(bodyJson.toRequestBody(JSON_MEDIA_TYPE))
                .build()

            client.newCall(request).execute().use { response ->
                val responseBody = response.body?.string().orEmpty()
                if (!response.isSuccessful) {
                    Result.failure(Exception("Error activando sesión (${response.code}): $responseBody"))
                } else {
                    val parsed = json.decodeFromString<JsonObject>(responseBody)
                    Result.success(parsed)
                }
            }
        } catch (e: Exception) {
            Result.failure(e)
        }
    }

    suspend fun uploadCaptureFile(
        storagePath: String,
        file: File,
        sessionId: String,
        tokenHash: String,
        fileHash: String
    ): Result<String> = withContext(Dispatchers.IO) {
        try {
            val request = Request.Builder()
                .url("$baseUrl/functions/v1/native-camera-transfer")
                .header("apikey", anonKey)
                .header("x-session-id", sessionId)
                .header("x-token-hash", tokenHash)
                .header("x-storage-path", storagePath)
                .header("x-content-sha256", fileHash)
                .header("Content-Type", "image/jpeg")
                .post(file.asRequestBody(JPEG_MEDIA_TYPE))
                .build()

            client.newCall(request).execute().use { response ->
                val responseBody = response.body?.string().orEmpty()
                if (!response.isSuccessful) {
                    Result.failure(ApiHttpException(response.code, "Error al subir archivo a storage (${response.code}): $responseBody"))
                } else {
                    Result.success(storagePath)
                }
            }
        } catch (e: Exception) {
            Result.failure(e)
        }
    }

    suspend fun registerPair(
        sessionId: String,
        tokenHash: String,
        pairNumber: Int,
        ticketPath: String,
        evidencePath: String,
        ticketHash: String?,
        evidenceHash: String?,
        selectedLens: String?,
        metadata: JsonObject = buildJsonObject {}
    ): Result<JsonObject> = withContext(Dispatchers.IO) {
        try {
            val bodyJson = buildJsonObject {
                put("p_session_id", sessionId)
                put("p_token_hash", tokenHash)
                put("p_pair_number", pairNumber)
                put("p_ticket_path", ticketPath)
                put("p_evidence_path", evidencePath)
                ticketHash?.let { put("p_ticket_hash", it) }
                evidenceHash?.let { put("p_evidence_hash", it) }
                selectedLens?.let { put("p_selected_lens", it) }
                put("p_metadata", metadata)
            }.toString()

            val request = Request.Builder()
                .url("$baseUrl/rest/v1/rpc/register_native_capture_pair")
                .header("apikey", anonKey)
                .header("Authorization", "Bearer $anonKey")
                .header("Content-Type", "application/json")
                .post(bodyJson.toRequestBody(JSON_MEDIA_TYPE))
                .build()

            client.newCall(request).execute().use { response ->
                val responseBody = response.body?.string().orEmpty()
                if (!response.isSuccessful) {
                    Result.failure(ApiHttpException(response.code, "Error al registrar par (${response.code}): $responseBody"))
                } else {
                    val parsed = json.decodeFromString<JsonObject>(responseBody)
                    Result.success(parsed)
                }
            }
        } catch (e: Exception) {
            Result.failure(e)
        }
    }

    suspend fun finishSession(
        sessionId: String,
        tokenHash: String
    ): Result<JsonObject> = withContext(Dispatchers.IO) {
        try {
            val bodyJson = buildJsonObject {
                put("p_session_id", sessionId)
                put("p_token_hash", tokenHash)
            }.toString()

            val request = Request.Builder()
                .url("$baseUrl/rest/v1/rpc/finish_native_capture_session")
                .header("apikey", anonKey)
                .header("Authorization", "Bearer $anonKey")
                .header("Content-Type", "application/json")
                .post(bodyJson.toRequestBody(JSON_MEDIA_TYPE))
                .build()

            client.newCall(request).execute().use { response ->
                val responseBody = response.body?.string().orEmpty()
                if (!response.isSuccessful) {
                    Result.failure(Exception("Error al finalizar sesión (${response.code}): $responseBody"))
                } else {
                    val parsed = json.decodeFromString<JsonObject>(responseBody)
                    Result.success(parsed)
                }
            }
        } catch (e: Exception) {
            Result.failure(e)
        }
    }
}
