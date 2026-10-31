package app.deliverystar.capture

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.BackHandler
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.camera.view.PreviewView
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.rememberTransformableState
import androidx.compose.foundation.gestures.transformable
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
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.draw.clipToBounds
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.unit.IntSize
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalSoftwareKeyboardController
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
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

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.border
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.ui.draw.clip
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.text.style.TextOverflow
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import android.content.Context
import android.widget.Toast
import kotlin.math.abs

private val Accent = Color(0xFFE4002B)
private val Overlay = Color(0xB3000000)

class MainActivity : ComponentActivity() {
    private var webEntry by mutableIntStateOf(0)
    private fun receiveCaptureLink(incoming: Intent?) {
        if (CaptureLink.matches(incoming?.action, incoming?.dataString)) {
            webEntry++
            Diagnostics.record(this, "web.camera.open")
        }
    }
    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        receiveCaptureLink(intent)
    }
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        receiveCaptureLink(intent)
        setContent {
            val model: CaptureViewModel = viewModel()
            val dark = when (model.themeMode) { "light" -> false; "dark" -> true; else -> isSystemInDarkTheme() }
            val colors = if (dark) darkColorScheme(primary = Accent, onPrimary = Color.White,
                secondary = Accent, secondaryContainer = Color(0xFF422027), onSecondaryContainer = Color.White,
                background = Color(0xFF161616), surface = Color(0xFF1F1F1F), onSurface = Color(0xFFF1F1F1),
                onSurfaceVariant = Color(0xFFB3B7BE), outline = Color(0xFF3F3F3F), error = Color(0xFFF97066))
            else lightColorScheme(primary = Accent, onPrimary = Color.White,
                secondary = Accent, secondaryContainer = Color(0xFFF8DADD), onSecondaryContainer = Color(0xFF1C1D20),
                background = Color(0xFFEFE8E0), surface = Color(0xFFF7F3EE), onSurface = Color(0xFF1C1D20),
                onSurfaceVariant = Color(0xFF4E535B), outline = Color(0xFFC3B8AC), error = Color(0xFFB42318))
            MaterialTheme(colorScheme = colors, shapes = Shapes(small = RoundedCornerShape(8.dp), medium = RoundedCornerShape(10.dp), large = RoundedCornerShape(12.dp))) {
                Surface(Modifier.fillMaxSize(), color = colors.background) {
                    if (BuildConfig.CAPTURE_TEMPORARILY_CLOSED) TemporaryClosureScreen(model)
                    else CaptureApp(model, webEntry)
                }
            }
        }
    }
}

private fun shareDiagnostics(context: Context) {
    runCatching {
        val uri = FileProvider.getUriForFile(context, "${context.packageName}.files", Diagnostics.export(context))
        context.startActivity(Intent.createChooser(Intent(Intent.ACTION_SEND).apply {
            type = "application/json"; putExtra(Intent.EXTRA_STREAM, uri); addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        }, "Compartir diagnóstico"))
    }.onFailure { Toast.makeText(context, "No se pudo preparar el diagnóstico. Revisá el espacio.", Toast.LENGTH_LONG).show() }
}

