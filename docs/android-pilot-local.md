# Delivery Star · Fotos — piloto Android 0.1.0

Se puede instalar y probar en el celular del local **sin USB ni computadora**. Es un piloto: todavía falta validar la estabilidad durante un turno real.

## Instalar en el local

1. Abrir desde el celular [la guía de instalación](https://delivery.star-app.com.ar/manual/piloto-android/), o descargar el archivo `Delivery-Star-Fotos-0.1.0-pilot.apk` adjunto a esta publicación.
2. Abrir el APK descargado. Si Android lo solicita, habilitar la instalación desde el navegador utilizado. No es necesario activar la depuración USB.
3. Abrir **Delivery Star · Fotos**, permitir la cámara e indicar quién toma las fotos. Requiere Android 8 o posterior.

El piloto tiene un identificador distinto de Foto-app Cámara 1.0.3 y del navegador. No hace falta desinstalar la aplicación anterior. Sus pendientes no se transfieren automáticamente: antes de cambiar, comprobar los envíos pendientes allí. No borrar sus datos para destrabarla.

## Primera prueba

Usar el piloto con un primer grupo de 20 pedidos reales: ticket y luego bolsa. Continuar con el siguiente pedido cuando diga **Par guardado en este celular**. Evitar fotografiar el mismo pedido en ambas apps durante el ensayo para no cargarlo dos veces.

Desde **Envíos**, comprobar que los pares llegan a **Foto y ticket enviados**. Desde **Gestión**, comprobar que aparecen las fotos correctas. Si se corta la conexión, los pendientes deben conservarse y reintentarse al recuperarla. Si hay un problema, conservar los datos de la app.

Si el primer grupo funciona, continuar la validación durante el turno y registrar cantidad de pares, horario aproximado y cualquier demora o cierre. Las pruebas largas del roadmap siguen pendientes; este ensayo inicial no las reemplaza.

## Diagnóstico sin conectar el teléfono

Abrir **Envíos → Compartir diagnóstico**. Enviar el archivo `diagnostico-fotos.json` al responsable de la prueba para adjuntarlo a esta conversación. Hacerlo al terminar el ensayo o apenas aparezca una falla, junto con el horario aproximado y si estaban usando Wi-Fi o datos.

El archivo contiene versión, versión de Android y eventos técnicos recientes. No incluye fotos, nombres, códigos de pedidos ni texto leído del ticket. La app no lo envía automáticamente.

## Versión y verificaciones

- Código del APK: `670dfcc505fa9a5cf2fbb07a4c124cdc440cc8b6`.
- Tamaño: 45.709.361 bytes.
- SHA-256: `f878b3fc2c58f85b1bcdf2fbd1c012a532c0722efae39ca35afbd387ebadcfa4`.
- Firma SHA-256: `28e67793dfc8e10c66379c6ee5a37032863279f4a59f9b68ea587783cdab290f`.
- Compilación, pruebas JVM y pruebas de recuperación en emulador aprobadas. Rendimiento, legibilidad y comportamiento de batería del equipo real todavía pendientes.
