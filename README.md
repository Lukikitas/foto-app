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
