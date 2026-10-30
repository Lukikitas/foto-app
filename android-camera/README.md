# Delivery Star · Fotos (piloto Android)

Aplicación nativa de captura y envío. Kotlin + Compose, CameraX, Room y WorkManager. Android 8/API 26 o superior. La galería, reclamos y métricas siguen en https://delivery.star-app.com.ar.

## Preparar y compilar

Requiere JDK 17 o superior compatible con Gradle 9.1 y SDK Android 36. El wrapper fija la versión de Gradle. Desde la raíz del repositorio:

```powershell
node scripts/configure-android.mjs
cd android-camera
.\gradlew.bat :app:assembleDebug :app:testDebugUnitTest :app:lintDebug
.\gradlew.bat :app:connectedDebugAndroidTest
```

La configuración local toma únicamente URL y clave **pública** del `.env` web y crea `local.properties`, ignorado por Git. En CI se usan `SUPABASE_URL` y `SUPABASE_ANON_KEY`. No incluir claves de servicio, Google Vision ni contraseñas de firma en el APK.

APK de desarrollo: `app/build/outputs/apk/debug/app-debug.apk`. Usa un identificador separado `.debug` y un servidor de prueba inválido: los ensayos no pueden crear pedidos sintéticos en producción.

Para preparar el piloto, ejecutar desde la raíz `node scripts/prepare-android-signing.mjs` y luego, en esta carpeta, `gradlew.bat :app:assembleRelease`. El script conserva la firma existente y no imprime contraseñas. Guardar una copia privada de **ambos** archivos ignorados `pilot-signing.local` y `signing.properties`: esa identidad es necesaria para actualizar sin desinstalar ni perder pendientes. El APK de release usa la configuración real y requiere verificar el backend antes de trabajar con pedidos reales.

## Activación del backend

1. Aplicar `supabase/migrations/20261029090000_capture_registration.sql` y luego `20261029220000_capture_path_guard.sql` después de las migraciones vigentes. Son aditivas y repetibles; no modifican pedidos existentes. La segunda protege también los reenvíos de clientes web anteriores que todavía no incluyen identificador de captura.
2. Desplegar `capture-sync` con verificación JWT activa. Mantener desplegada `order-code-recovery` y su almacenamiento privado de tickets.
3. Confirmar evidencia real en un entorno de prueba: primer envío, respuesta perdida, reenvío y corrección manual entre reenvíos. El endpoint reutiliza las reglas JavaScript de códigos actuales para interpretar texto extraído localmente con ML Kit; no agrega llamadas a OCR pago.
4. Distribuir el APK piloto y comprobar en el Moto G15 los criterios del [roadmap](../docs/camera-reliability-roadmap.md).

## Garantías implementadas y límites a verificar

- Ticket y bolsa se guardan a archivo y se registran en Room antes de mostrar confirmación. Un ticket incompleto se recupera al volver a abrir.
- Repetir dispone de cinco segundos y compite de forma atómica con el inicio del envío. No altera un par que ya se está enviando.
- Evidencia, registro y ticket tienen confirmaciones persistidas separadas. El identificador UUID y el registro único del servidor permiten reanudar sin duplicar.
- Una sola tarea procesa imágenes a la vez. Las vistas muestran miniaturas y páginas de 20 elementos; nunca se carga la cola completa de imágenes en RAM.
- La historia local conserva como máximo 200 pares ya enviados. Su limpieza no elimina pendientes, errores ni la evidencia remota; la galería histórica sigue en la web.
- Las fotos reemplazadas con Repetir se limpian solo después de confirmar el envío actual. Si falla una miniatura, se conserva su original local.
- Las solicitudes incluyen plazo total y cancelación. La lectura OCR tiene un plazo propio y no bloquea la captura.
- El OCR local lee ticket y bolsa secuencialmente y conserva lecturas parciales si vence el plazo. El servidor usa las reglas compartidas de confianza; una lectura incierta queda para revisión. Los registros locales de una versión anterior siguen siendo compatibles.
- WorkManager conserva trabajos tras cierre/reinicio, pero Android puede diferirlos por ahorro de batería. Después de **Forzar detención** hay que volver a abrir la app.
- El ticket remoto conserva la ventana vigente de 72 horas. Los vencidos se señalan explícitamente, sin confundirlos con tickets enviados.
- No desinstalar ni borrar datos con pendientes. Los pendientes de la PWA pertenecen al navegador y deben verificarse por separado antes de la migración.
- El diagnóstico compartido desde Envíos contiene eventos técnicos acotados, sin fotos, códigos, texto OCR ni autores.
- La versión 0.2.0 centra la pantalla en la cámara y las miniaturas, con la paleta roja/crema y los temas claro/oscuro de la web. Nombre, gestión, diagnóstico y versión quedan en Opciones.
- El botón de gran angular usa el mínimo óptico lógico o una cámara trasera/physical ID expuesta por CameraX/Camera2, comparando focal y tamaño del sensor. No trata una cámara macro como gran angular; si el fabricante no permite abrirla, vuelve a la principal. La disponibilidad y el encuadre todavía deben comprobarse en el celular del local.
- `AppUpdates` consulta `/manual/piloto-android/update.json` al abrir/volver a la app, con un máximo de una consulta cada 15 minutos. Conserva el aviso conocido sin conexión; Opciones permite comprobar manualmente. Abre únicamente APKs del repositorio publicado. Android confirma la instalación. Incrementar `versionCode` y conservar identificador/certificado en cada publicación.
- La primera actualización desde 0.1.0 se descarga manualmente porque esa versión no tiene comprobador. Instalar encima conserva Room, archivos e identificadores; al abrir una versión nueva, los errores se vuelven a poner en cola sin borrar confirmaciones previas.
- Un fallo de inicialización del OCR ya no impide registrar/enviar las fotos. Una respuesta JSON incompleta o inválida del servidor se trata como fallo temporal. El diagnóstico identifica la etapa de subida y el código HTTP sin incluir contenido de las fotos.
- `UploadRecoveryTest` verifica el flujo de imágenes/OCR/Room con HTTPS local, respuestas interrumpidas y confirmaciones incompletas; no accede a producción. Un arranque en frío puede agotar el plazo de OCR con lectura parcial: se conserva para las reglas de confianza y se registra su duración. La captura no depende de que el OCR termine.

Los tests sintéticos, el emulador y una compilación exitosa no demuestran estabilidad física en gama media/baja. La prueba de 500 pares/2 horas y un turno completo sigue siendo un requisito de aceptación.