@Composable private fun TemporaryClosureScreen(model: CaptureViewModel) {
    val context = LocalContext.current
    val owner = LocalLifecycleOwner.current
    DisposableEffect(owner) {
        val observer = LifecycleEventObserver { _, event -> if (event == Lifecycle.Event.ON_RESUME) model.checkUpdates() }
        owner.lifecycle.addObserver(observer)
        onDispose { owner.lifecycle.removeObserver(observer) }
    }
    LaunchedEffect(Unit) { model.checkUpdates() }
    Column(Modifier.fillMaxSize().safeDrawingPadding()) {
        model.update?.let { update ->
            Row(Modifier.fillMaxWidth().background(MaterialTheme.colorScheme.secondaryContainer).padding(12.dp), verticalAlignment = Alignment.CenterVertically) {
                Text("Actualización pendiente · ${update.name}", Modifier.weight(1f), style = MaterialTheme.typography.labelMedium)
                TextButton(onClick = { context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(update.url))) }) { Text("Actualizar") }
            }
        }
        Column(Modifier.weight(1f).fillMaxWidth().verticalScroll(rememberScrollState()).padding(horizontal = 28.dp, vertical = 32.dp),
            horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.Center) {
            Text("DELIVERY STAR · FOTOS", color = Accent, style = MaterialTheme.typography.labelLarge, fontWeight = FontWeight.Bold)
            Spacer(Modifier.height(24.dp))
            Text("La app se encuentra momentáneamente cerrada", style = MaterialTheme.typography.headlineMedium,
                fontWeight = FontWeight.Bold, textAlign = TextAlign.Center)
            Spacer(Modifier.height(20.dp))
            Text("Gracias por haberla usado y por ayudarnos en su desarrollo. Cada prueba y cada aporte nos ayudaron a mejorarla.",
                style = MaterialTheme.typography.bodyLarge, textAlign = TextAlign.Center)
        }
        Text("Delivery Star · ${BuildConfig.VERSION_NAME}", Modifier.align(Alignment.CenterHorizontally).padding(bottom = 12.dp),
            style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}

@Composable private fun CaptureApp(model: CaptureViewModel, webEntry: Int) {
    val context = LocalContext.current
    val owner = LocalLifecycleOwner.current
    var tab by remember { mutableIntStateOf(0) }
    var menu by remember { mutableStateOf(false) }
    var editAuthor by remember { mutableStateOf(model.author.isBlank()) }
    var handledEntry by remember { mutableIntStateOf(0) }
    LaunchedEffect(webEntry, model.busy) {
        if (webEntry > handledEntry && !model.busy) {
            tab = 0
            handledEntry = webEntry
        }
    }
    val pendingSource = remember(model) { model.repository.dao.observePendingCount() }
    val pending by pendingSource.observeAsState(0)
    DisposableEffect(owner) {
        val observer = LifecycleEventObserver { _, event -> if (event == Lifecycle.Event.ON_RESUME) model.checkUpdates() }
        owner.lifecycle.addObserver(observer)
        onDispose { owner.lifecycle.removeObserver(observer) }
    }
    LaunchedEffect(Unit) { model.checkUpdates() }
    Column(Modifier.fillMaxSize().safeDrawingPadding()) {
        Row(Modifier.fillMaxWidth().height(48.dp).padding(horizontal = 8.dp), verticalAlignment = Alignment.CenterVertically) {
            TextButton(onClick = { tab = 0 }, enabled = !model.busy) { Text("Cámara", color = if (tab == 0) Accent else MaterialTheme.colorScheme.onSurface, fontWeight = if (tab == 0) FontWeight.Bold else FontWeight.Normal) }
            TextButton(onClick = { tab = 1 }, enabled = !model.busy) {
                Text("Envíos", color = if (tab == 1) Accent else MaterialTheme.colorScheme.onSurface)
                if (pending > 0) Badge(Modifier.padding(start = 6.dp), containerColor = Accent) { Text(pending.toString()) }
            }
            Spacer(Modifier.weight(1f))
            if (BuildConfig.DEBUG) Text("PRUEBAS", style = MaterialTheme.typography.labelSmall, color = Accent)
            Box {
                TextButton(onClick = { menu = true }, modifier = Modifier.semantics { contentDescription = "Opciones" }) { Text("⋮", style = MaterialTheme.typography.headlineSmall) }
                DropdownMenu(expanded = menu, onDismissRequest = { menu = false }) {
                    DropdownMenuItem(text = { Text("Quién saca las fotos") }, enabled = !model.busy && model.draft == null, onClick = { menu = false; editAuthor = true })
                    DropdownMenuItem(text = { Text("Aspecto: ${when (model.themeMode) { "light" -> "Claro"; "dark" -> "Oscuro"; else -> "Sistema" }}") }, onClick = { model.cycleTheme() })
                    DropdownMenuItem(text = { Text("Gestión web ↗") }, onClick = { menu = false; context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(BuildConfig.WEB_URL))) })
                    DropdownMenuItem(text = { Text("Compartir diagnóstico") }, onClick = { menu = false; shareDiagnostics(context) })
                    DropdownMenuItem(text = { Text("Buscar actualizaciones") }, onClick = { menu = false; model.checkUpdates(true) })
                    DropdownMenuItem(text = { Text("Delivery Star · ${BuildConfig.VERSION_NAME}", style = MaterialTheme.typography.labelSmall) }, enabled = false, onClick = {})
                }
            }
        }
        model.update?.let { update ->
            Row(Modifier.fillMaxWidth().background(MaterialTheme.colorScheme.secondaryContainer).padding(start = 12.dp, end = 4.dp), verticalAlignment = Alignment.CenterVertically) {
                Text("Actualización pendiente · ${update.name}", Modifier.weight(1f), style = MaterialTheme.typography.labelMedium)
                TextButton(onClick = { context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(update.url))) }, enabled = !model.busy) { Text("Actualizar") }
            }
        }
        if (tab == 0) CameraScreen(model, { editAuthor = true }, Modifier.weight(1f)) else QueueScreen(model, Modifier.weight(1f))
    }
    if (editAuthor) AlertDialog(onDismissRequest = { if (model.author.isNotBlank()) editAuthor = false },
        title = { Text("Quién saca las fotos") }, text = {
            OutlinedTextField(model.author, { model.author = it.take(120) }, singleLine = true, enabled = model.draft == null,
                keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.Words, imeAction = ImeAction.Done),
                keyboardActions = KeyboardActions(onDone = { if (model.author.isNotBlank()) editAuthor = false }), label = { Text("Nombre") })
        }, confirmButton = { TextButton(onClick = { editAuthor = false }, enabled = model.author.isNotBlank()) { Text("Listo") } })
    if (model.updateNotice.isNotBlank()) AlertDialog(onDismissRequest = model::clearUpdateNotice, title = { Text("Actualizaciones") },
        text = { Text(model.updateNotice) }, confirmButton = { TextButton(onClick = model::clearUpdateNotice) { Text("Cerrar") } })
}

