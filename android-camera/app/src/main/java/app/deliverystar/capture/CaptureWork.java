package app.deliverystar.capture;

import androidx.annotation.NonNull;

/** Work scheduling never loads image paths or OCR text for the whole queue. */
public class CaptureWork {
    @NonNull public String id = "";
    @NonNull public String state = "";
    public long reviewUntil;
}
