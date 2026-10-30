package app.deliverystar.capture

import android.app.Application
import androidx.room.Room
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch

class CaptureApplication : Application() {
    val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    val database by lazy { Room.databaseBuilder(this, CaptureDatabase::class.java, "captures.db").build() }
    val repository by lazy { CaptureRepository(this, database.captures()) }
    override fun onCreate() {
        super.onCreate()
        val previous = Thread.getDefaultUncaughtExceptionHandler()
        Thread.setDefaultUncaughtExceptionHandler { thread, error ->
            Diagnostics.record(this, "process.crash")
            previous?.uncaughtException(thread, error)
        }
        scope.launch { runCatching { repository.recover() }.onFailure { Diagnostics.record(this@CaptureApplication, "queue.recovery.failed") } }
    }
}
