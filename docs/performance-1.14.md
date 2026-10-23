# Rendimiento 1.14: implementación y activación

## Cambios

- Galería e Historial consultan páginas reales de 30 filas en celular y 100 en PC. Los filtros se aplican antes de paginar. La galería fija la fecha de inserción del servidor al iniciar una consulta: una captura que llega tarde de una cola offline no desplaza las páginas ya abiertas. `created_at` sigue representando la captura.
- Selección entre páginas y exportación completa bajo demanda. Las exportaciones del historial verifican la revisión entre páginas y avisan si los datos cambian, en vez de entregar un archivo incompleto.
- Documentos y borradores se verifican por revisión, con solicitudes simultáneas compartidas. Gestionar sondea solo estando visible. Los resúmenes de métricas, informes, desempeño y pendientes se calculan en el servidor con las funciones de negocio originales; las tablas de detalle de métricas se renderizan por páginas.
- Los borradores de métricas conservan su base de edición aunque se lean otras revisiones o se cambie de pantalla. Los documentos completos y los resúmenes parciales tienen cachés separadas.
- La cámara tiene prioridad: el OCR espera tres segundos sin interacción y cede cuando se vuelve a disparar, ajustar zoom o cambiar de lente. En navegadores que requieren procesamiento de OCR en la página, espera al cierre de cámara. La preparación de nitidez en la página cede entre bloques de filas y produce los mismos píxeles.
- Persistencia inicial de capturas inmediata al entrar en la cola; la ventana existente de Repetir se conserva. Durante el procesamiento se actualizan metadatos conservando los Blob almacenados. Las notificaciones se agrupan y las actualizaciones del service worker identifican la tarea modificada. La cola offline espera conexión y conserva las capturas.
- Las miniaturas JPEG de hasta 480 px se generan fuera de la captura mediante trabajos persistentes. Reemplazos y liberación de fotos invalidan su miniatura y encolan su limpieza. Se conserva la evidencia original para ampliar, descargar y refutar. Mientras falta una miniatura se usa la imagen disponible.
- Caché de descargas limitada a 16 MiB. Los recursos OCR y módulos pesados se cachean al usarlos, sin precargar todas las variantes del motor.
- Los cruces de personal buscan por código antes de verificar fecha y agregador; los formateadores de fecha se reutilizan. La consulta de almacenamiento usa uniones por referencias y rutas para evitar escaneos repetidos.
- Consultas de páginas con plazo máximo de 15 segundos y vistas del servidor de 45 segundos. Cambiar de pantalla o búsqueda cancela solicitudes anteriores. Los fallos muestran un error y conservan los datos y borradores; no se publican copias antiguas como datos actuales.

## Orden de activación

La implementación local requiere activar su backend **antes de publicar el frontend 1.14**. Los clientes anteriores siguen funcionando con estas migraciones aditivas. No aplicar los SQL de `tests/database` a producción.

1. Conservar un respaldo de la base y verificar que las migraciones anteriores de documentos, retención y almacenamiento ya estén aplicadas.
2. Aplicar, en este orden, `supabase/migrations/20261023090000_performance_reads.sql` y `supabase/migrations/20261023091000_photo_thumbnails.sql`. Son repetibles. Agregan RPC de lectura, índices, `thumbnail_path`, `registered_at` y trabajos de miniaturas. No eliminan fotos ni pedidos. Las escrituras transaccionales actuales permanecen disponibles.
3. Preparar el WASM fijado y desplegar las funciones desde la raíz del repositorio:

   ```sh
   npm ci
   npm run prepare:thumbnails
   supabase functions deploy performance-data --project-ref <proyecto>
   supabase functions deploy photo-thumbnails --project-ref <proyecto>
   ```

   Usar Supabase CLI con Docker para incluir los archivos estáticos declarados en `supabase/config.toml`; no usar `--use-api` para la función de miniaturas. `performance-data` importa las funciones compartidas del repositorio: desplegar con CLI, no copiando solo el cuerpo al editor web.
4. Configurar `PHOTO_THUMBNAIL_SECRET` en los secretos de Supabase y GitHub con el mismo valor aleatorio. El workflow utiliza también `VITE_SUPABASE_URL` y `VITE_SUPABASE_ANON_KEY`, como los trabajos existentes. La clave de servicio permanece en Supabase.
5. Ejecutar manualmente **Process photo thumbnails**. Verificar una miniatura nueva y una foto anterior; comprobar que ampliar y descargar siguen utilizando la evidencia original. El trabajo programado procesa como máximo 40 imágenes cada cinco minutos y retoma la cola histórica. Los fallos conservan el original y se reintentan hasta cinco veces.
6. Publicar el frontend mediante el workflow existente y comprobar las RPC/vistas con datos actuales. Actualizar las sesiones abiertas usando la comprobación de pendientes que ya ofrece la app.

El workflow **Deploy to GitHub Pages** permite desplegar las funciones desde un runner con Docker: activar `deploy_backend` y desactivar `publish_frontend` para verificar primero el backend. Requiere `SUPABASE_ACCESS_TOKEN` como secreto de GitHub y las migraciones ya aplicadas. Verifica lecturas actuales y procesa dos trabajos de miniaturas antes de permitir la publicación. Para publicar el frontend por separado, usar `publish_frontend` o el push a la rama de publicación.

