import packageInfo from '../../package.json';
export const APP_VERSION = packageInfo.version.replace(/\.0$/, '');
// Novedades que muestra Ajustes → «Ver novedades». Al subir de versión menor
// se podan los grupos anteriores (convención desde v1.7): el título del modal
// es «Novedades de la versión {APP_VERSION}», así que solo debe listar las de
// esta versión.
export const RELEASE_GROUPS = [
  {
    title: 'Refutación rechazada con motivo',
    notes: [
      'Marcar «Ref. rechazado» ahora pide el motivo: modal con presets (Calidad de la comida, Ticket ilegible, Foto incompleta, Queja real) más comentario opcional. Vale para una queja, para la selección masiva y desde «Editar datos…» en lote; el motivo se guarda en el historial y se limpia si el estado cambia.',
      'El motivo del rechazo se muestra en la fila de Reclamos e Historial, en Métricas → Quejas, en el anexo del PDF y en las exportaciones CSV/Excel (columna motivo_rechazo, junto a motivo_no_refutable).',
      'Métricas suma dos bloques nuevos: «Top motivos de refutación rechazada» y «Top motivos de no refutables», con cantidad, % del estado, $ perdido, barra proporcional y comentarios expandibles; el dashboard muestra un mini top 3 de cada uno.',
      'Exportar informe en PDF ahora es un armador: secciones por plantilla (Gerencial, Operativo, Disciplinario/control, Completo o Personalizado), título y nota propios, anexo filtrado por estado y columnas, vista previa en vivo y la última configuración guardada.',
    ],
  },
];
export const RELEASE_NOTES = RELEASE_GROUPS.flatMap(group => group.notes);
