import packageInfo from '../../package.json';
export const APP_VERSION = packageInfo.version.replace(/\.0$/, '');
// Novedades que muestra Ajustes → «Ver novedades». Al subir de versión menor
// se podan los grupos anteriores (convención desde v1.7): el título del modal
// es «Novedades de la versión {APP_VERSION}», así que solo debe listar las de
// esta versión.
export const RELEASE_GROUPS = [
  {
    title: 'No se puede refutar',
    notes: [
      'En Reclamos e Historial, las quejas abiertas tienen el botón «No se puede refutar»: pide el motivo (presets: No hay foto, Queja real, Foto borrosa/invalida, Código no visible + detalle opcional) y la queja queda como «No refutable».',
      'Una vez marcada como «No refutable» desaparecen «Preparar para refutar» y «Marcar refutado» (igual que con Ref. rechazado o Queja vencida), la foto no se marca refutada y el dinero se cuenta como pérdida. Hay chip de filtro y opción en el menú «Estado» de la barra masiva.',
      'Desempeño de personal: columnas nuevas «Ref. acept.» (quejas falsas, no juegan en contra) y «No refut.» (pérdidas sin refutar, base para medidas disciplinarias), también en el CSV; el resumen de Métricas muestra «N no refutables» y el registro CSV/Excel incluye el motivo.',
    ],
  },
];
export const RELEASE_NOTES = RELEASE_GROUPS.flatMap(group => group.notes);
