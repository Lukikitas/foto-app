# React + Vite

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

Las métricas de PedidosYa se reemplazan por día, no se suman. Las reimportaciones conservan detalles existentes, correcciones manuales, estados y evidencias; completan campos faltantes y no eliminan registros ausentes del reporte. Duplicados idénticos se omiten; detalles contradictorios de un mismo pedido/fecha bloquean la carga con las filas afectadas.

El XLSX se procesa localmente en un Worker con SheetJS CE 0.20.3 (distribución ESM y licencia incluidas en src/vendor). No se sube el libro completo ni se importan datos de otros locales. El historial y las métricas se guardan en los objetos de Storage existentes; si falla la segunda escritura, se informa el guardado parcial y se puede reintentar sin duplicados.

Pruebas: npm test. Build: npm run build. El archivo de referencia de septiembre de 2026 produjo 27 reclamos y los 7 pares de pedidos/AWT esperados; ese archivo privado no se incluye en el repositorio.

## Importación Excel Rappi / Rappi Turbo

En Reclamos o Métricas → Cargar, elegir obligatoriamente Rappi o Rappi Turbo antes del archivo. Ambos usan el mismo formato, pero se guardan como cuentas independientes.

Se lee únicamente Reclamos - Órdenes: encabezados en fila 8, datos desde fila 9. B: pedido; D: tienda; E: fecha; F: motivo; J: detalle del motivo; M: compensación pagada por el restaurante; N: comentario. C, G, H, I, K y L se ignoran. A y O están vacías en el formato de referencia. Se filtra el nombre completo KFC - LA PLATA normalizando espacios, mayúsculas y guiones.

El período se toma de C5 y F5. Se reemplaza solo la cantidad diaria de quejas de la cuenta elegida, incluidos días sin quejas dentro del reporte; pedidos totales, AWT y otras cuentas permanecen intactos. Si no se reconoce el local o el formato, no se escribe nada.

Las fechas se almacenan como día calendario sin crear una hora ni un timestamp ficticio; el historial muestra “sin hora”. Los códigos nuevos llevan el prefijo RAPPI o RAPPITURBO para evitar colisiones. Se reutilizan los registros anteriores de la misma cuenta y fecha, y se conservan refutaciones, evidencias y correcciones. El símbolo $ sin cifras equivale a cero según la definición del reporte; una celda completamente vacía se informa como monto faltante. No se usa la compensación pagada por Rappi de la columna L.

Verificado con el archivo de referencia: 24 reclamos, 11 con monto cero y $208.085,42 de compensación del restaurante, del 01/09/2026 al 23/09/2026. El Excel original no se incluye en el repositorio.
