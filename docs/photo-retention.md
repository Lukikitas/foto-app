# Liberación automática de fotos

La app acumula una foto por pedido en el bucket `photos`. Después del plazo configurable, la foto de un pedido que **no tuvieron ninguna queja** deja de ser necesaria: este flujo borra solo el archivo y conserva la fila, así las métricas nunca cambian. La limpieza corre en el servidor con la app cerrada.

## Qué se borra y qué nunca se toca

- **Se borra**: el archivo (blob) de las fotos bajo `orders/` con más de *N* días (7 a 365, 30 por defecto) que no tienen `has_complaint` ni `is_refutado`, siguen con `public_url` publicado y no están referenciadas por el historial de reclamos ni por la lista de importación activa.
- **Nunca se borra**: fotos de quejas o refutadas, evidencias de reclamos, archivos de `files/` ni las fotos «Código no encontrado» (pertenecen a la cola de recuperación de códigos). Si entre medio se abre una queja para ese pedido, la foto queda protegida.
- **Qué queda después**: la fila de `public.photos` con toda su metadata (`created_at`, `taken_by`, `aggregator`, flags, `name`) y `public_url = null`. Por eso Desempeño de personal, el Dashboard de Métricas, los conteos de galería y los reportes dan idénticos antes y después. En la galería la foto aparece con el cartel «Foto eliminada» y el pedido se puede seguir editando. Ocultarlo de la galería no ahorraría espacio adicional: la fila se conserva para las métricas.
- Los **tickets** (bucket `order-tickets`) siguen su ciclo propio de 72 h: ver `docs/order-code-recovery.md`.

El criterio vive en un solo lugar: `src/lib/photoRetention.js` (`isRetentionCandidate`), que usan la app, el popup de Ajustes y los tests (`photoRetention.test.js`). La función edge lleva una copia exacta de esa lógica (entre los marcadores `RETENTION_SOURCE_START/END`) porque se despliega desde el editor del dashboard, y un test de sincronización obliga a que la copia sea idéntica al original.

## Configuración

1. Ejecutar `supabase/migrations/20261008090000_photo_cleanup_settings.sql` en el proyecto Supabase (SQL Editor → pegar → Run). Crea la tabla compartida `photo_cleanup_settings` (activada por defecto, 30 días) que edita Ajustes y lee la función. Verificar con `select * from photo_cleanup_settings;` (una fila).
2. Configurar el secreto `PHOTO_CLEANUP_SECRET` desde la página: **Edge Functions → Secrets** (`https://supabase.com/dashboard/project/<ref>/functions/secrets`), agregar la clave y un valor aleatorio largo (`openssl rand -hex 32`) y **Save**. No hace falta redeploy después: el secreto se lee en cada corrida.
3. Desplegar `cleanup-photo-retention` **sin la CLI**, desde el editor del dashboard: **Edge Functions → Deploy a new function → Via Editor**, nombre `cleanup-photo-retention`, pegar el contenido completo de `supabase/functions/cleanup-photo-retention/index.ts` y **Deploy function** (mantener la verificación JWT activa: el workflow envía `Authorization: Bearer <anon>` además del header `x-cleanup-secret`). Para actualizar más adelante: abrir la función → editar → **Deploy updates**.
   - La función es autocontenida a propósito: el editor del dashboard solo empaqueta archivos dentro de la carpeta de la función y no puede importar `src/lib/`. La lógica compartida va copiada entre los marcadores `RETENTION_SOURCE_START/END` y `photoRetention.test.js` la compara carácter a carácter con `src/lib/photoRetention.js` + `compactCode`, así la copia no se puede desincronizar.
   - Si el editor marca advertencias de tipos (parámetros sin anotar), no frenan el deploy: el runtime no valida tipos.
   - Alternativa con CLI: `supabase functions deploy cleanup-photo-retention`.
4. Configurar en GitHub Actions el secreto `PHOTO_CLEANUP_SECRET` con el mismo valor (más `VITE_SUPABASE_URL` y `VITE_SUPABASE_ANON_KEY`, que ya usan los otros workflows). El workflow `cleanup-photo-retention.yml` corre todos los días a las 04:43 UTC; dispararlo manualmente con `action=dry-run` para comprobar las candidatas sin borrar. Las corridas programadas usan `cleanup`; una corrida manual real requiere elegir explícitamente `cleanup`.
5. En la app: Ajustes → «Liberación de fotos». Ahí se activa o pausa la limpieza, se cambia el plazo y se ve la última corrida con cuántas fotos borró.

## Cambiar el plazo con impacto a la vista

Al guardar un plazo distinto, Ajustes calcula **cuántas fotos se borrarían con el valor nuevo** (mismo `isRetentionCandidate` y mismas fuentes de protección que la función) y abre un popup con el número, cuántas fotos dejarían de estar protegidas por el cambio y el recordatorio de que las quejas nunca se borran. Si el resultado es 0, guarda directo sin popup; si el cálculo falla, el popup lo dice y permite guardar igual. El plazo recién se aplica en la próxima corrida diaria (no borra nada al instante). El toggle «Activar limpieza automática» guarda sin popup porque apagar no borra nada.

