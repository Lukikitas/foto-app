# React + Vite

## Versión 1.7

### Galería paginada

La galería de pedidos (y Archivos) se pinta de 100 en 100: barra con «‹ Anterior», números de página con saltos («1 … 5 6 … 12»), «Siguiente ›» y el rango visible («Mostrando 1–100 de 857»). La primera tira de datos (≈300 filas) se pinta en el instante y el resto llega en segundo plano con «Actualizando…»; el límite sigue siendo las 1000 fotos más recientes. Cambiar filtros vuelve a la página 1; un refresco (visibilidad de la pestaña, ↻, subida) conserva la página actual, y cambiar de página lleva el scroll al inicio.

La selección se acumula entre páginas: el checkbox dice «Página (100)» y marca o desmarca solo la ventana actual, mientras la barra de acciones en lote sigue operando sobre todo lo seleccionado. En vivo, un pedido nuevo que llega con el usuario en otra página no desplaza lo que está mirando: se ofrece con «Ver», que lleva a la página 1.

### Búsqueda mientras se escribe

El campo de búsqueda se dispara solo ~400 ms después de la última tecla (sin apretar Buscar), vuelve a la página 1 y descarta las respuestas que lleguen fuera de orden. Lo encontrado se resalta en los títulos de las tarjetas y del listado.

### Queja vencida

Ajustes → «Plazos de refutación» define los días que tiene cada agregador (PedidosYa, Rappi, Rappi Turbo, Mercado Pago) y un valor general para refutar, contados desde el día del pedido; **0 = sin límite** (esas quejas nunca se marcan vencidas). Se guarda compartido en el documento de Métricas, igual que los objetivos, para todos los dispositivos del local.

Al vencer, la queja muestra el tag «Queja vencida» en Reclamos e Historial (con chip de filtro propio) y dejan de ofrecerse «Preparar para refutar» y «Marcar refutado» en esa fila; las que están a 3 días o menos muestran «Vence hoy / mañana / en X d». El vencimiento se calcula al mostrar y no se guarda: cambiar los plazos reevalúa todo el historial sin migrar datos. Las métricas no cambian: el estado persistido sigue siendo Queja y el dinero se cuenta igual.

### Hora del pedido

La hora que se muestra (galería, historial, métricas y cruce con reclamos) es la de la captura del par, no la de la subida. La cola de lectura/subida guarda el momento en que se encoló el par y ese valor se escribe en la foto al insertarla, aunque la cola demore o la app se cierre y continúe en segundo plano. Las fotos ya subidas conservan su hora anterior.

### Evidencia fiel a la cámara

La tira de la cámara muestra el frame congelado que se vio al disparar. Cuando el teléfono lo permite, su foto de alta resolución (`ImageCapture.takePhoto()`) reemplaza a ese frame para subir con más detalle y enfoque automático; desde la 1.7 ese reemplazo **solo ocurre si la foto de alta resolución tiene exactamente el mismo encuadre** que el frame mostrado (correlación normalizada ≥ 0,9 sobre recortes del mismo aspecto, tolerando temblor de hasta 2 px y diferencias de exposición/HDR). Si el teléfono devuelve la foto recortada o con otra proporción, se sube el frame que se vio. Así lo que se agranda en la galería y lo que se descarga es idéntico a lo que el empleado vio en cámara. Las miniaturas de la grilla siguen recortando por diseño de galería.

### Manual de uso

La app incluye una guía corta para el equipo (sacar fotos, galería, marcar quejas, refutado, repetir fotos y corregir autores) en `public/manual/index.html`. Se abre desde **Ajustes → Manual de uso** o directo en `/manual/index.html` (el archivo explícito, así funciona igual en `npm run dev`, en GitHub Pages y desde cualquier dispositivo) y tiene el botón «Guardar/Imprimir» para quedarse con el PDF en el celu. Es una página autocontenida con portada, índice, estilos A4 de impresión (una sección por página) y capturas propias en `public/manual/img/`; no se precachea el service worker y queda fuera del fallback de navegación (junto a `presentacion/`), así que `/manual/…` sirve la guía y no la app.

Validación: `npm test` (278 pruebas), `npm run lint`, `npm run build`.

## Versión 1.6

### Gráfico de tendencia en Métricas

Nuevo gráfico de tendencia diaria en el resumen de Métricas. La vista «Operación» muestra pedidos y quejas por día con la línea del % de quejas, la línea punteada del objetivo y el día pico marcado; la vista «Dinero» apila por día el monto recuperado, en disputa y perdido. Incluye chips de resumen con totales y comparación contra el período anterior de igual duración.

