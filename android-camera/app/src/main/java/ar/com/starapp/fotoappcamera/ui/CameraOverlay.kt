package ar.com.starapp.fotoappcamera.ui

import androidx.camera.core.ImageCapture
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import ar.com.starapp.fotoappcamera.camera.LensMode
import ar.com.starapp.fotoappcamera.ui.theme.DarkSurface
import ar.com.starapp.fotoappcamera.ui.theme.RedPrimary
import ar.com.starapp.fotoappcamera.ui.theme.TextMuted
import ar.com.starapp.fotoappcamera.ui.theme.TextWhite
import ar.com.starapp.fotoappcamera.ui.theme.YellowWarning
import ar.com.starapp.fotoappcamera.viewmodel.CaptureStep
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

@Composable
fun CameraOverlay(
    step: CaptureStep,
    takenBy: String,
    pairsCount: Int,
    pendingCount: Int,
    errorCount: Int,
    sessionExpiresAt: Long?,
    lensMode: LensMode,
    zoomRatio: Float,
    flashMode: Int,
    isTorchOn: Boolean,
    isOffline: Boolean,
    onCaptureClick: () -> Unit,
    onUsePhotoClick: () -> Unit,
    onRetakeClick: () -> Unit,
    onBackToTicketClick: () -> Unit,
    onLensModeToggle: (LensMode) -> Unit,
    onFlashToggle: () -> Unit,
    onTorchToggle: () -> Unit,
    onFinishClick: () -> Unit,
    onDiagnosticsClick: () -> Unit
) {
    val isReviewing = step == CaptureStep.REVIEW_TICKET || step == CaptureStep.REVIEW_EVIDENCE
    val isTicketStep = step == CaptureStep.READY_FOR_TICKET || step == CaptureStep.CAPTURING_TICKET || step == CaptureStep.REVIEW_TICKET

    Box(modifier = Modifier.fillMaxSize()) {
        // --- TOP BAR ---
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .background(Color(0x88000000))
                .padding(horizontal = 16.dp, vertical = 12.dp),
            verticalArrangement = Arrangement.spacedBy(6.dp)
        ) {
            // First row: Author, flash, torch, diagnostics
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically
            ) {
                Text(
                    text = "👤 ${takenBy.ifBlank { "Fotógrafo" }}",
                    color = TextWhite,
                    fontWeight = FontWeight.Bold,
                    fontSize = 15.sp
                )

                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    // Flash Mode Toggle
                    Button(
                        onClick = onFlashToggle,
                        colors = ButtonDefaults.buttonColors(containerColor = DarkSurface),
                        contentPadding = androidx.compose.foundation.layout.PaddingValues(horizontal = 8.dp, vertical = 4.dp),
                        modifier = Modifier.height(32.dp)
                    ) {
                        val flashIcon = when (flashMode) {
                            ImageCapture.FLASH_MODE_ON -> "⚡ ON"
                            ImageCapture.FLASH_MODE_AUTO -> "⚡ AUTO"
                            else -> "⚡ OFF"
                        }
                        Text(flashIcon, fontSize = 11.sp, color = TextWhite)
                    }

                    // Torch Toggle
                    Button(
                        onClick = onTorchToggle,
                        colors = ButtonDefaults.buttonColors(
                            containerColor = if (isTorchOn) RedPrimary else DarkSurface
                        ),
                        contentPadding = androidx.compose.foundation.layout.PaddingValues(horizontal = 8.dp, vertical = 4.dp),
                        modifier = Modifier.height(32.dp)
                    ) {
                        Text(if (isTorchOn) "🔦 ON" else "🔦 OFF", fontSize = 11.sp, color = TextWhite)
                    }

                    // Diagnostics button
                    Button(
                        onClick = onDiagnosticsClick,
                        colors = ButtonDefaults.buttonColors(containerColor = DarkSurface),
                        contentPadding = androidx.compose.foundation.layout.PaddingValues(horizontal = 8.dp, vertical = 4.dp),
                        modifier = Modifier.height(32.dp)
                    ) {
                        Text("ℹ️ Info", fontSize = 11.sp, color = TextWhite)
                    }
                }
            }

            // Second row: Step indicator and counters
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically
            ) {
                Text(
                    text = if (isTicketStep) "PASO 1 DE 2 · TICKET" else "PASO 2 DE 2 · PEDIDO",
                    color = if (isTicketStep) Color(0xFFFFD54F) else Color(0xFF81C784),
                    fontWeight = FontWeight.Bold,
                    fontSize = 13.sp
                )

                Text(
                    text = "Pares: $pairsCount${if (pendingCount > 0) " (subiendo $pendingCount)" else ""}",
                    color = TextMuted,
                    fontSize = 12.sp
                )
            }

            if (errorCount > 0) {
                Text(
                    text = "⚠️ $errorCount par(es) con error de subida. Aún no llegaron a la galería.",
                    color = YellowWarning,
                    fontSize = 12.sp,
                    fontWeight = FontWeight.SemiBold
                )
            }

            if (sessionExpiresAt != null) {
                val deadline = SimpleDateFormat("HH:mm", Locale.getDefault()).format(Date(sessionExpiresAt))
                Text(
                    text = "Sesión vence a las $deadline · 2 horas desde Foto-app",
                    color = YellowWarning,
                    fontSize = 12.sp
                )
            }

            // Offline indicator if disconnected
            if (isOffline) {
                Box(
                    modifier = Modifier
                        .fillMaxWidth()
                        .background(YellowWarning, RoundedCornerShape(4.dp))
                        .padding(horizontal = 8.dp, vertical = 2.dp)
                ) {
                    Text(
                        text = "Sin conexión · Las fotos se guardan en el teléfono",
                        color = Color.Black,
                        fontSize = 11.sp,
                        fontWeight = FontWeight.SemiBold,
                        textAlign = TextAlign.Center,
                        modifier = Modifier.fillMaxWidth()
                    )
                }
            }
        }

        // --- FRAMING GUIDE ---
        if (!isReviewing) {
            Box(
                modifier = Modifier
                    .fillMaxSize()
                    .padding(top = 90.dp, bottom = 180.dp),
                contentAlignment = Alignment.Center
            ) {
                if (isTicketStep) {
                    // Ticket framing guide (portrait box focusing on ticket header & code)
                    Box(
                        modifier = Modifier
                            .size(width = 240.dp, height = 320.dp)
                            .border(BorderStroke(2.dp, Color(0xAAFFFFFF)), RoundedCornerShape(12.dp))
                    )
                    Text(
                        text = "Asegurá que se lea el número del ticket",
                        color = TextWhite,
                        fontSize = 13.sp,
                        modifier = Modifier
                            .align(Alignment.BottomCenter)
                            .background(Color(0x99000000), RoundedCornerShape(6.dp))
                            .padding(horizontal = 8.dp, vertical = 4.dp)
                    )
                } else {
                    // Evidence framing guide (wide box for bag + ticket)
                    Box(
                        modifier = Modifier
                            .size(width = 320.dp, height = 360.dp)
                            .border(BorderStroke(2.dp, Color(0xAAFFFFFF)), RoundedCornerShape(12.dp))
                    )
                    Text(
                        text = "Encuadre: bolsa, contenido y ticket",
                        color = TextWhite,
                        fontSize = 13.sp,
                        modifier = Modifier
                            .align(Alignment.BottomCenter)
                            .background(Color(0x99000000), RoundedCornerShape(6.dp))
                            .padding(horizontal = 8.dp, vertical = 4.dp)
                    )
                }
            }
        }

        // --- BOTTOM CONTROLS ---
        Column(
            modifier = Modifier
                .align(Alignment.BottomCenter)
                .fillMaxWidth()
                .background(Color(0xBB000000))
                .padding(horizontal = 16.dp, vertical = 16.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(14.dp)
        ) {
            // Lens selection & Zoom indicator (only in capture mode)
            if (!isReviewing) {
                Row(
                    horizontalArrangement = Arrangement.spacedBy(16.dp),
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    // Normal Lens button
                    Box(
                        modifier = Modifier
                            .clip(CircleShape)
                            .background(if (lensMode == LensMode.NORMAL) RedPrimary else DarkSurface)
                            .clickable { onLensModeToggle(LensMode.NORMAL) }
                            .padding(horizontal = 14.dp, vertical = 8.dp)
                    ) {
                        Text("1×", color = TextWhite, fontWeight = FontWeight.Bold, fontSize = 13.sp)
                    }

                    // Wide Lens button
                    Box(
                        modifier = Modifier
                            .clip(CircleShape)
                            .background(if (lensMode == LensMode.WIDE) RedPrimary else DarkSurface)
                            .clickable { onLensModeToggle(LensMode.WIDE) }
                            .padding(horizontal = 14.dp, vertical = 8.dp)
                    ) {
                        Text("0,5×", color = TextWhite, fontWeight = FontWeight.Bold, fontSize = 13.sp)
                    }

                    Text(
                        text = "${"%.1f".format(zoomRatio)}×",
                        color = TextMuted,
                        fontSize = 12.sp
                    )
                }
            }

            // Action Buttons
            if (!isReviewing) {
                // Live Camera Shutter Row
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    // Empty spacer or back action
                    if (!isTicketStep) {
                        OutlinedButton(
                            onClick = onBackToTicketClick,
                            border = BorderStroke(1.dp, TextMuted)
                        ) {
                            Text("← Ticket", color = TextWhite, fontSize = 12.sp)
                        }
                    } else {
                        Spacer(modifier = Modifier.width(72.dp))
                    }

                    // Large Shutter Button
                    Box(
                        modifier = Modifier
                            .size(72.dp)
                            .clip(CircleShape)
                            .border(BorderStroke(4.dp, TextWhite), CircleShape)
                            .background(RedPrimary)
                            .clickable { onCaptureClick() },
                        contentAlignment = Alignment.Center
                    ) {
                        Box(
                            modifier = Modifier
                                .size(56.dp)
                                .clip(CircleShape)
                                .background(RedPrimary)
                        )
                    }

                    // Finish session button
                    Button(
                        onClick = onFinishClick,
                        colors = ButtonDefaults.buttonColors(containerColor = DarkSurface)
                    ) {
                        Text("Finalizar", color = TextWhite, fontSize = 13.sp)
                    }
                }
            } else {
                // Review Mode Row (Usar foto / Repetir)
                Column(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalAlignment = Alignment.CenterHorizontally,
                    verticalArrangement = Arrangement.spacedBy(8.dp)
                ) {
                    Text(
                        text = if (isTicketStep) "¿El ticket se lee claramente?" else "¿El pedido y el ticket están completos?",
                        color = TextWhite,
                        fontSize = 14.sp,
                        fontWeight = FontWeight.SemiBold
                    )

                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.spacedBy(12.dp)
                    ) {
                        OutlinedButton(
                            onClick = onRetakeClick,
                            modifier = Modifier.weight(1f),
                            border = BorderStroke(1.dp, Color(0xFFEF5350))
                        ) {
                            Text("Repetir", color = TextWhite)
                        }

                        Button(
                            onClick = onUsePhotoClick,
                            modifier = Modifier.weight(1f),
                            colors = ButtonDefaults.buttonColors(containerColor = RedPrimary)
                        ) {
                            Text("✓ Usar foto", color = TextWhite, fontWeight = FontWeight.Bold)
                        }
                    }
                }
            }
        }
    }
}
