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
  if (photo && Object.hasOwn(photo, 'aggregator')) {
    return AGGREGATORS[photo.aggregator] ? photo.aggregator : null;
  }
  const parts = photo?.file_path?.split('/') || [];
  const aggregator = parts[0] === 'orders' && parts.length > 2 ? parts[1] : null;
  if (AGGREGATORS[aggregator]) return aggregator;
  if (parts[0] === 'orders' && aggregator === 'no_code') {
    return detectAggregator(photo?.name);
  }
  return null;
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
  if (complaint && Object.hasOwn(complaint, 'aggregator')) {
    return AGGREGATORS[complaint.aggregator] ? complaint.aggregator : null;
  }
  return detectAggregator(complaint?.orderCode) || getPhotoAggregator(photo) || null;
}

export function assignComplaintsAggregator(complaints, aggregator) {
  const list = Array.isArray(complaints) ? complaints : [];
  if (!aggregator || !AGGREGATORS[aggregator]) return list;
  return list.map((complaint) => ({ ...complaint, aggregator }));
}

const portalWindows = new Map();

export function partnerPortalWindowName(aggregator) {
  if (aggregator === 'rappi_turbo') return 'foto-app-portal-rappi';
  return `foto-app-portal-${aggregator}`;
}

export function resetPartnerPortalWindows() {
  portalWindows.clear();
}

function rememberPortalWindow(name, handle) {
  if (handle) portalWindows.set(name, handle);
  return handle;
}

export function openPartnerPortal(aggregator) {
  const portal = getPartnerPortal(aggregator);
  if (!portal) return null;
  const name = partnerPortalWindowName(aggregator);
  const current = portalWindows.get(name);
  if (current && !current.closed) {
    try {
      current.focus();
    } catch {
      // el navegador puede bloquear focus; el portal ya está abierto
    }
    return { ...portal, opened: false };
  }
  if (typeof window === 'undefined' || typeof window.open !== 'function') {
    return { ...portal, opened: false };
  }
  const opened = window.open(portal.url, name);
  rememberPortalWindow(name, opened);
  return { ...portal, opened: Boolean(opened) };
}
