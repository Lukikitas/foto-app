# ProGuard rules for Foto-app Camera
-keepattributes *Annotation*
-keepclassmembers class * {
    @androidx.room.* *;
}
-dontwarn okhttp3.**
-dontwarn okio.**
