// Diagnóstico de solo lectura: qué pedidos recientes tienen ticket en Supabase.
// Desde v1.7.7.3 el ticket se conserva para TODOS los pedidos durante 72 h,
// con o sin código, así que el script revisa la ventana completa.
//   node scripts/diagnose-tickets.mjs          revisa toda la ventana (lento)
//   node scripts/diagnose-tickets.mjs --max=20 revisa los 20 pedidos más nuevos
import { readFile } from 'node:fs/promises';

const env = Object.fromEntries(
  (await readFile(new URL('../.env', import.meta.url), 'utf8'))
    .split(/\r?\n/)
    .filter((line) => line.includes('='))
    .map((line) => [line.slice(0, line.indexOf('=')), line.slice(line.indexOf('=') + 1)]),
);
const URL_BASE = env.VITE_SUPABASE_URL;
const KEY = env.VITE_SUPABASE_ANON_KEY;
const NO_CODE = 'Código no encontrado';
const maxArg = process.argv.find((arg) => arg.startsWith('--max='));
const MAX = maxArg ? Number(maxArg.slice(6)) : Infinity;

const headers = { Authorization: `Bearer ${KEY}`, apikey: KEY };

// Supabase devuelve como máximo 1000 filas por consulta: se pagina por offset.
const desde = new Date(Date.now() - 72 * 3600 * 1000).toISOString();
const photos = [];
for (let offset = 0; ; offset += 1000) {
  const page = await fetch(
    `${URL_BASE}/rest/v1/photos?select=id,name,created_at,taken_by,file_path` +
      `&created_at=gte.${desde}&order=created_at.desc&limit=1000&offset=${offset}`,
    { headers },
  ).then((r) => r.json());
  photos.push(...page);
  if (page.length < 1000) break;
}
const orders = photos.filter((photo) => String(photo.file_path || '').startsWith('orders/'));
const todo = Number.isFinite(MAX) ? orders.slice(0, MAX) : orders;

console.log(`Pedidos en las últimas 72 h: ${orders.length}${todo.length < orders.length ? ` (revisando los ${todo.length} más nuevos)` : ''}`);
console.log('(Todos pueden tener ticket: se sube con o sin código y dura 72 h)');

let withTicket = 0;
const rows = [];
for (const photo of todo) {
  const res = await fetch(`${URL_BASE}/functions/v1/order-code-recovery`, {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'ticket', photoId: photo.id }),
  });
  const body = await res.json();
  let verdict;
  if (res.status === 200 && body.url) { verdict = 'TICKET ✓'; withTicket += 1; }
  else if (body.error?.includes('ya no está disponible')) verdict = 'sin ticket (nunca subió o venció)';
  else if (body.error?.includes('no encontrado')) verdict = 'FOTO INEXISTENTE';
  else verdict = `ERROR ${res.status}: ${body.error}`;
  rows.push({
    fecha: photo.created_at.slice(0, 16),
    quien: (photo.taken_by || '-').padEnd(8),
    codigo: photo.name === NO_CODE ? 'sin código' : 'con código',
    verdict,
  });
}

console.log('\nFECHA              QUIEN     CODIGO      RESULTADO');
for (const r of rows) console.log(`${r.fecha}  ${r.quien} ${r.codigo.padEnd(11)} ${r.verdict}`);
console.log(`\nCon ticket remoto: ${withTicket} | Sin ticket: ${todo.length - withTicket}`);

