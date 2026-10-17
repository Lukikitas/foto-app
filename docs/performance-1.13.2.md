# Rendimiento y continuidad — 1.13.2

Implementación local sobre la app original. No requiere migraciones ni cambia la base local de pendientes (IndexedDB versión 1).

## Cambios

- Cola: el listado conserva metadatos; las fotos y los tickets ya guardados se cargan para una sola tarea. Los archivos sin guardado confirmado siguen en memoria y nunca se descartan por esta optimización. Cada cambio de estado conserva los binarios almacenados. Se liberan las referencias y las promesas terminadas.
- Reintentos masivos ordenados, sincronizaciones agrupadas y cesión del hilo entre tareas. Vista de cola de 20 elementos por página, con conteos y reintento de todos.
- OCR completo en un worker en navegadores con OffscreenCanvas. Se conserva el motor Tesseract y la estrategia de detección, con alternativa en la página. Los workers se destruyen por inactividad, bloqueo o cancelación; los lienzos y bitmaps temporales se liberan. El ticket sin identificar mantiene su recuperación local y remota.
- Cámara: ráfaga de dos candidatos cuando hay ocho o más tareas pendientes o memoria declarada de hasta 2 GB; normalmente tres. En esa situación se omite la mejora opcional de foto nativa; se conserva la captura de hasta 2560 px y JPEG 0,95, zoom, flash y Repetir. La mejora nativa tiene un máximo de 1,8 s para no bloquear el guardado y pide hasta 3840 px en equipos compatibles. El video solicita 24 fps, máximo 30; las pistas se detienen al ocultar la app y se recuperan al volver.
- Galería: 30 elementos por página en celular, 100 en PC, imágenes diferidas y decodificación asíncrona. La lista en vivo conserva el máximo previo de 1000 metadatos, respetando elementos seleccionados. Los filtros permiten consultar registros anteriores. No se borran registros para mejorar el rendimiento.
- Métricas y Reclamos se descargan y montan al visitarlos en celular; mantienen sus borradores después de abrirse. Se evitan renders debidos únicamente a otras subidas.
- Actualizar con cola: pausa, espera y verificación del contenido completo de cada foto/ticket antes de activar la nueva versión. Un error de guardado, lectura o comprobación impide recargar.

## Alcance del almacenamiento

El total de objetos remotos afecta consultas y almacenamiento, pero no significa que todas las imágenes se descarguen al usar la cámara. Las imágenes visibles, el procesamiento de tickets, la cola y los recursos retenidos durante una sesión son los puntos principales de presión local. Las métricas y la protección de evidencias no cambian.

## Respaldo

Snapshot previo de código y documentación: G:/delivery star.app/backups/foto-app-pre-performance-2026-10-17T21-01-13-869Z. Incluye cambios locales previos; no es un respaldo de Supabase ni de las capturas de otros dispositivos.

## Validación y límites

Pruebas automáticas: 1000 pares guardados/restaurados comprobando bytes y metadatos; 10000 eventos de galería con selección; integración de cola con 135 capturas y reinicio; serialización, errores, cancelación, tiempos máximos y descarte de workers inactivos. Resultado: 413 pruebas aprobadas, lint y build aprobados. El build conserva la advertencia previa de import.meta en el empaquetado IIFE del service worker; el camino de worker dedicado solo se activa si Worker está disponible.

No se ha medido esta versión en un Moto G15 o iPhone físico. La revisión visual de esta sesión no pudo ejecutarse porque el proveedor de navegador no estaba disponible. Los tests con archivos sintéticos comprueban integridad y límites de referencias, no equivalen a medir la RAM física o el OCR de una cámara real.

Publicación mediante el workflow Deploy to GitHub Pages; comprobar en el Moto G15 una tanda de pedidos con zoom/flash, paso a segundo plano y recuperación, galería y lectura de tickets reales. Una pestaña antigua debe recibir la actualización para ejecutar estas mejoras; publicar no modifica por sí solo el JavaScript que ya está ejecutándose allí.
