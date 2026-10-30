package app.deliverystar.capture

object LensGeometry {
    fun relativeZoom(focal: Float, width: Float, normalFocal: Float, normalWidth: Float): Float {
        if (listOf(focal, width, normalFocal, normalWidth).any { !it.isFinite() || it <= 0f }) return 0f
        return (focal / width) / (normalFocal / normalWidth)
    }
}
