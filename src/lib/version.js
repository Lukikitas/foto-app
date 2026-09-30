import packageInfo from '../../package.json';
export const APP_VERSION = packageInfo.version.replace(/\.0$/, '');
export const RELEASE_GROUPS = [
  {
    title: 'Novedades',
    notes: [
      'Cámara de pedidos: cada paso tiene su identidad visual (chip 🎫 Ticket / 🛍 Bolsa, color propio y texto guía propio) y la palabra «Pedido» dejó de usarse como nombre de la segunda foto.',
      'Tira del último par: se ven las miniaturas de ticket y bolsa; tocá una para verla en grande con zoom y repetirla desde ahí, con «✓ Guardado» cuando se encola y un botón «Repetir» mientras el par está pendiente, sin frenar el flujo hacia el siguiente par.',
      'Menos fotos movidas: se capturan tres frames y se conserva el más nítido, el enfoque automático del hardware tiene más tiempo y las fotos oscuras ofrecen prender el flash.',
    ],
  },
];
export const RELEASE_NOTES = RELEASE_GROUPS.flatMap(group => group.notes);
