package ar.com.starapp.fotoappcamera.camera

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Matrix
import androidx.exifinterface.media.ExifInterface
import java.io.File
import java.io.FileOutputStream

object ImageExifUtils {

    fun fixOrientationAndSave(sourceFile: File, destinationFile: File, jpegQuality: Int = 90): Boolean {
        return try {
            val exif = ExifInterface(sourceFile.absolutePath)
            val orientation = exif.getAttributeInt(
                ExifInterface.TAG_ORIENTATION,
                ExifInterface.ORIENTATION_NORMAL
            )

            val rotationDegrees = when (orientation) {
                ExifInterface.ORIENTATION_ROTATE_90 -> 90
                ExifInterface.ORIENTATION_ROTATE_180 -> 180
                ExifInterface.ORIENTATION_ROTATE_270 -> 270
                else -> 0
            }

            if (rotationDegrees == 0) {
                // Already upright, simply copy or retain
                if (sourceFile.absolutePath != destinationFile.absolutePath) {
                    sourceFile.copyTo(destinationFile, overwrite = true)
                }
                return true
            }

            val originalBitmap = BitmapFactory.decodeFile(sourceFile.absolutePath) ?: return false
            val matrix = Matrix().apply { postRotate(rotationDegrees.toFloat()) }
            val rotatedBitmap = Bitmap.createBitmap(
                originalBitmap,
                0,
                0,
                originalBitmap.width,
                originalBitmap.height,
                matrix,
                true
            )

            FileOutputStream(destinationFile).use { out ->
                rotatedBitmap.compress(Bitmap.CompressFormat.JPEG, jpegQuality, out)
            }

            if (rotatedBitmap != originalBitmap) {
                rotatedBitmap.recycle()
            }
            originalBitmap.recycle()
            true
        } catch (_: Exception) {
            false
        }
    }
}