El gráfico se exporta solo desde la tarjeta (PNG a doble resolución o CSV con todos los campos del período). También se incluye en el informe: la pantalla Informe lo muestra como primera sección y la ventana «Exportar informe en PDF» tiene el botón «Gráfico de tendencia» para activarlo o quitarlo antes de imprimir o abrir en pestaña. Los colores son fijos por tema (claro, oscuro e impresión), sin variables CSS, para que el PNG y el PDF se vean idénticos.

### Desempeño de personal

Nuevo apartado «Desempeño» dentro de Métricas. Muestra por persona: fotos tomadas, % del total, pedidos fotografiados, quejas atribuidas, % de quejas sobre sus pedidos, $ reclamados y $ recuperados; el ranking es ordenable por cualquier columna (por defecto: fotos) con barras proporcionales por fila. Debajo, la distribución hora por hora (0–23, solo franjas con datos, más «Sin hora») de pedidos y quejas con el % de cada uno sobre el total y el % de quejas sobre pedidos de la franja.

Las quejas se atribuyen a quien tomó la foto del pedido (por id de foto, con respaldo por nombre de código); las que no tienen foto asignada aparecen como «Sin asignar» y se aclaran al pie. Los pedidos hora por hora salen de las fotos de pedidos del período en horario argentino, ya que el Excel de PedidosYa solo trae totales diarios. Hay descarga en CSV con ambas tablas.

Validación: `npm test` (242 pruebas), `npm run lint`, `npm run build`.

## Versión 1.5

Las cargas manuales preparan una lista compartida en Reclamos → Gestionar. Allí se puede corregir el agregador, fecha y detalles, elegir evidencia, quitar filas o descartar la lista. Solo **Guardar en Historial** confirma el lote; después Gestionar queda vacío. El Sheet automático conserva su importación directa y no reemplaza el borrador manual.

Los datos presentes de los Excel reemplazan los anteriores (incluido monto cero); los campos vacíos conservan el valor existente. Se preservan estados de refutación, evidencia y correcciones de identidad. Las métricas diarias usan las cifras originales del reporte aunque se excluyan filas de la lista.

La cámara permite zoom con dos dedos y elegir lentes disponibles. «Amplio» solo aparece si el dispositivo identifica un lente ultra gran angular. El navegador puede no exponer todos los lentes físicos; no se infiere un 0,5× a partir del orden de las cámaras. Las fotos ampliadas usan el mismo visor táctil en todas las pantallas.

### Activación y compatibilidad

1. Ejecutar `supabase/migrations/20260927090000_reviewed_complaint_imports.sql` antes de publicar el frontend.
2. Publicar el frontend 1.5 y recargar las sesiones anteriores.
3. La primera lectura importa cada JSON de Storage al documento versionado de Postgres, mediante inserción exclusiva. Los originales quedan como respaldo y dejan de aceptar escrituras desde clientes antiguos una vez migrados.

Las confirmaciones escriben Historial, Métricas, marcas de fotos y estado del borrador en una transacción de Postgres. Las revisiones previenen sobrescrituras entre dispositivos; reintentar una confirmación ya completada devuelve su resultado anterior. Las ediciones de métricas preservan cambios en otros campos y rechazan conflictos en el mismo dato. Los documentos conservan sus formatos públicos anteriores; las nuevas tablas no exponen acceso directo a clientes.

Para una reversión, no basta con publicar 1.4: esa versión escribe los JSON antiguos. Deben exportarse primero los documentos actuales de Postgres a Storage y retirar las restricciones de escritura en una ventana controlada. No borrar los documentos ni los respaldos como parte de una reversión de interfaz.

Validación: `npm test`, `npm run lint`, `npm run build`. El workflow de validación prueba también la migración dos veces y los casos de concurrencia, atomicidad, descarte e idempotencia en un PostgreSQL aislado. Los archivos de `tests/database/` son exclusivamente para esa base de prueba. El acceso al gran angular requiere además validación física en Android/iPhone.

This template provides a minimal setup to get React working in Vite with HMR and some ESLint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Oxc](https://oxc.rs)
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/)

## React Compiler

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

## Expanding the ESLint configuration

