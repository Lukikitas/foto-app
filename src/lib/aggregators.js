export const AGGREGATORS = {
  pedidosya: { label: 'PedidosYa', prefixes: ['PEYA'] },
  rappi: { label: 'Rappi', prefixes: ['RAPPI'] },
  rappi_turbo: { label: 'Rappi Turbo', prefixes: ['RAPPITURBO', 'RAPPI TURBO'] },
  mercadopago: { label: 'Mercado Pago', prefixes: ['MPD', 'MP'] },
};

export const AGGREGATOR_OPTIONS = Object.entries(AGGREGATORS).map(([id, item]) => ({
  id,
  label: item.label,
}));

function compact(value = '') {
  return value.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

export function detectAggregator(value) {
  const normalized = compact(value);

  if (normalized.startsWith('RAPPITURBO')) return 'rappi_turbo';
  if (normalized.startsWith('PEYA')) return 'pedidosya';
  if (normalized.startsWith('RAPPI')) return 'rappi';
  if (normalized.startsWith('MPD') || normalized.startsWith('MP')) return 'mercadopago';
  return null;
}

export function getAggregatorLabel(aggregator) {
  return AGGREGATORS[aggregator]?.label || 'Sin agregador';
}

export function aggregatorBadgeClass(aggregator) {
  if (!aggregator || !AGGREGATORS[aggregator]) return 'badge badge--aggregator';
  return `badge badge--aggregator badge--aggregator-${aggregator}`;
}

export function getPhotoAggregator(photo) {
  const parts = photo?.file_path?.split('/') || [];
  const aggregator = parts[0] === 'orders' && parts.length > 2 ? parts[1] : null;
  return AGGREGATORS[aggregator] ? aggregator : null;
}

export const PARTNER_PORTALS = {
  pedidosya: {
    label: 'PedidosYa Portal',
    url: 'https://portal-app.pedidosya.com/orders',
  },
  rappi: {
    label: 'Rappi Partners',
    url: 'https://partners.rappi.com',
  },
  rappi_turbo: {
    label: 'Rappi Partners',
    url: 'https://partners.rappi.com',
  },
};

export function getPartnerPortal(aggregator) {
  return PARTNER_PORTALS[aggregator] || null;
}

export function getComplaintAggregator(complaint, photo) {
  return detectAggregator(complaint?.orderCode) || getPhotoAggregator(photo);
}

export function openPartnerPortal(aggregator) {
  const portal = getPartnerPortal(aggregator);
  if (!portal) return null;
  window.open(portal.url, '_blank', 'noopener,noreferrer');
  return portal;
}
