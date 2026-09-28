import packageInfo from '../../package.json';
export const APP_VERSION = packageInfo.version.replace(/\.0$/, '');
export const RELEASE_GROUPS = [
  { title: 'Gestionar', notes: [
    'Rediseño completo: filas compactas con scroll propio, miniatura de foto con zoom y acciones rápidas por reclamo.',
    'Header fijo con barra de edición masiva integrada y botón "Guardar" siempre visible al pie.',
  ] },
  { title: 'Cámara', notes: [
    'Zoom continuo con dos dedos y selección opcional del lente amplio en celulares compatibles.',
    'Guías ajustadas al encuadre real y preferencia de cámara para la foto del pedido.',
  ] },
  { title: 'Reclamos', notes: [
    'Listas compartidas para revisar, corregir o descartar antes de guardar en Historial.',
    'Los Excel actualizan los montos y detalles presentes, conservando estados, fotos y datos que vengan vacíos.',
    'Guardado con control de versiones para proteger los cambios entre dispositivos.',
  ] },
  { title: 'Experiencia', notes: [
    'Todas las fotos ampliadas admiten pellizco, desplazamiento y doble toque.',
    'Ajustes renovados, con una presentación más clara de la versión y sus novedades.',
  ] },
];
export const RELEASE_NOTES = RELEASE_GROUPS.flatMap(group => group.notes);