@Composable private fun CameraScreen(model: CaptureViewModel, editAuthor: () -> Unit, modifier: Modifier) {
    val context = LocalContext.current
    val owner = LocalLifecycleOwner.current
    val keyboard = LocalSoftwareKeyboardController.current
    val haptic = LocalHapticFeedback.current
    var previewPath by remember { mutableStateOf<String?>(null) }
    var granted by remember { mutableStateOf(ContextCompat.checkSelfPermission(context, Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED) }
    val requestPermission = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { granted = it }
    val session = remember { CameraSession() }
    val preview = remember { PreviewView(context).apply { implementationMode = PreviewView.ImplementationMode.PERFORMANCE; scaleType = PreviewView.ScaleType.FILL_CENTER } }
    var frameSize by remember { mutableStateOf(IntSize.Zero) }
    var boundSize by remember { mutableStateOf(IntSize.Zero) }
    LaunchedEffect(frameSize, model.busy, granted) {
        if (granted && !model.busy && frameSize.width > 0 && frameSize != boundSize) {
            preview.post { session.bind(context, owner, preview) }
            boundSize = frameSize
        }
    }
    DisposableEffect(session) { onDispose { session.close() } }
    LaunchedEffect(model.message) { if (model.message.contains("guardado")) haptic.performHapticFeedback(HapticFeedbackType.LongPress) }
    var repeatAvailable by remember(model.lastPair?.id) { mutableStateOf(model.lastPair != null) }
    var repeatMenu by remember { mutableStateOf(false) }
    var lensMenu by remember { mutableStateOf(false) }
    val shutterLabel = if (model.busy) "Guardando…" else if (model.draft == null) "Sacar ticket" else "Sacar bolsa"
    val takingTicket = model.draft == null
    LaunchedEffect(session.lensNotice) { if (session.lensNotice.isNotBlank()) { delay(6_000); session.clearLensNotice() } }
    LaunchedEffect(model.lastPair?.id) { repeatMenu = false; model.lastPair?.let { delay(maxOf(0, it.reviewUntil - System.currentTimeMillis())); repeatAvailable = false } }
    Column(modifier.imePadding()) {
        Box(Modifier.weight(1f).fillMaxWidth().clipToBounds().background(Color.Black), contentAlignment = Alignment.Center) {
            if (granted) AndroidView(factory = { preview }, modifier = Modifier.fillMaxSize().onSizeChanged { frameSize = it })
            else Button(onClick = { requestPermission.launch(Manifest.permission.CAMERA) }) { Text("Permitir cámara") }
            Column(Modifier.align(Alignment.TopCenter).fillMaxWidth().padding(8.dp), horizontalAlignment = Alignment.End) {
                CaptureStageIndicator(takingTicket)
                TextButton(onClick = editAuthor, enabled = !model.busy && takingTicket,
                    colors = ButtonDefaults.textButtonColors(containerColor = Overlay, contentColor = Color.White, disabledContainerColor = Overlay, disabledContentColor = Color.LightGray),
                    contentPadding = PaddingValues(horizontal = 10.dp, vertical = 0.dp)) {
                    Text(model.author.ifBlank { "Nombre" }.take(20), maxLines = 1, overflow = TextOverflow.Ellipsis)
                }
            }
            if (model.busy) CircularProgressIndicator(color = Color.White)
            if (session.error.isNotBlank()) Column(Modifier.background(Overlay).padding(12.dp)) {
                Text(session.error, color = Color.White)
                TextButton(onClick = { session.bind(context, owner, preview) }) { Text("Reiniciar cámara") }
            }
            Column(Modifier.align(Alignment.BottomCenter).padding(10.dp), horizontalAlignment = Alignment.CenterHorizontally) {
                val notice = model.error.ifBlank { session.lensNotice.ifBlank { model.qualityWarning.ifBlank { model.message } } }
                if (notice.isNotBlank()) Text(notice, Modifier.background(Overlay, RoundedCornerShape(8.dp)).padding(8.dp),
                    color = Color.White, style = MaterialTheme.typography.labelMedium, maxLines = 2, overflow = TextOverflow.Ellipsis)
                Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                if (session.wideRatio > 0f) LensButton("%.1f×".format(java.util.Locale.US, session.wideRatio), session.zoom < .95f, session.ready && !model.busy) { session.selectWide(context, owner, preview) }
                LensButton("1×", session.isPrincipal && abs(session.zoom - 1f) < .1f, session.ready && !model.busy) { session.selectNormal(context, owner, preview) }
                if (session.maxZoom >= 2f) LensButton("2×", session.isPrincipal && abs(session.zoom - 2f) < .1f, session.ready && !model.busy) { session.selectNormal(context, owner, preview, 2f) }
                LensButton("Lentes", !session.isPrincipal, session.lenses.isNotEmpty() && !model.busy) { lensMenu = true }
                }
            }
        }
        Row(Modifier.fillMaxWidth().height(104.dp).padding(horizontal = 12.dp), verticalAlignment = Alignment.CenterVertically) {
            Row(Modifier.width(92.dp), horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                (model.draft ?: model.lastPair)?.let { last ->
                    Photo(last.ticketPath, Modifier.size(42.dp, 56.dp).clickable { previewPath = last.ticketPath }, 240)
                    if (last.evidencePath.isNotBlank()) Photo(last.evidencePath, Modifier.size(42.dp, 56.dp).clickable { previewPath = last.evidencePath }, 240)
                }
            }
            val enabled = granted && session.ready && !model.busy && !model.loading && model.author.isNotBlank()
            Column(Modifier.weight(1f).semantics { contentDescription = shutterLabel }.clickable(enabled = enabled, role = Role.Button) { keyboard?.hide(); model.take(session) }.padding(vertical = 4.dp), horizontalAlignment = Alignment.CenterHorizontally) {
                Box(Modifier.size(66.dp).border(3.dp, if (enabled) Accent else Color.Gray, CircleShape).padding(5.dp).background(if (enabled) Accent else Color.Gray, CircleShape))
                Text(shutterLabel, style = MaterialTheme.typography.labelMedium)
            }
            Column(Modifier.width(92.dp).fillMaxHeight().padding(vertical = 4.dp), horizontalAlignment = Alignment.End, verticalArrangement = Arrangement.SpaceBetween) {
            Box(Modifier.fillMaxWidth().height(44.dp), contentAlignment = Alignment.Center) {
                if (model.draft != null) TextButton(onClick = model::repeatTicket, enabled = !model.busy) { Text("Repetir") }
                else if (repeatAvailable && model.lastPair != null) {
                    TextButton(onClick = { repeatMenu = true }, enabled = !model.busy) { Text("Repetir") }
                    DropdownMenu(repeatMenu, { repeatMenu = false }) {
                        DropdownMenuItem(text = { Text("Repetir ticket") }, onClick = { repeatMenu = false; model.repeatTicket() })
                        DropdownMenuItem(text = { Text("Repetir bolsa") }, onClick = { repeatMenu = false; model.repeatEvidence() })
                    }
                }
            }
                OutlinedButton(onClick = session::toggleTorch, enabled = session.hasFlash && session.ready && !model.busy,
                    modifier = Modifier.fillMaxWidth().height(48.dp).semantics {
                        contentDescription = "Flash"
                        stateDescription = if (!session.hasFlash) "No disponible en esta lente" else if (session.torch) "Activado" else "Desactivado"
                    }, contentPadding = PaddingValues(4.dp),
                    colors = ButtonDefaults.outlinedButtonColors(containerColor = if (session.torch) Accent else Color.Transparent,
                        contentColor = if (session.torch) Color.White else MaterialTheme.colorScheme.onSurface)) {
                    Text(if (session.torch) "Flash ✓" else "Flash", style = MaterialTheme.typography.labelLarge)
                }
            }
        }
    }
    previewPath?.let { PhotoDialog(it) { previewPath = null } }
    if (lensMenu) AlertDialog(onDismissRequest = { lensMenu = false }, title = { Text("Cámaras traseras") }, text = {
        Column(Modifier.verticalScroll(rememberScrollState())) {
            session.lenses.forEach { lens ->
                val available = lens.key !in session.unavailableLenses
                Row(Modifier.fillMaxWidth().clickable(enabled = available, role = Role.RadioButton) {
                    lensMenu = false; session.selectLens(context, owner, preview, lens.key)
                }.padding(vertical = 4.dp), verticalAlignment = Alignment.CenterVertically) {
                    RadioButton(selected = session.selectedLensKey == lens.key && (lens != session.lenses.first() || session.zoom >= .95f), onClick = null, enabled = available)
                    Column(Modifier.weight(1f).padding(start = 8.dp)) {
                        Text(lens.label, color = if (available) MaterialTheme.colorScheme.onSurface else MaterialTheme.colorScheme.onSurfaceVariant)
                        if (!available) Text("No disponible", style = MaterialTheme.typography.labelSmall)
                    }
                }
            }
            if (session.lenses.none { it.ratio in .1f.. .94f } && session.wideRatio > 0f) {
                TextButton(onClick = { lensMenu = false; session.selectWide(context, owner, preview) }) {
                    Text("Gran angular · %.1f×".format(java.util.Locale.US, session.wideRatio))
                }
            } else if (session.lenses.size == 1) Text("No se detectó otra lente disponible.", style = MaterialTheme.typography.bodySmall)
        }
    }, confirmButton = { TextButton(onClick = { lensMenu = false }) { Text("Cerrar") } })
}

