import { AGGREGATORS, getPhotoAggregator } from './aggregators.js';
import { complaintHistoryId, PENDING_COMPLAINT_DETAILS } from './complaintHistory.js';
import { compactCode } from './complaintMatch.js';
import { toArgentinaDate } from './metrics.js';

const HEADER = /^(?:c[oó]digo|pedido|orden|order(?:\s*id)?)$/i;
const ORDER_CODE = /^(?:\d{4,12}|\d{1,4}-\d{4,}|(?:PEYA|RAPPI(?:TURBO)?|MPD?)[A-Z0-9-]{1,28})$/;

export function parseComplaintCodeList(value) {
  const valid = [];
  const invalid = [];
  const duplicates = [];
  const seen = new Set();
  String(value || '').split(/[\r\n\t,;]+/).forEach((raw) => {
    const code = raw.trim().toUpperCase();
    if (!code || HEADER.test(code)) return;
    if (!ORDER_CODE.test(code)) {
      invalid.push(code);
      return;
    }
    const key = compactCode(code);
    if (seen.has(key)) {
      duplicates.push(code);
      return;
    }
    seen.add(key);
    valid.push(code);
  });
  return { valid, invalid, duplicates };
}

export function codeListItem(code, match = {}) {
  const photo = match.photo || null;
  return {
    key: compactCode(code),
    code,
    status: match.status || 'unmatched',
    photo,
    candidates: match.candidates || [],
    day: photo?.created_at ? toArgentinaDate(photo.created_at) : '',
    aggregator: getPhotoAggregator(photo) || '',
    selected: !photo,
  };
}

export function applyCodeListDefaults(items, selectedKeys, { day, aggregator }) {
  const selected = new Set(selectedKeys || []);
  return items.map((item) => selected.has(item.key)
    ? {
        ...item,
        day: day || item.day,
        aggregator: aggregator || item.aggregator,
      }
    : item);
}

export function complaintFromCodeItem(item) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(item.day || '')) {
    throw new Error(`Elegí la fecha de ${item.code}.`);
  }
  if (!AGGREGATORS[item.aggregator]) {
    throw new Error(`Elegí el agregador de ${item.code}.`);
  }
  const complaint = {
    orderCode: item.code,
    aggregator: item.aggregator,
    day: item.day,
    orderAtIso: null,
    timeOfDay: null,
    dateAssumed: false,
    reason: PENDING_COMPLAINT_DETAILS,
    comment: '',
    combo: '',
    amount: null,
    fields: {},
  };
  complaint.id = complaintHistoryId(complaint);
  return complaint;
}
