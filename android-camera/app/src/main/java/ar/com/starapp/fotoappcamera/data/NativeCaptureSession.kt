package ar.com.starapp.fotoappcamera.data

import androidx.room.Entity
import androidx.room.PrimaryKey

@Entity(tableName = "native_capture_sessions")
data class NativeCaptureSession(
    @PrimaryKey
    val sessionId: String,
    val sessionToken: String,
    val tokenHash: String,
    val takenBy: String,
    val protocolVersion: Int = 1,
    val createdAt: Long = System.currentTimeMillis(),
    val state: String = STATE_ACTIVE,
    val totalPairs: Int = 0,
    val pendingPairs: Int = 0,
    val uploadedPairs: Int = 0
) {
    companion object {
        const val STATE_CREATED = "created"
        const val STATE_ACTIVE = "active"
        const val STATE_FINISHING = "finishing"
        const val STATE_COMPLETED = "completed"
        const val STATE_CANCELLED = "cancelled"
        const val STATE_EXPIRED = "expired"
    }
}