@Composable private fun CaptureStageIndicator(ticket: Boolean) {
    Row(Modifier.fillMaxWidth().background(Overlay, RoundedCornerShape(10.dp)).padding(3.dp).clearAndSetSemantics {
        contentDescription = if (ticket) "Foto del ticket · paso 1 de 2" else "Foto de la bolsa · paso 2 de 2"
        liveRegion = LiveRegionMode.Polite
    }, horizontalArrangement = Arrangement.spacedBy(4.dp)) {
        listOf("1 · TICKET", "2 · BOLSA").forEachIndexed { index, label ->
            val active = (index == 0) == ticket
            Box(Modifier.weight(1f).height(42.dp).background(if (active) Accent else Color.Transparent, RoundedCornerShape(8.dp)), contentAlignment = Alignment.Center) {
                Text(label, color = if (active) Color.White else Color.White.copy(alpha = .62f), style = MaterialTheme.typography.titleMedium,
                    fontWeight = if (active) FontWeight.Bold else FontWeight.Normal)
            }
        }
    }
}

@Composable private fun LensButton(label: String, selected: Boolean, enabled: Boolean, action: () -> Unit) {
    OutlinedButton(onClick = action, enabled = enabled, shape = CircleShape, border = BorderStroke(1.dp, if (selected) Accent else Color.White),
        colors = ButtonDefaults.outlinedButtonColors(containerColor = if (selected) Accent else Overlay, contentColor = Color.White),
        contentPadding = PaddingValues(horizontal = 14.dp, vertical = 6.dp)) { Text(label) }
}

