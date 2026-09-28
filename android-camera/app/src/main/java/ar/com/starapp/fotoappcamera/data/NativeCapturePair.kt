package ar.com.starapp.fotoappcamera.data

import androidx.room.Entity
import androidx.room.Index
import androidx.room.PrimaryKey

@Entity(
    tableName = "native_capture_pairs",
    indices = [
        Index(value = ["sessionId", "pairNumber"], unique = true),
        Index(value = ["uploadState"])
    ]
)
data class NativeCapturePair(
    @PrimaryKey(autoGenerate = true)
    val localId: Long = 0,
    val sessionId: String,
    val pairNumber: Int,
    val takenBy: String,
    val ticketFilePath: String,
    val evidenceFilePath: String,
    val ticketHash: String? = null,
    val evidenceHash: String? = null,
    val selectedLens: String? = null,
    val createdAt: Long = System.currentTimeMillis(),
    val updatedAt: Long = System.currentTimeMillis(),
    val uploadState: String = STATE_LOCAL,
    val retryCount: Int = 0,
    val remoteTicketPath: String? = null,
    val remoteEvidencePath: String? = null,
    val errorMessage: String? = null
) {
    companion object {
        const val STATE_LOCAL = "local"
        const val STATE_PREPARING = "preparing"
        const val STATE_UPLOADING = "uploading"
        const val STATE_UPLOADED = "uploaded"
        const val STATE_IMPORTED = "imported"
        const val STATE_ERROR = "error"
        const val STATE_ERROR_PERMANENT = "error_permanent"
        const val STATE_DISCARDED = "discarded"
    }
}
