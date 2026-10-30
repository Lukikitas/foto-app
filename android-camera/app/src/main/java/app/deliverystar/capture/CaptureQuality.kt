package app.deliverystar.capture

import android.graphics.Bitmap

object CaptureQuality {
    // Same inexpensive advisory thresholds as the web. Never rejects or
    // discards an image; the operator can inspect it and choose Repetir.
    fun score(pixels: IntArray, width: Int, height: Int, ticket: Boolean): String {
        if (width < 3 || height < 3 || pixels.size != width * height) return ""
        val gray = FloatArray(pixels.size)
        var brightness = 0.0
        var brightBorder = 0
        var borderCount = 0
        for (y in 0 until height) for (x in 0 until width) {
            val index = y * width + x
            val pixel = pixels[index]
            val value = ((pixel shr 16 and 255) * 0.299 + (pixel shr 8 and 255) * 0.587 + (pixel and 255) * 0.114).toFloat()
            gray[index] = value; brightness += value
            if (x < width * 0.025 || x >= width * 0.975 || y < height * 0.025 || y >= height * 0.975) {
                borderCount++; if (value > 205) brightBorder++
            }
        }
        var energy = 0.0
        var count = 0
        for (y in 1 until height - 1 step 2) for (x in 1 until width - 1 step 2) {
            val index = y * width + x
            val laplacian = 4 * gray[index] - gray[index - 1] - gray[index + 1] - gray[index - width] - gray[index + width]
            energy += laplacian * laplacian; count++
        }
        return when {
            brightness / pixels.size < 52 -> "La foto salió oscura. Probá con flash o más luz."
            energy / maxOf(1, count) < 90 -> "La foto podría estar movida. Revisala antes de seguir."
            ticket && brightBorder.toDouble() / maxOf(1, borderCount) > 0.23 -> "El ticket podría estar cortado. Revisá que se vea el código completo."
            else -> ""
        }
    }
    fun inspect(path: String, ticket: Boolean): String {
        val source = ImageFiles.thumbnail(path, 160) ?: return ""
        var scaled: Bitmap? = null
        return try {
            val sample = Bitmap.createScaledBitmap(source, 160, 120, true).also { scaled = it }
            val pixels = IntArray(160 * 120)
            sample.getPixels(pixels, 0, 160, 0, 0, 160, 120)
            score(pixels, 160, 120, ticket)
        } finally { scaled?.takeIf { it !== source }?.recycle(); source.recycle() }
    }
}