@Composable private fun ZoomablePreview(bitmap: android.graphics.Bitmap, modifier: Modifier) {
    var scale by remember(bitmap) { mutableFloatStateOf(1f) }
    var offset by remember(bitmap) { mutableStateOf(Offset.Zero) }
    var viewport by remember { mutableStateOf(IntSize.Zero) }
    val state = rememberTransformableState { zoom, pan, _ ->
        scale = (scale * zoom).coerceIn(1f, 6f)
        val fit = minOf(viewport.width.toFloat() / bitmap.width, viewport.height.toFloat() / bitmap.height)
        val limitX = maxOf(0f, (bitmap.width * fit * scale - viewport.width) / 2f)
        val limitY = maxOf(0f, (bitmap.height * fit * scale - viewport.height) / 2f)
        val next = offset + pan
        offset = Offset(next.x.coerceIn(-limitX, limitX), next.y.coerceIn(-limitY, limitY))
    }
    Column(modifier) {
        TextButton(onClick = { scale = 1f; offset = Offset.Zero }, enabled = scale > 1f) { Text("Restablecer zoom") }
        Box(Modifier.weight(1f).fillMaxWidth().clipToBounds().onSizeChanged { viewport = it }) {
            Image(bitmap.asImageBitmap(), "Foto guardada: ampliá y mové con dos dedos", Modifier.fillMaxSize()
                .graphicsLayer { scaleX = scale; scaleY = scale; translationX = offset.x; translationY = offset.y }
                .transformable(state))
        }
    }
}