## Limpieza manual hasta una fecha inclusive

Desde la galería de pedidos o Ajustes, «Borrar fotos antiguas» permite elegir una fecha desde un calendario, calcular la cantidad sobre todos los pedidos y confirmar el borrado permanente de las imágenes de ese día y de los anteriores. **La fecha seleccionada está incluida**, según la hora de Argentina: el corte es el inicio del día siguiente (UTC-3), exclusivo. La fecha empieza vacía y es obligatoria; no permite elegir días futuros. Los filtros y la página visible no limitan el alcance. No cambia ni depende de la activación o del plazo automático, que sigue configurándose por cantidad de días.

La app lee el historial por `foto_document_read` y el draft activo por `foto_draft_action`; los errores cancelan el conteo. Congela el corte y las fotos que muestra la confirmación. Al confirmar, revalida historial, draft y filas por lotes de 100 y omite fotos protegidas, reemplazadas o ya eliminadas. Solo elimina archivos y actualiza `public_url`, nunca borra filas. Si falla una parte, informa borrados, errores y pendientes y permite recalcular para reintentar. La limpieza manual requiere mantener la app abierta hasta finalizar.

Los botones de borrado individual y masivo de registros se retiran de pedidos para evitar cambios accidentales en las métricas. La sección Archivos mantiene su borrado habitual. El flujo manual usa los permisos existentes del cliente; no requiere publicar una función nueva ni exponer el secreto automático.

## Cómo funciona la función

- Lee la configuración de `photo_cleanup_settings` en cada corrida: cambiar el plazo o pausar desde Ajustes no requiere redeploy.
- Protege lo que el historial ya usa (mismo emparejamiento que `findHistoryForPhoto`: `photoId`, código compacto del pedido y nombre de foto) más las fotos elegidas por la lista de importación pendiente (`foto_draft_action('read')`). Si el historial no se puede leer, la corrida **se aborta**: un fallo nunca se interpreta como «sin historial».
- Barre las candidatas de más viejas a más nuevas con un cursor compuesto por fecha e ID persistido (`photos/system/photo-retention-cursor.json`) para avanzar más allá de las filas protegidas y de las fotos con igual fecha aunque una corrida se corte por tiempo; al llegar al final reinicia el cursor para volver a chequear todo en la próxima pasada. El dry-run recorre una sola vez desde el principio, sin duplicar el conteo.
- Borra en lotes de 100 (`storage.remove`) y luego marca `public_url = null`; si la marca falla, la próxima corrida reintenta (el remove es idempotente). Responde `{ removed, failed, scanned, hasMore, retentionDays }`; el workflow repite mientras `hasMore` (máximo 10 llamados) para que la primera tanda grande alcance en un solo disparo.
- Acción `{"action":"dry-run"}`: cuenta candidatas sin borrar nada (autenticada con `x-cleanup-secret`), útil para verificar antes de la primera corrida real.
- La primera limpieza sobre una base grande puede requerir varios disparos de «Run workflow»; después converge diaria y chiquita.

## Verificación

1. `npm test` (cubre plazo, corte, referencias protegidas y exclusiones), `npm run lint`, `npm run build`.
2. Aplicar la migración y disparar `dry-run`; comparar el número con el popup de Ajustes para el mismo plazo: deben coincidir.
3. Correr `cleanup` y comparar **antes/después**: Dashboard, Desempeño de personal y Métricas → Quejas deben dar idénticos; en la galería las fotos viejas muestran «Foto eliminada»; la evidencia de una queja vieja se sigue pudiendo descargar.
4. Limpieza manual: elegir una fecha desde el calendario, comprobar la cantidad y cancelar (no cambia ningún archivo). Volver a calcular, confirmar y verificar el resultado y las métricas. Verificar que se incluya todo el día elegido en Argentina y que se excluya el día siguiente. Probar sin candidatas y con errores de conexión; un fallo de lectura no permite borrar. Fotos recién protegidas o reemplazadas se omiten al confirmar; una repetición no vuelve a borrar las ya liberadas.
5. Para los tickets: verificar `TICKET_CLEANUP_SECRET` (Supabase + GitHub) y `VITE_CLOUD_OCR_ENABLED=true`, y disparar `cleanup-order-tickets.yml` una vez. Sin esa variable el workflow se saltea en silencio.

## Límites conocidos

- El archivo borrado es irreversible; la información que queda (metadata e historial) es la que alimenta las métricas. Postgres no se achica: las filas se conservan a propósito.
- Fotos «Código no encontrado» excluidas por ahora; incluirlas exige limpiar también `order_recovery_items` y sus tickets (mejora futura).
- Si una queja llega después de borrada la foto, el reclamo se registra igual (monto, estado y métricas correctos) pero queda sin evidencia visual.
