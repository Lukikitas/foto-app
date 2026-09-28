import packageInfo from '../../package.json';
export const APP_VERSION = packageInfo.version.replace(/\.0$/, '');
export const RELEASE_GROUPS = [
  { title: 'Cámara e Importación', notes: [
    'Detalle paso a paso del traspaso de pares Android con reintentos manuales/automáticos e importación idempotente.',
    'Ventana de recuperación segura de 7 días y preservación de la copia local en el teléfono hasta la confirmación definitiva.',
    'Diagnóstico técnico de cámaras lógicas y físicas con reporte detallado de compatibilidad en Xiaomi y otros dispositivos.',
  ] },
  { title: 'Cola de Subida y Galería', notes: [
    'Cola web resiliente con guardado local previo a la subida, protección contra trabas de OCR y confirmación al descartar errores.',
    'Galería paginada de 50 pedidos con conteo real de fotos en servidor y filtros aplicados a la consulta completa.',
  ] },
  { title: 'Reclamos y Experiencia', notes: [
    'Listas compartidas para revisar, corregir o descartar antes de guardar en Historial.',
    'Los Excel actualizan los montos y detalles presentes, conservando estados, fotos y datos que vengan vacíos.',
    'Todas las fotos ampliadas admiten pellizco, desplazamiento y doble toque.',
    'Ajustes renovados, con una presentación más clara de la versión y sus novedades.',
  ] },
];
export const RELEASE_NOTES = RELEASE_GROUPS.flatMap(group => group.notes);