@Composable private fun QueueScreen(model: CaptureViewModel, modifier: Modifier) {
    val context = LocalContext.current
    var page by remember { mutableIntStateOf(0) }
    var previewPath by remember { mutableStateOf<String?>(null) }
    val source = remember(page) { model.repository.dao.observePage(20, page * 20) }
    val rows by source.observeAsState(emptyList())
    val countSource = remember(model) { model.repository.dao.observeCount() }
    val total by countSource.observeAsState(0)
    val formatter = remember { DateTimeFormatter.ofPattern("dd/MM HH:mm").withZone(ZoneId.of("America/Argentina/Buenos_Aires")) }
    Column(modifier.padding(horizontal = 10.dp)) {
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
            Text("Recientes", Modifier.weight(1f), style = MaterialTheme.typography.labelLarge)
            TextButton(onClick = { shareDiagnostics(context) }) { Text("Compartir diagnóstico", style = MaterialTheme.typography.labelMedium) }
        }
        LazyColumn(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            items(rows, key = { it.id }) { row ->
                var details by remember(row.id) { mutableStateOf(false) }
                Surface(shape = RoundedCornerShape(10.dp)) {
                    Column {
                        val image = row.evidencePath.ifBlank { row.ticketPath }
                        Photo(image, Modifier.fillMaxWidth().aspectRatio(4f / 3f).clickable { previewPath = image }, 960)
                        Column(Modifier.padding(horizontal = 12.dp, vertical = 8.dp)) {
                            Row(verticalAlignment = Alignment.CenterVertically) {
                                Text(row.displayCode.ifBlank { if (row.state == "DRAFT") "Falta la bolsa" else "Pedido guardado" }, Modifier.weight(1f), fontWeight = FontWeight.SemiBold)
                                Text(when (row.state) { "DRAFT" -> "Ticket"; "REVIEW" -> "Guardado"; "UPLOADING" -> "Enviando…"; "SENT" -> if (row.ticketExpired) "Ticket vencido" else "Enviado"; "ERROR" -> "Revisar"; else -> "Pendiente" },
                                    style = MaterialTheme.typography.labelMedium, color = if (row.state == "ERROR") MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.onSurfaceVariant)
                            }
                            Text("${row.author} · ${formatter.format(Instant.ofEpochMilli(row.createdAt))}", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                            if (row.state == "ERROR") {
                                Row { TextButton(onClick = { model.retry(row.id) }) { Text("Reintentar") }; TextButton(onClick = { details = !details }) { Text("Ver motivo") } }
                                if (details) Text(row.error, style = MaterialTheme.typography.bodySmall)
                            }
                        }
                    }
                }
            }
            if (rows.isEmpty()) item { Text("Todavía no hay capturas.", Modifier.padding(18.dp), color = MaterialTheme.colorScheme.onSurfaceVariant) }
        }
        if (total > 20) Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
            TextButton(onClick = { page-- }, enabled = page > 0) { Text("Anterior") }
            Text("${page + 1} / ${maxOf(1, (total + 19) / 20)}", Modifier.padding(12.dp))
            TextButton(onClick = { page++ }, enabled = (page + 1) * 20 < total) { Text("Siguiente") }
        }
    }
    previewPath?.let { PhotoDialog(it) { previewPath = null } }
}

