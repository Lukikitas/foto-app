import { mkdir, writeFile } from 'node:fs/promises';
const directory = new URL('../public/aggregators/', import.meta.url);
await mkdir(directory, { recursive: true });
const brands = [['pedidosya', 490099807], ['rappi', 984044296], ['mercadopago', 925436649]];
const sources = [];
for (const [brand, id] of brands) {
  const lookup = await fetch(`https://itunes.apple.com/lookup?id=${id}&country=ar`);
  if (!lookup.ok) throw new Error(`Metadata unavailable for ${brand}`);
  const app = (await lookup.json()).results[0];
  const icon = app?.artworkUrl512 || app?.artworkUrl100;
  if (!icon || !new URL(icon).hostname.endsWith('mzstatic.com')) throw new Error(`Missing Apple artwork for ${brand}`);
  const response = await fetch(icon);
  if (!response.ok || !response.headers.get('content-type')?.startsWith('image/')) throw new Error(`Invalid artwork for ${brand}`);
  await writeFile(new URL(`${brand}.jpg`, directory), Buffer.from(await response.arrayBuffer()));
  sources.push({ brand, app: app.trackName, developer: app.sellerName, page: app.trackViewUrl, artwork: icon });
}
await writeFile(new URL('sources.json', directory), JSON.stringify({ retrieved: '2026-10-11', sources }, null, 2) + '\n');
console.log('Saved three platform icons and their source references.');
