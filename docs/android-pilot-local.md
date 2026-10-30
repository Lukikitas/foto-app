# Delivery Star · Fotos — piloto Android 0.3.0

Actualización para el celular del local, sin USB ni computadora.

## Cambios

- Una banda fija muestra **1 · TICKET / 2 · BOLSA** y resalta en rojo el paso actual. Sin animaciones, sonidos ni avisos que tapen la cámara.
- **Flash abajo a la derecha**, con su estado encendido/apagado; Repetir queda encima.
- Nuevo selector **Lentes → Cámaras traseras** para elegir las lentes que la app puede abrir, incluso cuando los metadatos no permiten reconocer automáticamente el gran angular.
- La detección revisa todas las traseras y sus cámaras físicas por separado. Corrige el uso de la focal mínima como referencia, incorpora área activa/orientación del sensor y permite seleccionar una trasera sin depender exclusivamente del zoom informado.
- La selección física se aplica conjuntamente a vista previa y foto. Si una ruta no puede abrirse, vuelve a la principal y permite probar las demás; no descarta todas las lentes por una sola falla.
- Se mantiene el guardado local, la recuperación de pendientes y el aviso de nuevas versiones.

## Actualizar

Desde 0.2.0, usar **Actualización pendiente → Actualizar** o **⋮ → Buscar actualizaciones**. Si no aparece todavía, abrir [la guía de descarga](https://delivery.star-app.com.ar/manual/piloto-android/) y descargar `Delivery-Star-Fotos-0.3.0-pilot.apk`.

Abrir el archivo y elegir **Actualizar** sobre Delivery Star · Fotos. **No desinstalar ni borrar datos**: se conservan los pendientes. Android pide confirmar la instalación. El identificador y el certificado son los mismos; versión interna 3. Desde 0.1.0, la descarga inicial sigue siendo manual.

Los pendientes de la app web y de Foto-app Cámara 1.0.3 son independientes y se comprueban allí.

## Comprobar en el local

1. Verificar que la banda y el botón de captura indiquen Ticket; fotografiarlo y comprobar que ambos pasan a Bolsa.
2. Probar el flash con el botón inferior derecho. Al cambiar de lente puede variar su disponibilidad.
3. Abrir **Lentes**. Elegir **Gran angular**, si está identificado, o probar la otra trasera disponible. Comprobar que la vista se ensancha y que la foto guardada conserva ese encuadre; volver a **1×** para la principal.
4. Comprobar en Envíos y **⋮ → Gestión web** que los pedidos llegan correctamente. La validación durante un turno real sigue pendiente.

Algunos fabricantes no exponen todas las lentes a otras apps. El selector no inventa un gran angular ni convierte una macro en gran angular. Si sigue faltando la lente, compartir **Envíos → Compartir diagnóstico**, indicando marca/modelo y si el botón falta o no abre la lente.

El diagnóstico agrega un inventario acotado de ópticas y de disponibilidad en CameraManager/CameraX. No incluye IDs de cámara, fotos, autores, códigos ni texto del ticket. No se envía automáticamente y no requiere conectar el teléfono.

## Verificaciones

- Código: etiqueta `android-capture-pilot-v0.3.0`; versión interna 3.
- Tamaño: 45.725.741 bytes.
- SHA-256: `e0c89898daa0eeb05fc9bd4983d057ca562c8f16090fe0fb7638fefa1e7bcb93`.
- Firma SHA-256: `28e67793dfc8e10c66379c6ee5a37032863279f4a59f9b68ea587783cdab290f`.
- Compilación debug/release, catorce pruebas JVM y lint aprobados.
- Pruebas instrumentadas en emulador: etapas Ticket/Bolsa, ubicación del flash, selector de lentes sin modificar capturas, recuperación/actualización de cola, persistencia de 500 pares, navegación, aviso sin conexión y flujo HTTPS aislado con fallos de OCR/subida.
- El emulador no demuestra que el gran angular físico del celular del local esté disponible: esa comprobación requiere usar el APK allí.
