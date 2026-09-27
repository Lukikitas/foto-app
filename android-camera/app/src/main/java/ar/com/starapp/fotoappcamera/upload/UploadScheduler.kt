package ar.com.starapp.fotoappcamera.upload

import android.content.Context
import androidx.work.BackoffPolicy
import androidx.work.Constraints
import androidx.work.Data
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkManager
import java.util.concurrent.TimeUnit

object UploadScheduler {

    fun triggerUpload(context: Context, sessionId: String, tokenHash: String) {
        val constraints = Constraints.Builder()
            .setRequiredNetworkType(NetworkType.CONNECTED)
            .build()

        val inputData = Data.Builder()
            .putString(UploadWorker.KEY_SESSION_ID, sessionId)
            .putString(UploadWorker.KEY_TOKEN_HASH, tokenHash)
            .build()

        val request = OneTimeWorkRequestBuilder<UploadWorker>()
            .setConstraints(constraints)
            .setInputData(inputData)
            .setBackoffCriteria(
                BackoffPolicy.EXPONENTIAL,
                10,
                TimeUnit.SECONDS
            )
            .addTag("upload-$sessionId")
            .build()

        WorkManager.getInstance(context).enqueueUniqueWork(
            "upload_session_$sessionId",
            ExistingWorkPolicy.APPEND_OR_REPLACE,
            request
        )
    }

    fun cancelSessionUploads(context: Context, sessionId: String) {
        WorkManager.getInstance(context).cancelUniqueWork("upload_session_$sessionId")
    }
}
