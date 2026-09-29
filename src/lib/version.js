import packageInfo from '../../package.json';
export const APP_VERSION = packageInfo.version.replace(/\.0$/, '');
export const RELEASE_GROUPS = [
  {
    title: 'Correcciones',
    notes: [
      'Métricas → Desempeño: las fotos del período ya no se cortan en 1000; ahora se leen por páginas, así pedidos, quejas y atribución por persona salen completos en rangos largos.',
      'Historial de reclamos: al guardar un lote grande la pantalla ya no se queda en negra; la lista se muestra por tandas con «Mostrar más», las miniaturas se cargan bajo demanda y se agregó una pantalla de recuperación ante errores.',
      'Se evitó que las comparaciones de la revisión de reclamos y los sondeos cada 5 segundos recargaran todo el historial sin cambios.',
    ],
  },
];
export const RELEASE_NOTES = RELEASE_GROUPS.flatMap(group => group.notes);
