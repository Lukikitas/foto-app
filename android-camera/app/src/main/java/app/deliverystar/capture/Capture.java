package app.deliverystar.capture;

import androidx.annotation.NonNull;
import androidx.room.Entity;
import androidx.room.PrimaryKey;

@Entity(tableName = "captures")
public class Capture {
    @PrimaryKey @NonNull public String id = "";
    @NonNull public String author = "";
    public long createdAt;
    @NonNull public String ticketPath = "";
    @NonNull public String evidencePath = "";
    @NonNull public String state = "DRAFT";
    public long reviewUntil;
    public boolean evidenceStored;
    @NonNull public String photoId = "";
    @NonNull public String displayCode = "";
    public boolean ticketStored;
    public boolean ticketExpired;
    @NonNull public String ocrText = "";
    public boolean ocrAttempted;
    @NonNull public String error = "";
    public int attempts;
}
