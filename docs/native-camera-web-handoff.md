# Cámara Android desde la web — preparación del turno

Estado: publicación autorizada por el usuario el 30/10/2026. El APK 0.4.0 ya está publicado y su descarga pública fue verificada. Web 1.14.2 y Android 0.4.0-pilot (`versionCode=4`), preparados en `prepare/native-camera-web-handoff` e integrados mediante el procedimiento siguiente.

## Recorrido

- En Android, el botón de navegación **Sacar foto** abre `Delivery Star · Fotos`. Si la web se abre directamente en esa sección, muestra un botón **Sacar foto**: no lanza aplicaciones durante la carga de la página.
- El enlace usa un Android Intent fijado a `app.deliverystar.capture`. Si el navegador no puede abrirlo, Chrome redirige a `/manual/piloto-android/`, con el APK y las instrucciones de instalación. Hay un acceso visible a la descarga para navegadores que no resuelvan Intents.
- Después de instalar o actualizar, **Ya la instalé · Abrir cámara** vuelve a intentar la apertura. Android confirma la instalación; la web no puede instalar en silencio ni comprobar universalmente qué apps están instaladas.
- La app nativa abre la cámara, sin disparar una foto ni reemplazar autor, ticket, bolsa o cola. Si estaba en Envíos, vuelve a Cámara. Un ticket incompleto continúa en Bolsa. Si una captura está en curso, espera a que termine para cambiar de pestaña.
- No se transfieren fotos, credenciales ni autores por el enlace. El nombre se elige en la app nativa y se conserva allí.
- Las colas web y nativa son independientes. Los pendientes web siguen recuperándose y enviándose mediante el flujo existente. No repetir el mismo pedido en ambas apps.
- En iPhone y computadoras continúa la captura web, incluida la galería y la cámara directa. También se conserva en equipos identificados como Android anterior a 8, que no pueden instalar este APK.

**0.3.0 no maneja el enlace.** Un teléfono con esa versión se dirige a actualizar aunque ya tenga instalada la app. Mantener identificador y certificado; instalar encima, nunca desinstalar con pendientes.

## Archivos de entrega

El APK firmado y su SHA-256 se dejan en `output/native-handoff-20261030.local/`. Es una actualización de la misma app y usa el certificado de los pilotos anteriores. El HTML de descarga y `update.json` se preparan con la versión 0.4.0 y el hash real de ese APK.

`public/manual/piloto-android/release-notes-0.4.0.md` contiene el texto de publicación del APK. Las verificaciones y evidencias locales se registran al final de este documento.

## Orden de publicación

1. Revisar la rama y el estado del remoto antes de integrar. Subir primero la rama preparada, sin integrarla todavía en `restore-e44b86f` (esa rama publica Pages automáticamente).
2. Crear la publicación GitHub **prerelease** `android-capture-pilot-v0.4.0` apuntando al commit preparado, adjuntando `Delivery-Star-Fotos-0.4.0-pilot.apk` y su `.sha256`. Usar el texto de release preparado y conservar `--latest=false`. No reemplazar ni borrar los pilotos anteriores.
3. Ejecutar `rtk proxy node scripts/verify-android-pilot.mjs`. Comprueba el acceso público, el prerelease, el nombre, el tamaño y SHA-256 de la descarga y la coincidencia entre página y manifiesto preparados.
4. Integrar la rama preparada y publicar la web por el workflow habitual, **sin desplegar backend**. El workflow vuelve a verificar el APK antes de publicar Pages, para impedir que la web ofrezca una descarga inexistente.
5. Ejecutar `rtk proxy node scripts/verify-android-pilot.mjs --live`. Verificar además que el navegador recibió web 1.14.2 y aceptar el aviso de actualización de la PWA cuando no haya una captura en curso.
6. En el teléfono: con 0.3.0 o sin app, tocar Sacar foto → descargar → abrir APK → **Actualizar** o Instalar → volver a abrir la cámara desde la web. Verificar nombre, ticket, bolsa, Enviado y evidencia en la galería.
7. Probar otro acceso desde la web mientras hay un ticket pendiente: debe continuar en Bolsa con la misma foto. Probar también una breve pérdida de red y la recuperación de los envíos. Durante el turno, revisar Envíos en la app nativa y compartir diagnóstico si algo falla.

No se requieren migraciones ni cambios de funciones Supabase para este enlace. El rendimiento físico durante el turno y el gran angular del X6 Pro siguen pendientes de validación: este cambio no desbloquea una lente que el sistema no expone.

## Vuelta a cámara web

Configurar la variable del repositorio `VITE_NATIVE_CAMERA_ENABLED=false` y volver a ejecutar el deploy de frontend desactiva la apertura nativa en Android. En local puede compilarse con la misma variable. No borra ni mueve archivos de ninguna cola. Para reactivar, quitar la variable o usar `true` y publicar de nuevo.

## Verificación local

- `npm test`: 453 pruebas aprobadas. Los casos del enlace verifican paquete fijado, descarga del mismo origen, Android compatible, otros dispositivos y desactivación.
- `npm run test:ui`: verificaciones de rendimiento/navegación en escritorio y celular aprobadas, más los tres recorridos de la interfaz real: Android nativo, escritorio web y Android con vuelta a cámara web. La ampliación de la prueba nativa también verifica que cancelar cambios sin guardar no abra la app y que se conserve el ticket web original, autor y fecha.
- Android: debug/release y lint aprobados; 15 pruebas JVM aprobadas. Doce pruebas instrumentadas enfocadas aprobadas en 128,641 segundos. Incluyen enlace en frío y en caliente con el mismo ticket/autor/bytes, regreso desde Envíos sin crear otra actividad, captura Ticket/Bolsa, actualización, persistencia de 500 pares sintéticos y reanudación de subidas con HTTPS de prueba. No se enviaron fotos sintéticas a producción.
- Chrome 149 en emulador Android: comprobada la redirección real a la página de descarga con el paquete ausente y la apertura real del APK firmado al estar instalado. La vista usa el componente de producción aislado del backend; el servidor de prueba sirve el índice público de directorio igual que Pages. Capturas visuales revisadas: `output/native-handoff-20261030.local/web-camera-entry.png`, `browser-download-fallback.png` y `native-opened-from-web.png`.
- APK final: 45.725.909 bytes, SHA-256 `2120e89c5629021b416f0d16494ed4e6eeb50721c326af92c3c3f2128b8f5ec3`. Certificado SHA-256 `28e67793dfc8e10c66379c6ee5a37032863279f4a59f9b68ea587783cdab290f`, igual al de los pilotos anteriores. Identificador, versión y firma verificados; alineación de 16 KiB comprobada.
- `rtk proxy node scripts/verify-prepared-native-handoff.mjs`: coincidencia local entre APK, SHA-256, nombre, versión interna, página, manifiesto de actualización y enlace de apertura. Reporte `output/native-handoff-20261030.local/preparation-verification.json`.
- Build de frontend aprobado. Conserva el aviso previo del empaquetador sobre `import.meta` en `compressImageInWorker.js` del service worker; este cambio no modifica ese módulo.
- Tras la autorización, se publicó el [APK 0.4.0](https://github.com/Lukikitas/foto-app/releases/tag/android-capture-pilot-v0.4.0), apuntando al commit fuente `fbdaa7df9e958fe792f9dfc28c11b96653289b3c`. La descarga completa sin autenticación pasó la verificación de tamaño y SHA-256. La comprobación de página/manifiesto y versión web se ejecuta después del workflow de Pages. La experiencia del celular real durante el turno sigue pendiente.