@Composable private fun Photo(path: String, modifier: Modifier, maximum: Int) {
    val bitmap by produceState<android.graphics.Bitmap?>(null, path, maximum) {
        value = withContext(Dispatchers.IO) { ImageFiles.thumbnail(path, maximum) ?: ImageFiles.thumbnail("$path.thumb", maximum) }
    }
    Box(modifier.clip(RoundedCornerShape(8.dp)).background(Color.Black), contentAlignment = Alignment.Center) {
        bitmap?.let { Image(it.asImageBitmap(), "Foto guardada", Modifier.fillMaxSize(), contentScale = androidx.compose.ui.layout.ContentScale.Crop) }
    }
}

@Composable private fun PhotoDialog(path: String, close: () -> Unit) {
    Dialog(onDismissRequest = close, properties = DialogProperties(usePlatformDefaultWidth = false)) {
        Surface(Modifier.fillMaxSize()) {
            Column(Modifier.safeDrawingPadding().padding(12.dp)) {
                TextButton(onClick = close) { Text("Cerrar foto") }
                val image by produceState<android.graphics.Bitmap?>(null, path) { value = withContext(Dispatchers.IO) { ImageFiles.thumbnail(path, 1600) ?: ImageFiles.thumbnail("$path.thumb", 1600) } }
                image?.let { ZoomablePreview(it, Modifier.weight(1f).fillMaxWidth()) }
            }
        }
    }
}
