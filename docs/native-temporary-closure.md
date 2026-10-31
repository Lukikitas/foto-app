# Cierre temporal de Delivery Star · Fotos

## Estado actual — solo aviso (web 1.14.4 y Android 0.6.0-pilot)

Por la última indicación, se retira todo acceso a envíos, fotos, gestión y diagnóstico. Quedan únicamente el cierre y el agradecimiento, más el aviso de una nueva actualización cuando esté disponible. Se elimina también el botón manual de comprobación de Android; la comprobación automática al abrir o retomar sigue activa. La página pública de descarga solo ofrece actualizar, sin enlaces para abrir la app o gestión.

No se borran registros ni archivos. El procesamiento de capturas ya guardadas se conserva sin exponer la cola en la interfaz. La actualización web mantiene la comprobación de persistencia antes de activar el service worker. Los enlaces nativos en frío y caliente siguen mostrando el aviso.

Las pruebas de cierre comprueban la ausencia de accesos operativos y conservan la verificación de bytes, autor y fecha del ticket y los pendientes. El resto de este documento registra la primera entrega; el acceso a pendientes descrito allí fue retirado en esta revisión. Las versiones antiguas requieren aceptar la actualización web o instalar el APK nuevo para aplicar el cambio.

Validación de esta revisión: CI de aplicación `41170652752` aprobado (frontend, base y servicios), CI Android `41170540370` aprobado, compilación local debug/release, pruebas JVM y lint aprobados. Las dos pruebas instrumentadas de cierre pasaron en 42,815 segundos: actualización futura sin conexión y apertura desde ícono/enlaces en frío y caliente, con ticket original intacto. El APK firmado tiene 45.037.781 bytes y SHA-256 `a308ff8b428d702d924ee168ed51ccd22f0dd0aff1477bcdac3ccbbead08920f`; certificado de los pilotos anteriores y alineación de 16 KiB verificados. Evidencia en `output/closure-notice-only-20261031.local/`.

Versión Android 0.5.0-pilot, `versionCode=5`, solicitada el 31/10/2026.

Al abrir desde el ícono o desde la web, la pantalla de inicio muestra:

> La app se encuentra momentáneamente cerrada
>
> Gracias por haberla usado y por ayudarnos en su desarrollo. Cada prueba y cada aporte nos ayudaron a mejorarla.

La actualización deshabilita nuevas capturas. El aviso no pide permiso de cámara ni exige ingresar un nombre. El cierre está incluido en el APK y funciona sin conexión.

Se conservan base de datos, archivos y autor; los envíos existentes continúan usando el procesamiento y las confirmaciones habituales. **Ver envíos pendientes** permite consultar fotos, reintentar errores y compartir el diagnóstico. Volver al aviso no habilita la cámara. Los pendientes del navegador siguen siendo independientes.

**Buscar actualizaciones** y el aviso de una próxima versión siguen disponibles para una futura reapertura. Para reabrir, preparar una nueva versión con `CAPTURE_TEMPORARILY_CLOSED=false`, incrementar versión interna y publicar con el mismo identificador/certificado. Las pruebas anteriores de cámara se omiten explícitamente durante el cierre y vuelven a ejecutarse al desactivarlo; las de persistencia, subida y cierre siguen activas.

El APK se instala encima de la versión existente con **Actualizar**, sin desinstalar ni borrar datos. Las instalaciones anteriores muestran la actualización disponible; el cierre se aplica después de instalar 0.5.0. No se bloquean remotamente versiones anteriores.

Publicar primero el APK firmado como prerelease `android-capture-pilot-v0.5.0`, comprobar su descarga pública y después publicar página/manifiesto de actualización. La comprobación automática de Pages impide publicar enlaces sin el APK correspondiente. El procedimiento general está en [la guía de publicación](native-camera-web-handoff.md).

## Validación

Debug/release y lint aprobados; 15 pruebas JVM y 9 pruebas instrumentadas aprobadas (15,379 segundos). Las pruebas cubren aviso sin conexión, apertura desde ícono y enlace web en frío/caliente, conservación exacta del ticket/autor/fecha, acceso a Envíos, futuras actualizaciones, persistencia de 500 pares sintéticos y recuperación de subidas con HTTPS local. Las imágenes sintéticas no se enviaron a producción. Se revisó visualmente el aviso y se comprobó su apertura en el APK firmado.

APK: `Delivery-Star-Fotos-0.5.0-pilot.apk`, 45.136.085 bytes, SHA-256 `c97c64bd023c7c84c821c3416c4ed726013a45654044da70eb4a7c61aa833cf5`. Certificado SHA-256 `28e67793dfc8e10c66379c6ee5a37032863279f4a59f9b68ea587783cdab290f`, igual al de los pilotos anteriores; alineación de 16 KiB verificada. Artefactos y evidencia local en `output/temporary-closure-20261031.local/`. La comprobación local confirmó coincidencia entre APK, versión, SHA-256, página, manifiesto y enlace de apertura. Build de la web aprobado; no cambia su código de captura o gestión.

## Extensión a la app web — 1.14.3

Por la solicitud posterior del usuario, la app web también muestra el mismo cierre y agradecimiento en celular y PC. El aviso reemplaza toda la interfaz operativa, incluida gestión y captura. No se montan las pantallas habituales ni sus tareas de importación o limpieza.

Se conserva la recuperación y el envío de capturas ya guardadas. **Ver envíos pendientes** mantiene la cola y sus reintentos; los tickets incompletos permanecen en IndexedDB. No se borran datos locales ni remotos. El aviso de actualización PWA y la comprobación de guardado antes de recargar siguen activos, para recibir una futura reapertura sin forzar recargas sobre capturas sin guardar.

El cierre está activo por defecto y se controla al compilar con `VITE_APP_TEMPORARILY_CLOSED`. El deploy usa la variable del repositorio; `true` cierra la web, `false` permite preparar su reapertura. Cambiarla requiere un nuevo deploy y que el navegador/PWA reciba esa actualización. No es una restricción de acceso al backend ni revoca instalaciones antiguas.

Las pruebas de interfaz operativa fijan explícitamente `false` para mantener la cobertura de la futura reapertura. Las nuevas pruebas usan el cierre por defecto en móvil y escritorio, bloquean navegación/captura/enlace nativo y comprueban en IndexedDB los bytes, autor y fecha del par pendiente y del ticket incompleto.
