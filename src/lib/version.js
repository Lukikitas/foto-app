import packageInfo from '../../package.json';
export const APP_VERSION = packageInfo.version.replace(/\.0$/, '');
export const RELEASE_GROUPS = [
  {
    title: 'Métricas: tendencia',
    notes: [
      'Nuevo gráfico de tendencia diaria en el resumen de Métricas: pedidos y quejas por día, con la línea del % de quejas y la del objetivo, marcando el día pico.',
      'Vista alternativa «Dinero» con las quejas de cada día apiladas en recuperado, en disputa y pérdida.',
      'El gráfico se puede exportar solo como imagen PNG o CSV, y se incluye en el informe PDF con un botón para activarlo o quitarlo.',
      'Resumen con totales del período y comparación contra el período anterior de igual duración.',
    ],
  },
  {
    title: 'Desempeño de personal',
    notes: [
      'Nuevo apartado «Desempeño» en Métricas: ranking por persona con fotos, % del total, pedidos, quejas, % de quejas y montos reclamados/recuperados.',
      'Distribución hora por hora de pedidos y quejas con sus respectivos porcentajes y el % de quejas sobre pedidos de cada franja.',
      'Las quejas se atribuyen a quien tomó la foto del pedido; las que quedan sin foto aparecen como «Sin asignar».',
      'Descarga en CSV del ranking y de la distribución horaria del período.',
    ],
  },
  {
    title: 'Correcciones',
    notes: [
      'Se limpiaron las advertencias de validación en la revisión de listas compartidas.',
    ],
  },
];
export const RELEASE_NOTES = RELEASE_GROUPS.flatMap(group => group.notes);
