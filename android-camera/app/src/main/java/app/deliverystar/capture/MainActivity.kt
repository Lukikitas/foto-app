package app.deliverystar.capture

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.camera.view.PreviewView
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.livedata.observeAsState
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalSoftwareKeyboardController
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.core.content.ContextCompat
import androidx.core.content.FileProvider
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.viewmodel.compose.viewModel
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.withContext
import java.io.File
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter

private val Ink = Color(0xFF101B24)
private val Accent = Color(0xFFF7C74A)
private val Muted = Color(0xFFADC0CB)

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContent {
            MaterialTheme(colorScheme = darkColorScheme(primary = Accent, onPrimary = Ink,
                background = Ink, surface = Color(0xFF1C2A35), onSurface = Color.White)) {
                Surface(Modifier.fillMaxSize()) { CaptureApp() }
            }
        }
    }
}

@Composable private fun CaptureApp(model: CaptureViewModel = viewModel()) {
    val context = LocalContext.current
    var tab by remember { mutableIntStateOf(0) }
    val pendingSource = remember(model) { model.repository.dao.observePendingCount() }
    val pending by pendingSource.observeAsState(0)
    Column(Modifier.fillMaxSize().safeDrawingPadding().padding(horizontal = 18.dp)) {
        Row(Modifier.fillMaxWidth().padding(top = 18.dp, bottom = 12.dp), verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f)) {
                Text("DELIVERY STAR", style = MaterialTheme.typography.labelLarge, color = Accent)
                Text("Fotos de pedidos", style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Bold)
            }
            Surface(color = Color(0xFF2B3A44), shape = RoundedCornerShape(12.dp)) {
                Text("$pending pendientes", Modifier.padding(10.dp), style = MaterialTheme.typography.labelMedium)
            }
        }
        Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            FilterChip(selected = tab == 0, onClick = { tab = 0 }, label = { Text("Cámara") })
            FilterChip(selected = tab == 1, onClick = { tab = 1 }, label = { Text("Envíos") })
            Spacer(Modifier.weight(1f))
            TextButton(onClick = { context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(BuildConfig.WEB_URL))) }) { Text("Gestión ↗") }
        }
        if (tab == 0) CameraScreen(model, Modifier.weight(1f)) else QueueScreen(model, Modifier.weight(1f))
        Text("${BuildConfig.VERSION_NAME} · Fotos guardadas antes de enviar", color = Muted,
            style = MaterialTheme.typography.labelSmall, modifier = Modifier.padding(vertical = 10.dp))
    }
}

