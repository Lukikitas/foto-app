package app.deliverystar.capture

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Matrix
import androidx.exifinterface.media.ExifInterface
import java.io.File
import java.io.FileOutputStream

object ImageFiles {
    fun thumbnail(path: String, maxDimension: Int = 480): Bitmap? {
        if (path.isBlank()) return null
        val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        BitmapFactory.decodeFile(path, bounds)
        var sample = 1
        while (maxOf(bounds.outWidth, bounds.outHeight) / sample > maxDimension * 2) sample *= 2
        val bitmap = BitmapFactory.decodeFile(path, BitmapFactory.Options().apply { inSampleSize = sample }) ?: return null
        val exif = runCatching { ExifInterface(path) }.getOrNull() ?: return bitmap
        if (exif.rotationDegrees == 0 && !exif.isFlipped) return bitmap
        val matrix = Matrix().apply {
            if (exif.isFlipped) postScale(-1f, 1f)
            postRotate(exif.rotationDegrees.toFloat())
        }
        return Bitmap.createBitmap(bitmap, 0, 0, bitmap.width, bitmap.height, matrix, true).also { if (it !== bitmap) bitmap.recycle() }
    }
    fun prepare(original: File, destination: File, maxDimension: Int, quality: Int): File {
        val bitmap = thumbnail(original.path, maxDimension) ?: error("La foto guardada no se puede leer. Conservá el pendiente.")
        var resized: Bitmap? = null
        try {
            val scale = minOf(1f, maxDimension.toFloat() / maxOf(bitmap.width, bitmap.height))
            val output = if (scale < 1f) Bitmap.createScaledBitmap(bitmap,
                maxOf(1, (bitmap.width * scale).toInt()), maxOf(1, (bitmap.height * scale).toInt()), true).also { resized = it } else bitmap
            FileOutputStream(destination).use { stream ->
                check(output.compress(Bitmap.CompressFormat.JPEG, quality, stream))
                stream.fd.sync()
            }
            return destination
        } finally { resized?.takeIf { it !== bitmap }?.recycle(); bitmap.recycle() }
    }
}
