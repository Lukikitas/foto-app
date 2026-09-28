import packageInfo from '../../package.json';
export const APP_VERSION = packageInfo.version.replace(/\.0$/, '');
export const RELEASE_GROUPS = [
  {
    title: 'Corrección de errores',
    notes: [
      'Corrección definitiva del bloqueo de scroll: la lista de reclamos en "Gestionar" ahora cuenta con scroll interno independiente y fluido en cualquier resolución.',
      'Se eliminó la superposición del botón "Guardar en Historial" que tapaba los renglones finales de la lista.',
      'Se reemplazó el recuadro rojo de fotos faltantes por una pastilla neutra y sutil "Sin foto".',
    ],
  },
  {
    title: 'Rediseño y mejoras en "Gestionar"',
    notes: [
      'Nueva tabla de alta densidad: columnas optimizadas para código, agregador con pastilla de color, fecha, detalle completo del motivo, monto y evidencia.',
      'Buscador instantáneo en tiempo real por número de pedido, motivo o producto.',
      'Filtros rápidos de un clic para ver todos, PedidosYa, Rappi, con foto o sin foto.',
      'Cálculo en tiempo real del monto total acumulado en la cabecera y botón directo para guardar sin desplazarse.',
      'Barra de edición masiva con cálculo del importe seleccionado al cambiar agregador, fecha o quitar en lote.',
    ],
  },
];
export const RELEASE_NOTES = RELEASE_GROUPS.flatMap(group => group.notes);
