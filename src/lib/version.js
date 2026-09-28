import packageInfo from '../../package.json';
export const APP_VERSION = packageInfo.version.replace(/\.0$/, '');
export const RELEASE_GROUPS = [
  { title: 'Subidas y recuperación', notes: [
    'La cámara Android conserva sesiones y fotos pendientes durante siete días para tolerar cortes de conexión y capturas prolongadas.',
    'Si una foto Android quedó marcada como importada pero desapareció de la cola local, la app vuelve a recuperarla del depósito temporal.',
    'La cola verifica la foto en el servidor antes de mostrarla como guardada y permite reintentar la lectura local.',
    'El guardado local espera la confirmación real de IndexedDB antes de informar un error de tiempo de espera.',
  ] },
  { title: 'Cámara y Captura', notes: [
    'Acceso directo siempre disponible para abrir la cámara Android nativa, la cámara web clásica o los ajustes del APK.',
    'Detalle paso a paso del traspaso de pares Android con reintentos manuales/automáticos e importación idempotente.',
    'Ventana de recuperación segura de 7 días y preservación de la copia local en el teléfono hasta la confirmación definitiva.',
    'Diagnóstico técnico de cámaras lógicas y físicas con reporte detallado de compatibilidad en Xiaomi y otros dispositivos.',
  ] },
  { title: 'Reclamos y Gestionar', notes: [
    'Rediseño completo de Gestionar con scroll fluido en PC y celular, visualización clara de pedidos, montos y fotos coincidentes.',
    'Barra de acciones masivas optimizada para editar fecha o agregador y barra de guardado flotante con área protegida de navegación.',
    'Listas compartidas para revisar, corregir o descartar antes de guardar en Historial sin tocar datos existentes.',
    'Los Excel actualizan los montos y detalles presentes, conservando estados, fotos y datos que vengan vacíos.',
  ] },
  { title: 'Rendimiento y Persistencia', notes: [
    'Cola web resiliente con guardado local previo a la subida, protección contra trabas de OCR y confirmación al descartar errores.',
    'Prevención de bloqueos en IndexedDB con liberación automática de conexiones entre pestañas y worker de fondo.',
    'Galería paginada de 50 pedidos con conteo real de fotos en servidor y filtros aplicados a la consulta completa.',
    'Todas las fotos ampliadas admiten pellizco, desplazamiento y doble toque.',
  ] },
];
export const RELEASE_NOTES = RELEASE_GROUPS.flatMap(group => group.notes);
