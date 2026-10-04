// Diagnóstico de solo lectura: qué fotos recientes tienen ticket en Supabase.
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

const headers = { Authorization: `Bearer ${KEY}`, apikey: KEY };

const desde = new Date(Date.now() - 72 * 3600 * 1000).toISOString();
const photos = await fetch(
  `${URL_BASE}/rest/v1/photos?select=id,name,created_at,taken_by` +
    `&name=eq.${encodeURIComponent(NO_CODE)}&created_at=gte.${desde}&order=created_at.desc`,
  { headers },
).then((r) => r.json());

console.log(`Fotos SIN CÓDIGO en las últimas 72 h: ${photos.length}`);
console.log('(Solo ellas pueden tener ticket: se sube solo a pedidos sin código)');

let withTicket = 0;
const rows = [];
for (const photo of photos) {
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
    verdict,
  });
}

console.log('\nFECHA              QUIEN     RESULTADO');
for (const r of rows) console.log(`${r.fecha}  ${r.quien} ${r.verdict}`);
console.log(`\nCon ticket remoto: ${withTicket} | Sin ticket: ${photos.length - withTicket}`);
