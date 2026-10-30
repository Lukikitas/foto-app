package app.deliverystar.capture;

import androidx.room.Database;
import androidx.room.RoomDatabase;

@Database(entities = {Capture.class}, version = 1, exportSchema = true)
public abstract class CaptureDatabase extends RoomDatabase {
    public abstract CaptureDao captures();
}