If you are developing a production application, we recommend using TypeScript with type-aware lint rules enabled. Check out the [TS template](https://github.com/vitejs/vite/tree/main/packages/create-vite/template-react-ts) for information on how to integrate TypeScript and [`typescript-eslint`](https://typescript-eslint.io) in your project.

## Importación Excel PedidosYa

Disponible en Reclamos y Métricas → Cargar. Seleccionar un .xlsx, revisar la vista previa y pulsar Importar. La carga por texto/CSV/Google Sheets y los formularios manuales siguen disponibles.

Solo se importa KFC - LA PLATA (espacios, mayúsculas y guiones normalizados):

- Reclamos - Órdenes: B pedido, C local, D fecha, E hora, F motivo, G comentario, H producto, I nombre opcional, L monto.
- Resumen por tienda: U local, fechas V61:AB61 y cantidades en la fila del local dentro de esa tabla.
- AWT5 / AWT 5: I local, fechas J2:P2 y cantidades en la fila del local dentro de esa tabla.

Las cantidades vacías son cero; hojas, filas o fechas faltantes bloquean la carga. Se leen resultados guardados de fórmulas, sin ejecutar fórmulas ni macros. Los reclamos usan horario argentino. Los pedidos únicos con reclamo determinan la cantidad diaria de quejas.

Las métricas de PedidosYa se reemplazan por día, no se suman. Al confirmar la lista, las reimportaciones actualizan los detalles presentes y conservan correcciones de identidad, estados y evidencias. Los vacíos mantienen el dato existente y no se eliminan registros ausentes del reporte. Duplicados idénticos se omiten; detalles contradictorios de un mismo pedido/fecha bloquean la carga con las filas afectadas.

El XLSX se procesa localmente en un Worker con SheetJS CE 0.20.3 (distribución ESM y licencia incluidas en src/vendor). No se sube el libro completo ni se importan datos de otros locales. Los datos extraídos quedan en el borrador compartido; al confirmar, Historial y Métricas se guardan juntos en Postgres.

Pruebas: npm test. Build: npm run build. El archivo de referencia de septiembre de 2026 produjo 27 reclamos y los 7 pares de pedidos/AWT esperados; ese archivo privado no se incluye en el repositorio.

## Importación Excel Rappi / Rappi Turbo

En Reclamos o Métricas → Cargar, seleccionar el Excel de Rappi. Rappi o Rappi Turbo se detectan por la columna Tienda y pueden revisarse antes de guardar. Ambos usan el mismo formato, pero se guardan como cuentas independientes.

Se lee únicamente Reclamos - Órdenes: encabezados en fila 8, datos desde fila 9. B: pedido; D: tienda; E: fecha; F: motivo; J: detalle del motivo; M: compensación pagada por el restaurante; N: comentario. C, G, H, I, K y L se ignoran. A y O están vacías en el formato de referencia. Se filtra el nombre completo KFC - LA PLATA normalizando espacios, mayúsculas y guiones.

El período se toma de C5 y F5. Se reemplaza solo la cantidad diaria de quejas de la cuenta elegida, incluidos días sin quejas dentro del reporte; pedidos totales, AWT y otras cuentas permanecen intactos. Si no se reconoce el local o el formato, no se escribe nada.

Las fechas se almacenan como día calendario sin crear una hora ni un timestamp ficticio; el historial muestra “sin hora”. Los códigos nuevos llevan el prefijo RAPPI o RAPPITURBO para evitar colisiones. Se reutilizan los registros anteriores de la misma cuenta y fecha, y se conservan refutaciones, evidencias y correcciones. El símbolo $ sin cifras equivale a cero según la definición del reporte; una celda completamente vacía se informa como monto faltante. No se usa la compensación pagada por Rappi de la columna L.

Verificado con el archivo de referencia: 24 reclamos, 11 con monto cero y $208.085,42 de compensación del restaurante, del 01/09/2026 al 23/09/2026. El Excel original no se incluye en el repositorio.

### Reintegros de PedidosYa

Desde Reclamos o Métricas → Carga, «Importar refutados aceptados» admite .xls/.xlsx. Lee únicamente Reintegros: B (pedido), D (DS) y E (KFC - La Plata, nombre completo normalizado). SI/NO y otros locales se ignoran. La vista previa no escribe; confirmar cambia solo el estado de quejas existentes de PedidosYa a refutado_aceptado, preservando fechas, montos, fotos y correcciones. Los pedidos ausentes o con varias coincidencias se informan y no se crean ni modifican. Reimportar no duplica; ante un error puede reintentarse. No modifica métricas ni el lote de cruce con fotos.
