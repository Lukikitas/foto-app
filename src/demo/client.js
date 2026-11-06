// Vite aliases the Supabase module to this file ONLY in --mode demo.
// This client has no transport, credentials, real-time socket or remote fallback.
import { createDemoData } from './data.js';
import { performanceView } from '../lib/performanceViews.js';
import { listHistoryItems, COMPLAINT_STATUSES } from '../lib/complaintHistory.js';
import { photoMatchesFilters } from '../lib/photos.js';
import { resolveDisplayStatus } from '../lib/refutadoDeadline.js';
import { storageSelection } from '../lib/storageAccounting.js';
import { collectHistoryPhotoRefs } from '../lib/photoRetention.js';
import { toArgentinaDate } from '../lib/metrics.js';

export const demoData = createDemoData();
const { metrics, history, photos, today } = demoData;
const READ_ONLY = { message: 'Modo demo: esta acción no guarda ni elimina datos. Podés seguir recorriendo las pantallas.', code: 'DEMO_READ_ONLY' };
const ok = data => ({ data: structuredClone(data), error: null });
const denied = () => ({ data: null, error: { ...READ_ONLY } });
const retention = { enabled: true, retention_days: 30, last_run_at: `${today}T04:43:00Z`, last_removed: 148, updated_at: metrics.updatedAt };
const draftComplaints = Object.values(history.items).filter(item => item.day === today).slice(0, 3);
const draft = { id: 'demo-review', revision: 1, created_at: metrics.updatedAt,
  data: { source: 'manual', complaints: draftComplaints, pickedPhotoIds: Object.fromEntries(draftComplaints.map(item => [item.id, item.photoId])), updatedAt: metrics.updatedAt } };

// A small, explicit thenable supports the query chains used by the real views.
// Unknown operations fail closed instead of claiming a save succeeded.
class DemoQuery {
  constructor(run) { this.run = run; }
  abortSignal(signal) { this.signal = signal; return this; }
  then(resolve, reject) {
    return Promise.resolve().then(() => {
      if (this.signal?.aborted) throw new DOMException('Interrumpido', 'AbortError');
      return this.run();
    }).then(resolve, reject);
  }
}

class DemoTable extends DemoQuery {
  constructor(table) {
    super(() => this.result());
    this.table = table; this.filters = []; this.orders = []; this.start = 0; this.end = Infinity;
  }
  select(columns, options = {}) { this.options = options; return this; }
  eq(key, value) { this.filters.push(row => row[key] === value); return this; }
  in(key, values) { this.filters.push(row => values.includes(row[key])); return this; }
  gte(key, value) { this.filters.push(row => row[key] >= value); return this; }
  lte(key, value) { this.filters.push(row => row[key] <= value); return this; }
  gt(key, value) { this.filters.push(row => String(row[key]) > String(value)); return this; }
  not(key, operator, value) {
    if (operator !== 'is') { this.write = true; return this; }
    this.filters.push(row => row[key] !== value); return this;
  }
  ilike(key, value) { this.filters.push(row => String(row[key] || '').toLowerCase().includes(value.replaceAll('%', '').toLowerCase())); return this; }
  like(key, value) { return this.ilike(key, value); }
  or(expression) {
    const options = expression.split(',').map(part => {
      const [key, operator, ...rest] = part.split('.'); const value = rest.join('.');
      return row => operator === 'eq' ? String(row[key]) === value : String(row[key] || '').toLowerCase().includes(value.replaceAll('%', '').toLowerCase());
    });
    this.filters.push(row => options.some(match => match(row))); return this;
  }
  order(key, { ascending = true } = {}) { this.orders.push({ key, ascending }); return this; }
  limit(count) { this.end = this.start + count; return this; }
  range(from, to) { this.start = from; this.end = to + 1; return this; }
  single() { this.one = true; return this; }
  maybeSingle() { return this.single(); }
  update() { this.write = true; return this; }
  insert() { this.write = true; return this; }
  upsert() { this.write = true; return this; }
  delete() { this.write = true; return this; }
  result() {
    if (this.write) return denied();
    const tables = {
      photos, photo_cleanup_settings: [{ id: true, ...retention }],
      order_recovery_settings: [{ id: true, enabled: true, start_time: '03:00', mode: 'auto_high', updated_at: metrics.updatedAt }],
      order_recovery_runs: [{ day: today, status: 'complete', analyzed: 18, proposed: 0, confirmed: 18, no_code: 0, failed: 0 }],
      order_recovery_items: [], order_recovery_events: [],
    };
    if (!tables[this.table]) return denied();
    const rows = tables[this.table].filter(row => this.filters.every(match => match(row)));
    rows.sort((a, b) => {
      for (const { key, ascending } of this.orders) {
        const compared = String(a[key] ?? '').localeCompare(String(b[key] ?? ''));
        if (compared) return ascending ? compared : -compared;
      }
      return 0;
    });
    const sliced = rows.slice(this.start, this.end);
    return { ...ok(this.options?.head ? null : this.one ? sliced[0] || null : sliced), count: rows.length };
  }
}