@Composable private fun CameraScreen(model: CaptureViewModel, modifier: Modifier) {
    val context = LocalContext.current
    val owner = LocalLifecycleOwner.current
    val keyboard = LocalSoftwareKeyboardController.current
    val haptic = LocalHapticFeedback.current
    var previewPath by remember { mutableStateOf<String?>(null) }
    LaunchedEffect(model.message) { if (model.message.contains("guardado")) haptic.performHapticFeedback(HapticFeedbackType.LongPress) }
    var granted by remember { mutableStateOf(ContextCompat.checkSelfPermission(context, Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED) }
    val requestPermission = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { granted = it }
    val session = remember { CameraSession() }
    val preview = remember { PreviewView(context).apply { implementationMode = PreviewView.ImplementationMode.PERFORMANCE; scaleType = PreviewView.ScaleType.FIT_CENTER } }
    DisposableEffect(session) { onDispose { session.close() } }
    var repeatAvailable by remember(model.lastPair?.id) { mutableStateOf(model.lastPair != null) }
    LaunchedEffect(model.lastPair?.id) {
        model.lastPair?.let { pair -> delay(maxOf(0, pair.reviewUntil - System.currentTimeMillis())); repeatAvailable = false }
    }
    Column(modifier.imePadding(), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        OutlinedTextField(value = model.author, onValueChange = { model.author = it.take(120) },
            label = { Text("Quién saca las fotos") }, singleLine = true, enabled = !model.busy && model.draft == null,
            keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.Words, imeAction = ImeAction.Done),
            keyboardActions = KeyboardActions(onDone = { keyboard?.hide() }), modifier = Modifier.fillMaxWidth())
        Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.fillMaxWidth()) {
            Text(if (model.draft == null) "01 / TICKET" else "02 / BOLSA", color = Accent, style = MaterialTheme.typography.titleSmall)
            Spacer(Modifier.weight(1f))
            Text(if (model.draft == null) "Código visible y enfocado" else "Bolsa, contenido y ticket", color = Muted, style = MaterialTheme.typography.labelMedium)
        }
        Box(Modifier.weight(1f).fillMaxWidth().background(Color.Black, RoundedCornerShape(18.dp)), contentAlignment = Alignment.Center) {
            if (granted) AndroidView(factory = { preview.also { it.post { session.bind(context, owner, it) } } }, modifier = Modifier.fillMaxSize())
            else Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(12.dp)) {
                Text("Habilitá la cámara para empezar")
                Button(onClick = { requestPermission.launch(Manifest.permission.CAMERA) }) { Text("Permitir cámara") }
            }
            if (model.busy) CircularProgressIndicator(color = Accent)
            if (session.error.isNotBlank()) Text(session.error, color = Color.White, modifier = Modifier.align(Alignment.BottomCenter).background(Ink).padding(12.dp))
        }
        if (session.error.isNotBlank()) TextButton(onClick = { session.bind(context, owner, preview) }) { Text("Reiniciar cámara") }
        val last = model.draft ?: model.lastPair
        if (last != null) Row(horizontalArrangement = Arrangement.spacedBy(12.dp), verticalAlignment = Alignment.CenterVertically) {
            Thumbnail(last.ticketPath) { previewPath = last.ticketPath }
            if (last.evidencePath.isNotBlank()) Thumbnail(last.evidencePath) { previewPath = last.evidencePath }
            Text(if (model.draft != null) "Ticket guardado" else "Par guardado", color = Muted, style = MaterialTheme.typography.labelSmall)
        }
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
            TextButton(onClick = { session.requestZoom(session.zoom - 0.25f) }, enabled = session.ready && !model.busy) { Text("−") }
            TextButton(onClick = { session.requestZoom(1f) }, enabled = session.ready && !model.busy) { Text("%.1f×".format(session.zoom)) }
            TextButton(onClick = { session.requestZoom(session.zoom + 0.25f) }, enabled = session.ready && !model.busy) { Text("+") }
            if (session.lensCount > 1) TextButton(onClick = { session.nextLens(context, owner, preview) }, enabled = !model.busy) { Text("Cambiar lente") }
            FilterChip(selected = session.torch, onClick = { session.toggleTorch() }, enabled = session.hasFlash && session.ready && !model.busy, label = { Text("Flash") })
        }
        if (model.error.isNotBlank()) Text(model.error, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall)
        else if (model.message.isNotBlank()) Text(model.message, color = Color(0xFFB5E8C0), style = MaterialTheme.typography.bodySmall)
        if (model.qualityWarning.isNotBlank()) Text(model.qualityWarning, color = Accent, style = MaterialTheme.typography.bodySmall)
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            if (model.draft != null) OutlinedButton(onClick = model::repeatTicket, enabled = !model.busy) { Text("Repetir ticket") }
            if (repeatAvailable && model.lastPair != null) OutlinedButton(onClick = model::repeatEvidence, enabled = !model.busy) { Text("Repetir bolsa") }
            Button(onClick = { keyboard?.hide(); model.take(session) }, enabled = granted && session.ready && !model.busy && !model.loading,
                modifier = Modifier.weight(1f).heightIn(min = 58.dp), shape = RoundedCornerShape(16.dp)) {
                Text(if (model.busy) "Guardando…" else if (model.draft == null) "Sacar ticket" else "Sacar bolsa", fontWeight = FontWeight.Bold)
            }
        }
    }
    previewPath?.let { path ->
        Dialog(onDismissRequest = { previewPath = null }, properties = DialogProperties(usePlatformDefaultWidth = false)) {
            Surface(Modifier.fillMaxSize()) {
                Column(Modifier.safeDrawingPadding().padding(16.dp)) {
                    TextButton(onClick = { previewPath = null }) { Text("Cerrar foto") }
                    val actual = if (File(path).exists()) path else "$path.thumb"
                    val image by produceState<android.graphics.Bitmap?>(null, actual) { value = withContext(Dispatchers.IO) { ImageFiles.thumbnail(actual, 1600) } }
                    image?.let { Image(it.asImageBitmap(), "Foto guardada", Modifier.weight(1f).fillMaxWidth()) }
                }
            }
        }
    }
}

