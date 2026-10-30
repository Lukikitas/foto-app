import { readFile, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
const env = Object.fromEntries((await readFile('.env', 'utf8')).split(/\r?\n/).map(line => line.match(/^(VITE_SUPABASE_URL|VITE_SUPABASE_ANON_KEY)\s*=\s*['"]?(.*?)['"]?\s*$/)).filter(Boolean).map(([, key, value]) => [key, value]));
const base = env.VITE_SUPABASE_URL;
const headers = { apikey: env.VITE_SUPABASE_ANON_KEY, Authorization: `Bearer ${env.VITE_SUPABASE_ANON_KEY}` };
const checks = [];
async function check(label, route, options, statuses) {
  const response = await fetch(base + route, { ...options, headers: { ...headers, ...options?.headers }, signal: AbortSignal.timeout(30_000) });
  await response.text();
  checks.push({ label, status: response.status, passed: statuses.includes(response.status) });
  if (!statuses.includes(response.status)) throw new Error(`${label}: HTTP ${response.status}`);
}
const json = body => ({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
await check('schema-readable', '/rest/v1/photos?select=capture_id&limit=1', {}, [200]);
await check('invalid-capture-rejected', '/functions/v1/capture-sync', json({}), [400]);
await check('missing-evidence-rejected', '/functions/v1/capture-sync', json({ captureId: randomUUID(), takenBy: 'Validación sin escritura', capturedAt: new Date().toISOString() }), [503]);
await check('direct-registration-protected', '/rest/v1/rpc/register_photo_capture', json({ p_capture_id: randomUUID(), p_file_path: '', p_public_url: '', p_name: '', p_taken_by: '', p_aggregator: null, p_captured_at: new Date().toISOString() }), [401, 403]);
const form = new FormData(); form.set('photoId', randomUUID());
await check('ticket-validation-active', '/functions/v1/order-code-recovery', { method: 'POST', body: form }, [400]);
await writeFile('output/capture-backend-20261029.local/verification.json', JSON.stringify({ at: new Date().toISOString(), checks }, null, 2));
console.log(JSON.stringify(checks));