function pageRows(rows, args) {
  const size = Math.max(1, args.page_size || 100);
  const page = Math.min(Math.max(1, args.page || 1), Math.max(1, Math.ceil(rows.length / size)));
  return { items: rows.slice((page - 1) * size, page * size), total: rows.length, page };
}

function historyPage(args) {
  const filters = args.filters || {};
  const all = listHistoryItems(history, { ...filters, status: 'all' }).filter(item => !filters.undated || !item.day);
  const statusOf = item => resolveDisplayStatus({ history: item }, metrics.refutadoDays, today);
  const stats = Object.fromEntries(['all', 'con_foto', 'sin_foto', 'ambiguo', 'queja_vencida', ...Object.keys(COMPLAINT_STATUSES)].map(key => [key, 0]));
  stats.all = all.length;
  all.forEach(item => { stats[statusOf(item)]++; stats[item.photoId ? 'con_foto' : 'sin_foto']++; });
  const rows = all.filter(item => !filters.status || filters.status === 'all' || filters.status === statusOf(item) || (filters.status === 'con_foto' && item.photoId) || (filters.status === 'sin_foto' && !item.photoId));
  const sort = filters.sort;
  rows.sort((a, b) => sort === 'amount_desc' ? b.amount - a.amount : sort === 'amount_asc' ? a.amount - b.amount : sort === 'code_asc' ? a.orderCode.localeCompare(b.orderCode) : sort === 'date_asc' ? a.orderAtIso.localeCompare(b.orderAtIso) : b.orderAtIso.localeCompare(a.orderAtIso));
  return { ...pageRows(rows, args), stats, historyCount: Object.keys(history.items).length, amount: rows.reduce((sum, item) => sum + item.amount, 0), revision: 1 };
}

function storageSummary() {
  const refs = collectHistoryPhotoRefs(Object.values(history.items));
  const selection = storageSelection(photos, refs, retention.retention_days);
  const bytesPerFile = 42000;
  const row = count => ({ count, bytes: count * bytesPerFile, unknownSizeCount: 0 });
  return {
    total: row(photos.length), categories: { orders: row(photos.length - 3), files: row(3), tickets: row(0), other: row(0) },
    selections: { eligible: row(selection.eligiblePaths.length), protected: row(selection.protectedPaths.length) },
    retention, recordsWithoutImage: selection.recordsWithoutImage, retainedRecords: selection.retainedRecords, snapshotAt: metrics.updatedAt,
  };
}

function rpc(name, args = {}) {
  return new DemoQuery(() => {
    if (name === 'foto_metrics_header') return ok({ data: { ...metrics, days: {} }, availableLastDay: today, revision: 1 });
    if (['foto_document_read', 'foto_document_read_if_changed'].includes(name)) {
      const data = args.document_key === 'metrics' ? metrics : args.document_key === 'history' ? history : null;
      return data ? ok({ key: args.document_key, revision: 1, data }) : denied();
    }
    if (name === 'foto_gallery_page') {
      const rows = photos.filter(photo => photoMatchesFilters(photo, args.filters || {})).sort((a, b) => b.created_at.localeCompare(a.created_at));
      return ok({ ...pageRows(rows, args), asOf: args.as_of || new Date().toISOString() });
    }
    if (name === 'foto_history_page') return ok(historyPage(args));
    if (name === 'foto_draft_read_if_changed' || (name === 'foto_draft_action' && args.action === 'read')) return ok(draft);
    if (name === 'foto_storage_summary') return ok(storageSummary());
    if (name === 'current_order_ocr_usage') return ok(124);
    if (name === 'list_unidentified_photos_page') return ok([]);
    return denied();
  });
}

export const supabase = {
  from: table => new DemoTable(table), rpc,
  functions: { invoke: async (name, { body, signal } = {}) => {
    if (signal?.aborted) throw new DOMException('Interrumpido', 'AbortError');
    if (name !== 'performance-data') return denied();
    const from = body?.from || ''; const to = body?.to || today;
    const selectedPhotos = photos.filter(photo => photo.file_path.startsWith('orders/') && toArgentinaDate(photo.created_at) >= from && toArgentinaDate(photo.created_at) <= to && (!body.aggregator || body.aggregator === 'all' || photo.aggregator === body.aggregator));
    return ok(performanceView({ ...body, metrics, history, photos: selectedPhotos, today }));
  } },
  storage: { from: () => ({
    download: async path => path === 'complaints/sync.json' ? { data: new Blob([JSON.stringify({ enabled: false, sheetUrl: '' })]), error: null } : { data: null, error: { message: 'Not found', statusCode: 404 } },
    upload: async () => denied(), remove: async () => denied(),
    getPublicUrl: () => ({ data: { publicUrl: '/demo/evidencia.svg' } }),
    createSignedUrl: async () => ok({ signedUrl: '/demo/evidencia.svg' }),
  }) },
  channel: () => {
    const channel = { on: () => channel, subscribe: callback => { callback?.('SUBSCRIBED'); return channel; }, unsubscribe() {} };
    return channel;
  },
  removeChannel() {}, realtime: { disconnect() {} },
  auth: { getSession: async () => ok({ session: null }), stopAutoRefresh() {} },
};
export function supabaseForSignal() { return supabase; }
