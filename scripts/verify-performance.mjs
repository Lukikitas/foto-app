// Read-only production checks. Never log response rows or credentials.
import assert from 'node:assert/strict';
const url = process.env.VITE_SUPABASE_URL;
const key = process.env.VITE_SUPABASE_ANON_KEY;
if (!url || !key) throw new Error('Supabase configuration is required.');
const headers = { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };
async function post(route, body) {
  const started = performance.now();
  const response = await fetch(`${url}${route}`, {
    method: 'POST', headers, body: JSON.stringify(body), signal: AbortSignal.timeout(45000),
  });
  if (!response.ok) throw new Error(`${route}: HTTP ${response.status}`);
  const data = await response.json();
  if (data?.error) throw new Error(`${route}: server returned an error`);
  console.log(`OK ${route.split('/').at(-1)} ${Math.round(performance.now() - started)} ms`);
  return data;
}
const rpc = (name, args = {}) => post(`/rest/v1/rpc/${name}`, args);
const header = await rpc('foto_metrics_header');
assert.ok(header?.data && Number.isFinite(header.revision));
assert.equal('days' in header.data, false);
const gallery = await rpc('foto_gallery_page', { filters: {}, page: 1, page_size: 30 });
assert.equal(gallery.items.length, Math.min(gallery.total, 30));
assert.ok(gallery.asOf);
if (gallery.total > 30) {
  const next = await rpc('foto_gallery_page', { filters: {}, page: 2, page_size: 30, as_of: gallery.asOf });
  assert.equal(next.page, 2);
  assert.equal(next.total, gallery.total);
  assert.equal(new Set([...gallery.items, ...next.items].map(row => row.id)).size, gallery.items.length + next.items.length);
}
const desktop = await rpc('foto_gallery_page', { filters: {}, page: 1, page_size: 100, as_of: gallery.asOf });
assert.equal(desktop.items.length, Math.min(gallery.total, 100));
const history = await rpc('foto_history_page', { filters: {}, page: 1, page_size: 30 });
assert.equal(history.items.length, Math.min(history.total, 30));
const unchanged = await rpc('foto_document_read_if_changed', { document_key: 'metrics', known_revision: header.revision });
assert.equal(unchanged.unchanged, true);
const storage = await rpc('foto_storage_summary');
assert.ok(storage && typeof storage === 'object');
const to = header.availableLastDay || new Date().toLocaleDateString('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' });
const from = to.slice(0, 8) + '01';
for (const view of ['overview', 'staff', 'report', 'complaints', 'pending']) {
  const data = await post('/functions/v1/performance-data', { view, from, to, aggregator: 'all' });
  assert.ok(data.metrics);
  if (view === 'pending') assert.ok(data.report);
  else assert.ok(data.history);
  if (view === 'overview') assert.equal(Object.keys(data.history.items).length, 0);
  if (view === 'report') assert.ok(Array.isArray(data.report.items));
  console.log(`OK view=${view}`);
}
console.log(`Verified current reads: ${gallery.total} photos, ${history.total} history rows; no writes.`);
