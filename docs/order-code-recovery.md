# Respaldo de OCR para pedidos

La lectura local funciona sin servicios adicionales. El respaldo de Google Vision se habilita solo cuando la función de Supabase y sus secretos están configurados.

1. Crear un proyecto de Google Cloud dedicado y habilitar Cloud Vision API. Crear una clave de API restringida a Cloud Vision y configurar alertas de facturación. La cuota de la aplicación reserva como máximo 6.000 imágenes por mes UTC; esta cuota no es un límite rígido de la factura de Google.
2. Ejecutar `supabase/migrations/20260926_order_code_recovery.sql` en el proyecto Supabase. La migración crea el bucket privado, el límite atómico de OCR y el límite de 250 MB para tickets sin resolver.
3. Configurar en Supabase Functions los secretos `GOOGLE_VISION_API_KEY` y `TICKET_CLEANUP_SECRET`. Desplegar `order-code-recovery` con la verificación JWT activa.
4. Configurar en GitHub Actions el secreto `TICKET_CLEANUP_SECRET` con el mismo valor. El workflow `cleanup-order-tickets.yml` elimina los tickets vencidos cada hora. Ejecutarlo manualmente una vez para comprobar el resultado.
5. Configurar la variable de repositorio `VITE_CLOUD_OCR_ENABLED=true` y ejecutar el workflow de despliegue de GitHub Pages. La variable debe permanecer desactivada hasta que los pasos anteriores funcionen.

Los tickets se suben solo para pedidos que siguen sin código, se comprimen a 1600 px y se eliminan al confirmarse el código o después de 72 horas. Si el bucket no tiene espacio, el ticket permanece en el celular y el pedido sigue guardándose. Las fotos anteriores a esta función no tienen ticket remoto; se reanaliza la foto de la bolsa.
