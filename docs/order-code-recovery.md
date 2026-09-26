# Respaldo de OCR para pedidos

La lectura local funciona sin servicios adicionales. El respaldo de Google Vision se habilita solo cuando la función de Supabase y sus secretos están configurados.

1. Crear un proyecto de Google Cloud dedicado y habilitar Cloud Vision API. Crear una clave de API restringida a Cloud Vision y configurar alertas de facturación. La cuota de la aplicación reserva como máximo 6.000 imágenes por mes UTC; esta cuota no es un límite rígido de la factura de Google.
2. Ejecutar `supabase/migrations/20260926_order_code_recovery.sql` en el proyecto Supabase. La migración crea el bucket privado, el límite atómico de OCR y el límite de 250 MB para tickets sin resolver.
3. Configurar en Supabase Functions los secretos `GOOGLE_VISION_API_KEY` y `TICKET_CLEANUP_SECRET`. Desplegar `order-code-recovery` con la verificación JWT activa.
4. Configurar en GitHub Actions el secreto `TICKET_CLEANUP_SECRET` con el mismo valor. El workflow `cleanup-order-tickets.yml` elimina los tickets vencidos cada hora. Ejecutarlo manualmente una vez para comprobar el resultado.
5. Configurar la variable de repositorio `VITE_CLOUD_OCR_ENABLED=true` y ejecutar el workflow de despliegue de GitHub Pages. La variable debe permanecer desactivada hasta que los pasos anteriores funcionen.

Los tickets se suben solo para pedidos que siguen sin código, se comprimen a 1600 px y se eliminan al confirmarse el código o después de 72 horas. Si el bucket no tiene espacio, el ticket permanece en el celular y el pedido sigue guardándose. Las fotos anteriores a esta función no tienen ticket remoto; se reanaliza la foto de la bolsa.

## Revisión diaria en el servidor

1. Aplicar primero la migración anterior y después `supabase/migrations/20260926150000_scheduled_order_recovery.sql` y `supabase/migrations/20260926153000_guard_manual_recovery_override.sql`. Estas agregan el agregador explícito a las fotos, una configuración compartida (desactivada por defecto, 03:00 de Argentina, solo propuestas), ejecuciones reanudables y auditoría. La última protege una corrección manual frente a una lectura automática que todavía esté en curso.
2. Habilitar `pg_cron` y `pg_net` en Supabase. Crear en Vault `foto_app_url` (URL base del proyecto), `foto_app_anon_key` y `foto_app_recovery_secret` (valor aleatorio largo). Configurar el mismo valor como secreto `ORDER_RECOVERY_CRON_SECRET` de la Edge Function.
3. Desplegar nuevamente `order-code-recovery` con verificación JWT. Ejecutar `supabase/schedule_order_code_recovery.sql` una vez para registrar el cron de un minuto. El cron consulta la hora argentina y solo invoca la función si la revisión está activa y el trabajo del día sigue pendiente.
4. Comprobar en un entorno de prueba la lectura de configuración desde dos dispositivos, una invocación del cron con la app cerrada, propuestas, corrección y vuelta a “Sin código”, límite de cuota, caducidad de tickets y clasificación por agregador. Recién entonces activar la revisión desde Ajustes. Mantener primero “Solo proponer”; habilitar la confirmación automática tras revisar una muestra real de propuestas.

La tarea procesa un pedido por invocación, prioriza tickets próximos a vencer y usa bloqueos temporales para reanudar un pedido si una función se interrumpe. Los resultados vacíos se reintentan a los siete días. Una corrección manual bloquea nuevos intentos automáticos sobre ese pedido. La confirmación automática exige dos lecturas completas, etiquetadas e idénticas: una del ticket y otra de la foto de evidencia. Cuando falta una de las dos o hay desacuerdo, queda una propuesta para revisión.

La tarea reserva como máximo 5.500 imágenes por mes UTC y deja las 500 restantes para captura y revisión manual. Ambas rutas comparten el tope absoluto de 6.000. La reserva ocurre antes de llamar a Google; un fallo puede consumir una unidad de la cuota interna. El estado y el consumo se muestran en Ajustes.

Los tickets dejan de ser elegibles al cumplir 72 horas. El borrado físico remoto se hace en el siguiente barrido horario; los tickets locales vencidos se eliminan cuando la app vuelve a abrirse o mostrarse. Las lecturas manuales y programadas comparten un bloqueo por foto para evitar consultas simultáneas duplicadas a Vision.

Por decisión del producto, Ajustes y la revisión manual no requieren autenticación en esta etapa: cualquier persona con acceso a la aplicación puede modificarlos. El secreto del cron y la clave de Google permanecen exclusivamente en el servidor. La autenticación de administradores queda para una etapa posterior.

Para detener la tarea, desactivar “Revisión diaria” en Ajustes. El cron seguirá comprobando el ajuste, pero no procesará fotos. La limpieza horaria de tickets sigue siendo independiente.
