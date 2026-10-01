import packageInfo from '../../package.json';
export const APP_VERSION = packageInfo.version.replace(/\.0$/, '');
export const RELEASE_GROUPS = [
  {
    title: 'Galería paginada',
    notes: [
      'La galería de pedidos se ve de 100 en 100: páginas numeradas con «Anterior/Siguiente», el rango visible («Mostrando 1–100 de 857») y la primera página carga al instante mientras el resto llega en segundo plano.',
      'La búsqueda se actualiza sola mientras escribís (sin apretar Buscar) y resalta lo encontrado en los títulos.',
      'La selección se acumula entre páginas: el checkbox «Página» marca solo la página actual y la barra de acciones sigue viendo todo lo seleccionado.',
    ],
  },
  {
    title: 'Queja vencida',
    notes: [
      'Ajustes → «Plazos de refutación»: días por agregador (y uno general) para refutar, contados desde el día del pedido. Usá 0 = sin límite. Se guarda compartido para todos los dispositivos del local.',
      'Cuando pasan los días desde el pedido, la queja aparece con el tag «Queja vencida» en Reclamos e Historial y ya no se ofrecen «Preparar para refutar» ni «Marcar refutado».',
      'Las quejas por vencer muestran «Vence hoy / mañana / en X d» en sus últimas fechas. Las métricas no cambian: el estado guardado sigue siendo Queja.',
    ],
  },
  {
    title: 'Hora del pedido',
    notes: [
      'La galería muestra la hora en que se sacó el par de fotos, aunque la cola de lectura/subida tarde: el pedido guarda su hora de captura y no la en que terminó de subir. Vale también si la app se cerró y la cola siguió en segundo plano.',
    ],
  },
  {
    title: 'Evidencia fiel a la cámara',
    notes: [
      'La foto que se agranda en la galería y la que se descarga son exactamente las que vio el empleado al sacarla: si la foto de alta resolución del teléfono viene con otro encuadre (zoom de fábrica), se conserva el frame que se mostró en cámara. Cuando el encuadre coincide, sube la versión de alta resolución con más detalle.',
    ],
  },
];
export const RELEASE_NOTES = RELEASE_GROUPS.flatMap(group => group.notes);
