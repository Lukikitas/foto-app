package ar.com.starapp.fotoappcamera.ui

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.widget.Toast
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import ar.com.starapp.fotoappcamera.camera.CameraDiagnosticReport
import ar.com.starapp.fotoappcamera.ui.theme.DarkBackground
import ar.com.starapp.fotoappcamera.ui.theme.DarkSurface
import ar.com.starapp.fotoappcamera.ui.theme.RedPrimary
import ar.com.starapp.fotoappcamera.ui.theme.TextMuted
import ar.com.starapp.fotoappcamera.ui.theme.TextWhite

@Composable
fun DiagnosticsScreen(
    report: CameraDiagnosticReport?,
    onClose: () -> Unit
) {
    val context = LocalContext.current
    val scrollState = rememberScrollState()

    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(DarkBackground)
            .padding(16.dp)
    ) {
        Column(
            modifier = Modifier
                .fillMaxSize()
                .verticalScroll(scrollState),
            verticalArrangement = Arrangement.spacedBy(12.dp)
        ) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically
            ) {
                Text(
                    text = "Diagnóstico Técnico",
                    style = MaterialTheme.typography.titleLarge,
                    color = TextWhite
                )
                Button(
                    onClick = onClose,
                    colors = ButtonDefaults.buttonColors(containerColor = DarkSurface)
                ) {
                    Text("Cerrar", color = TextWhite)
                }
            }

            Text(
                text = "Información del hardware de cámara disponible para Foto-app. No contiene tokens ni datos personales.",
                style = MaterialTheme.typography.bodyMedium,
                color = TextMuted
            )

            if (report != null) {
                Box(
                    modifier = Modifier
                        .fillMaxWidth()
                        .background(DarkSurface)
                        .padding(12.dp)
                ) {
                    Text(
                        text = report.toFormattedString(),
                        color = TextWhite,
                        fontFamily = FontFamily.Monospace,
                        fontSize = 12.sp,
                        lineHeight = 16.sp
                    )
                }

                Button(
                    onClick = {
                        val clipboard = context.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
                        val clip = ClipData.newPlainText("Diagnóstico Foto-app", report.toFormattedString())
                        clipboard.setPrimaryClip(clip)
                        Toast.makeText(context, "Diagnóstico copiado al portapapeles", Toast.LENGTH_SHORT).show()
                    },
                    modifier = Modifier.fillMaxWidth(),
                    colors = ButtonDefaults.buttonColors(containerColor = RedPrimary)
                ) {
                    Text("📋 Copiar diagnóstico al portapapeles", color = TextWhite)
                }
            } else {
                Text("Analizando hardware de cámara…", color = TextMuted)
            }
        }
    }
}
