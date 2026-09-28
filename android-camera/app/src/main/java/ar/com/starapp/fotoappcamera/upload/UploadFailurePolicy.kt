package ar.com.starapp.fotoappcamera.upload

import ar.com.starapp.fotoappcamera.data.ApiHttpException

/** Only failures that may recover without changing the capture should hold the work chain. */
fun shouldRetryUploadFailure(error: Throwable): Boolean = when (error) {
    is ApiHttpException -> error.statusCode == 408 || error.statusCode == 429 || error.statusCode in 500..599
    is java.io.FileNotFoundException -> false
    else -> true
}
