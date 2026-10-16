# Recuperación de fotos pendientes

La actualización de la PWA conserva la base IndexedDB foto-app-upload-queue (versión 1). No se cambia su nombre, estructura ni se eliminan registros pendientes. Los errores antiguos de createImageBitmap permanecen disponibles al volver a abrir la app; Reintentar todas utiliza los mismos archivos, IDs, hora de captura y rutas de subida. Los registros solo se retiran automáticamente al terminar la subida. Descartar pendiente exige confirmación.

La lectura de evidencia y OCR utiliza primero createImageBitmap. Si falla, intenta reconstruir un Blob a partir de los bytes originales y, en la página, cargarlo como imagen mediante URL de objeto o de datos. El worker puede volver al procesamiento en la página. Se liberan bitmaps y URLs al terminar. Una imagen vacía o ilegible sigue en error y conserva sus referencias originales; no se reemplaza por otra captura ni se sube un archivo sin poder procesarlo. No es posible garantizar la recuperación de bytes que el dispositivo ya no conserve.

Para utilizarlo en el celular: publicar la corrección, aplicar Actualizar en el mismo navegador/perfil donde están las fotos, abrir la cola y pulsar Reintentar todas manteniendo la app visible. Los elementos marcados Error no bloquean la actualización; los que siguen en lectura, preparación o subida se esperan. No desinstalar, borrar almacenamiento del sitio ni descartar pendientes para actualizar.

Validación: pruebas de lectura alternativa tras fallos del decodificador, copia de archivos restaurados, conservación exacta de evidencia/ticket al recargar, reanudación de preparación y reintento con la misma ruta sin duplicar. No se accedió a las fotos pendientes del celular del usuario y no se afirma haberlas recuperado todavía.
