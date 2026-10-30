# Delivery Star · Fotos — piloto Android 0.2.0

Actualización del piloto para usar en el celular del local **sin USB ni computadora**. La estabilidad durante un turno real sigue pendiente de validación.

## Cambios

- Cámara casi a pantalla completa y fotos grandes en Envíos. Nombre, gestión y diagnóstico pasan al menú ⋮.
- Colores de la app web, con aspecto sistema, claro u oscuro.
- Gran angular cuando Android expone esa lente; 1× y zoom, sin confundir la cámara macro con gran angular. Si el fabricante impide abrir la lente, vuelve a la principal.
- El fallo de inicialización del lector de tickets ya no impide registrar ni enviar las fotos. Las respuestas incompletas del servidor se reintentan. Los errores indican la etapa y el diagnóstico incluye código HTTP, versión y modelo, sin fotos ni contenido del ticket.
- Los errores anteriores vuelven a cola al abrir una versión nueva, conservando sus archivos, identificadores y confirmaciones.
- Aviso de **Actualización pendiente** al detectar una versión nueva. También disponible en **⋮ → Buscar actualizaciones**.

La captura de pantalla del error 0.1.0 no identifica su causa exacta. Se verificó que la evidencia estaba almacenada y que el contrato de registro del servidor respondía correctamente; las correcciones cubren fallos del cliente que podían interrumpir ese paso. Si el pendiente vuelve a fallar, compartir el diagnóstico para confirmar la causa del equipo real.

## Actualizar desde 0.1.0

1. Abrir desde el celular [la guía de instalación](https://delivery.star-app.com.ar/manual/piloto-android/), o descargar `Delivery-Star-Fotos-0.2.0-pilot.apk` adjunto a esta publicación.
2. Abrir el APK. Si Android lo solicita, permitir la instalación desde ese navegador. Elegir **Actualizar** sobre Delivery Star · Fotos.
3. **No desinstalar ni borrar almacenamiento**: actualizar encima conserva fotos y pendientes. Requiere Android 8 o posterior.
4. Volver a abrir la app y comprobar **Envíos**: los errores anteriores se reintentan sin volver a fotografiar el pedido.

0.1.0 todavía no puede mostrar avisos de actualización: este primer paso es manual. Desde 0.2.0, se consulta el manifiesto al abrir/volver a la app, como máximo cada 15 minutos. **Actualizar** abre el APK publicado y Android pide confirmar la instalación; no se instala en silencio.

Se conserva el identificador `app.deliverystar.capture` y el certificado del piloto anterior. Los pendientes de la web y de Foto-app Cámara 1.0.3 pertenecen a esas aplicaciones y se comprueban por separado.

## Primera prueba

Probar un grupo de 20 pedidos reales: ticket y después bolsa. Continuar cuando diga **Par guardado en este celular**. Usar una sola app por pedido para evitar cargas duplicadas.

Comprobar que los pares llegan a **Enviado** en Envíos y aparecen correctamente en **⋮ → Gestión web**. Si se corta la conexión, conservar los pendientes y comprobar que se envían al recuperarla. Probar el botón de gran angular, si aparece, y revisar que el archivo guardado tenga el mismo encuadre amplio de la vista previa.

Si funciona el primer grupo, seguir con el turno y registrar cantidad de pares, horario de cualquier falla y tipo de conexión. Las pruebas largas del roadmap siguen pendientes; el ensayo inicial no las reemplaza.

## Diagnóstico desde el local

En **Envíos → Compartir diagnóstico**, compartir `diagnostico-fotos.json` con quien coordina la prueba para adjuntarlo a esta conversación. Hacerlo apenas aparezca una falla, junto con horario aproximado y Wi-Fi o datos.

El archivo incluye versión, Android, fabricante/modelo y eventos técnicos recientes. No incluye fotos, nombres, códigos ni texto del ticket. No se envía automáticamente. Conservar los datos de la app para recuperar los pendientes.

## Versión y verificaciones

- Código: etiqueta `android-capture-pilot-v0.2.0`; versión interna 2.
- Tamaño: 45.725.741 bytes.
- SHA-256: `e425bcaae33523d04a66e87da421718cd0206b2b4f94d25f6b51aadc78dd6c95`.
- Firma SHA-256: `28e67793dfc8e10c66379c6ee5a37032863279f4a59f9b68ea587783cdab290f`.
- Compilación debug/release, once pruebas JVM y lint aprobados.
- Verificaciones instrumentadas en emulador: recuperación de 500 pares, actualización de cola sin borrar originales ni confirmaciones, captura/navegación y aviso pendiente sin conexión; flujo HTTPS aislado con OCR real, lector no disponible, reintentos por etapa y originales conservados hasta confirmar ticket.
- La disponibilidad del gran angular, el rendimiento, la legibilidad y la batería del celular real requieren la prueba en el local.
