package ar.com.starapp.fotoappcamera.data

import androidx.room.Dao
import androidx.room.Delete
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import androidx.room.Update
import kotlinx.coroutines.flow.Flow

@Dao
interface CaptureDao {

    // --- Session Queries ---

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertSession(session: NativeCaptureSession)

    @Update
    suspend fun updateSession(session: NativeCaptureSession)

    @Query("SELECT * FROM native_capture_sessions WHERE sessionId = :sessionId LIMIT 1")
    suspend fun getSession(sessionId: String): NativeCaptureSession?

    @Query("SELECT * FROM native_capture_sessions WHERE state IN ('active', 'finishing') ORDER BY createdAt DESC LIMIT 1")
    fun getActiveSessionFlow(): Flow<NativeCaptureSession?>

    @Query("SELECT * FROM native_capture_sessions WHERE state IN ('active', 'finishing') ORDER BY createdAt DESC LIMIT 1")
    suspend fun getActiveSession(): NativeCaptureSession?

    // --- Pair Queries ---

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertPair(pair: NativeCapturePair): Long

    @Update
    suspend fun updatePair(pair: NativeCapturePair)

    @Query("SELECT * FROM native_capture_pairs WHERE sessionId = :sessionId ORDER BY pairNumber ASC")
    fun getPairsForSession(sessionId: String): Flow<List<NativeCapturePair>>

    @Query("SELECT * FROM native_capture_pairs WHERE sessionId = :sessionId ORDER BY pairNumber ASC")
    suspend fun getPairsForSessionSync(sessionId: String): List<NativeCapturePair>

    @Query("SELECT * FROM native_capture_pairs WHERE sessionId = :sessionId AND uploadState IN ('local', 'preparing', 'uploading', 'error') ORDER BY pairNumber ASC")
    suspend fun getPendingUploadPairs(sessionId: String): List<NativeCapturePair>

    @Query("SELECT COUNT(*) FROM native_capture_pairs WHERE sessionId = :sessionId")
    fun getTotalPairsCount(sessionId: String): Flow<Int>

    @Query("SELECT COUNT(*) FROM native_capture_pairs WHERE sessionId = :sessionId AND uploadState IN ('local', 'preparing', 'uploading', 'error')")
    fun getPendingPairsCount(sessionId: String): Flow<Int>

    @Query("SELECT COUNT(*) FROM native_capture_pairs WHERE sessionId = :sessionId AND uploadState = 'error'")
    fun getErrorPairsCount(sessionId: String): Flow<Int>

    @Query("SELECT COUNT(*) FROM native_capture_pairs WHERE sessionId = :sessionId AND uploadState IN ('uploaded', 'imported')")
    fun getUploadedPairsCount(sessionId: String): Flow<Int>

    @Query("SELECT MAX(pairNumber) FROM native_capture_pairs WHERE sessionId = :sessionId")
    suspend fun getMaxPairNumber(sessionId: String): Int?

    @Delete
    suspend fun deletePair(pair: NativeCapturePair)

    @Query("DELETE FROM native_capture_pairs WHERE sessionId = :sessionId")
    suspend fun deletePairsForSession(sessionId: String)
}