@Composable private fun QueueScreen(model: CaptureViewModel, modifier: Modifier) {
    val context = LocalContext.current
    var page by remember { mutableIntStateOf(0) }
    val source = remember(page) { model.repository.dao.observePage(20, page * 20) }
    val rows by source.observeAsState(emptyList())
    val countSource = remember(model) { model.repository.dao.observeCount() }
    val total by countSource.observeAsState(0)
    val formatter = remember { DateTimeFormatter.ofPattern("dd/MM HH:mm").withZone(ZoneId.of("America/Argentina/Buenos_Aires")) }
    Column(modifier) {
        Text("Las fotos esperan conexión y se reintentan solas. Android puede demorar las subidas para ahorrar batería.", color = Muted, style = MaterialTheme.typography.bodySmall, modifier = Modifier.padding(vertical = 12.dp))
        TextButton(onClick = {
            val file = Diagnostics.export(context)
            val uri = FileProvider.getUriForFile(context, "${context.packageName}.files", file)
            context.startActivity(Intent.createChooser(Intent(Intent.ACTION_SEND).apply {
                type = "application/json"; putExtra(Intent.EXTRA_STREAM, uri); addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
            }, "Compartir diagnóstico"))
        }) { Text("Compartir diagnóstico") }
        LazyColumn(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            items(rows, key = { it.id }) { row ->
                Surface(shape = RoundedCornerShape(14.dp), modifier = Modifier.fillMaxWidth()) {
                    Row(Modifier.padding(12.dp), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                        Thumbnail(row.evidencePath.ifBlank { row.ticketPath })
                        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                            Text(row.displayCode.ifBlank { if (row.state == "DRAFT") "Falta la bolsa" else "Pedido guardado" }, fontWeight = FontWeight.SemiBold)
                            Text("${row.author} · ${formatter.format(Instant.ofEpochMilli(row.createdAt))}", style = MaterialTheme.typography.labelSmall, color = Muted)
                            Text(when (row.state) { "DRAFT" -> "Ticket guardado"; "REVIEW" -> "Guardado · podés repetir"; "UPLOADING" -> "Enviando…"; "SENT" -> if (row.ticketExpired) "Foto enviada · ticket vencido" else "Foto y ticket enviados"; "ERROR" -> "Necesita revisión"; else -> "Esperando envío" }, color = if (row.state == "SENT") Color(0xFFB5E8C0) else Accent, style = MaterialTheme.typography.bodySmall)
                            if (row.error.isNotBlank()) Text(row.error, style = MaterialTheme.typography.bodySmall)
                            if (row.state == "ERROR") TextButton(onClick = { model.retry(row.id) }) { Text("Reintentar") }
                        }
                    }
                }
            }
            if (rows.isEmpty()) item { Text("Todavía no hay capturas. Empezá desde Cámara.", color = Muted, modifier = Modifier.padding(20.dp)) }
        }
        if (total > 20) Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
            TextButton(onClick = { page-- }, enabled = page > 0) { Text("Anterior") }
            Text("${page + 1} / ${maxOf(1, (total + 19) / 20)}", Modifier.padding(12.dp))
            TextButton(onClick = { page++ }, enabled = (page + 1) * 20 < total) { Text("Siguiente") }
        }
    }
}

@Composable private fun Thumbnail(original: String, onClick: (() -> Unit)? = null) {
    val path = remember(original) { if (File(original).exists()) original else "$original.thumb" }
    val bitmap by produceState<android.graphics.Bitmap?>(null, path) {
        value = withContext(Dispatchers.IO) { ImageFiles.thumbnail(path) }
        // Let the image lifecycle/GC retire bitmaps after composition releases
        // them. Recycling a bitmap still referenced by RenderThread can crash.
    }
    bitmap?.let { Image(it.asImageBitmap(), "Foto guardada", Modifier.size(64.dp).clickable(enabled = onClick != null) { onClick?.invoke() }) }
}
