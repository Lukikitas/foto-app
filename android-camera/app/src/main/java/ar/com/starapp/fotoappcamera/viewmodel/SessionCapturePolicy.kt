package ar.com.starapp.fotoappcamera.viewmodel

import ar.com.starapp.fotoappcamera.data.NativeCaptureSession

fun captureBlockReason(state: String, expiresAtMillis: Long?, nowMillis: Long): String? {
    if (state != NativeCaptureSession.STATE_ACTIVE) {
        return "Esta sesión ya terminó. Volvé a Foto-app para abrir una nueva."
    }
    if (expiresAtMillis != null && nowMillis >= expiresAtMillis) {
        return "La sesión venció (2 horas desde que se abrió en Foto-app). Volvé a Foto-app para iniciar otra."
    }
    return null
}