El generador usa ImageMagick WASM, con licencia y avisos copiados al paquete estático. Referencias de empaquetado: [WASM en Supabase](https://supabase.com/docs/guides/functions/wasm) e [imágenes en Edge Functions](https://supabase.com/docs/guides/functions/examples/image-manipulation).

## Verificación automática

Verificación del 23/10/2026: 424 pruebas unitarias aprobadas, integración React DOM en tamaños PC y celular aprobada, SQL aislado aprobado, codec WASM real aprobado y comprobación de tipos de ambas funciones Edge aprobada. ESLint y compilación de producción aprobados tanto localmente como en GitHub Actions. La compilación inicial generó un precache de 29 entradas y 1.371,05 KiB; los motores OCR se descargan al usarlos. La compilación conserva un aviso previo de `import.meta` en el bundle IIFE del service worker (`compressImageInWorker.js`); la ruta de respaldo usa la compresión directa cuando no hay Worker.

Backend activado y verificado en producción el 23/10/2026: ambas migraciones aplicadas y registradas, índices creados, ambas funciones desplegadas, secretos configurados y lecturas verificadas sobre 7.985 fotos y 470 reclamos. [Ejecución del backend y verificaciones](https://github.com/Lukikitas/foto-app/actions/runs/39963616424). Se generaron miniaturas reales de 360 × 480 px (22–25 KiB) para una foto antigua y una reciente; los SHA-256 de ambos originales permanecieron idénticos. El cruce de personal conservó exactamente los resultados en una muestra real de 6.012 fotos y 152 reclamos. Estas comprobaciones puntuales no son mediciones p95 ni una prueba física de cámara.

Respaldo previo de las tablas públicas y sus definiciones guardado localmente en `output/activation-20261023.local/production-before-1.14.json.gz`, excluido de Git. Las imágenes originales permanecen en su almacenamiento; el respaldo local contiene registros y definiciones, no los archivos de evidencia.

```sh
npm test
npm run test:ui
npm run test:database
npm run lint
npm run build
npm run prepare:thumbnails
deno check --node-modules-dir=none --no-lock supabase/functions/performance-data/index.ts supabase/functions/photo-thumbnails/index.ts
deno test --node-modules-dir=none --no-lock --allow-read supabase/functions/photo-thumbnails/thumbnail_test.ts
```

- Pruebas de React DOM con datos sintéticos: 10.000 fotos/250 reclamos, tamaños celular y PC, páginas, selección, vistas ocultas y conservación de borradores. Son pruebas de integración en JSDOM; no miden cámaras, RAM física ni presentación visual.
- Base aislada: 50.000 fotos/10.000 reclamos, totales y filtros, fechas/horas inclusivas, capturas offline tardías, lecturas sin cambios, protecciones de almacenamiento, migraciones repetidas y miniaturas de fotos reemplazadas o liberadas.
- Paridad entre los cálculos originales y los resúmenes del servidor: estados, dinero, montos faltantes, calidad, desempeño, pendientes e informes/exportaciones completas.
- Codec WASM real: miniatura JPEG acotada y bytes originales sin cambios. No sustituye una prueba de límites del entorno Edge con fotos reales grandes.

Para revisar la interfaz manualmente: `npm run dev` y `/tests/ui/performance.html`. Utiliza datos sintéticos e intercepta las consultas de Supabase; las escrituras están deshabilitadas.

## Medición y seguimiento

Abrir la app con `?performance=1` habilita diagnósticos locales. `window.fotoPerformance()` devuelve las últimas 200 muestras: duración, cantidad de filas o bytes cuando están disponibles y tareas largas de la interfaz. No registra códigos, autores, fotos, tickets ni URLs, y no envía telemetría a terceros.

Comprobar después de activar:

- Red normal y lenta: arranque, galería, historial, métricas, desempeño y ajustes. La primera consulta de galería/historial debe devolver únicamente una página, independientemente del total almacenado.
- Android, Safari/iPhone y PC: tandas de 100 pares durante 30 minutos, zoom, flash, Repetir, navegación previa, desconexión/reconexión, segundo plano y actualización con pendientes. Verificar integridad y recuperación de fotos/tickets sin duplicados.
- Dos dispositivos: edición/importación concurrente, selección entre páginas, filtros rápidos y exportación mientras cambia el historial.
- Metas a medir: controles en 200 ms, primera página actualizada p95 menor de dos segundos bajo una conexión de referencia documentada, reducción de al menos 50 % en pantallas que excedían ese tiempo y ausencia de tareas propias mayores de 100 ms durante captura. Estos objetivos no se declaran logrados sin medición física.

Supervisar errores/latencia de `performance-data`, ejecuciones del workflow y cantidades por `status` en `foto_thumbnail_jobs`. Los trabajos agotados o con lease vencido requieren revisar el error/límite antes de reintentarlos. La caída del generador conserva las fotos y permite que la interfaz use el original.

Para revertir el frontend, publicar la versión anterior y conservar las migraciones y los documentos. Se puede desactivar el workflow de miniaturas sin afectar capturas, métricas o evidencias. No borrar el almacenamiento ni reiniciar IndexedDB para revertir una optimización.
