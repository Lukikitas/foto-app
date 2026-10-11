import { getPhotoAggregator } from './aggregators.js';
import { compactCode } from './complaintMatch.js';
import { toArgentinaDate } from './metrics.js';

export function orderIdentity(photo) {
  const compact = compactCode(photo?.name).replace(/^(RAPPITURBO|RAPPI|PEYA|MPD)/, '');
  const aggregator = getPhotoAggregator(photo);
  const date = new Date(photo?.created_at);
  if (!aggregator || !/^[A-Z0-9]{4,28}$/.test(compact) || compact === 'CODIGONOENCONTRADO' || !Number.isFinite(date.getTime())) return `unidentified:${photo.id}`;
  return `${toArgentinaDate(photo.created_at)}|${aggregator}|${compact}`;
}

export function representativeOrders(photos) {
  const groups = new Map();
  for (const photo of new Map(photos.map(photo => [photo.id, photo])).values()) {
    if (String(photo.file_path || '').startsWith('files/')) continue;
    const key = orderIdentity(photo);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(photo);
  }
  const representativeById = new Map(); const representatives = [];
  for (const group of groups.values()) {
    group.sort((a, b) => (Date.parse(a.created_at) || 0) - (Date.parse(b.created_at) || 0) || String(a.id).localeCompare(String(b.id)));
    const representative = group[1] || group[0];
    representatives.push(representative);
    group.forEach(photo => representativeById.set(photo.id, representative));
  }
  return { representatives, representativeById };
}
