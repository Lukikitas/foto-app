package app.deliverystar.capture

object LensGeometry {
    // Logical cameras can report several focal lengths. The first is the
    // advertised default, whereas min() may already be the ultra-wide lens.
    fun defaultFocal(lengths: FloatArray?) = lengths?.firstOrNull { it.isFinite() && it > 0f } ?: 0f

    fun effectiveSensorSpan(width: Float, height: Float, rotation: Int,
        activeWidth: Int, activeHeight: Int, pixelWidth: Int, pixelHeight: Int): Float {
        val vertical = rotation % 180 != 0
        val span = if (vertical) height else width
        val active = if (vertical) activeHeight else activeWidth
        val pixels = if (vertical) pixelHeight else pixelWidth
        return if (active > 0 && pixels >= active) span * active / pixels else span
    }

    fun resolvedZoom(reported: Float, focal: Float, span: Float, normalFocal: Float, normalSpan: Float): Float {
        val measured = relativeZoom(focal, span, normalFocal, normalSpan)
        return if (measured > 0f) measured else reported.takeIf { it.isFinite() && it > 0f } ?: 0f
    }

    fun relativeZoom(focal: Float, width: Float, normalFocal: Float, normalWidth: Float): Float {
        if (listOf(focal, width, normalFocal, normalWidth).any { !it.isFinite() || it <= 0f }) return 0f
        return (focal / width) / (normalFocal / normalWidth)
    }
}
