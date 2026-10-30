import { writeFile } from 'node:fs/promises';
const base = 'https://delivery.star-app.com.ar';
const response = await fetch(base + '/', { signal: AbortSignal.timeout(20_000) });
if (!response.ok) throw new Error(`Inicio: HTTP ${response.status}`);
const html = await response.text();
const entry = html.match(/src="([^"]*\/assets\/index-[^"]+\.js)"/)?.[1];
if (!entry) throw new Error('No se encontró el módulo principal publicado.');
const source = await (await fetch(new URL(entry, base), { signal: AbortSignal.timeout(20_000) })).text();
const report = { at: new Date().toISOString(), status: response.status, entry,
  versionFound: source.includes('1.14.1'), releaseNotesFound: source.includes('Capturas guardadas y subidas recuperables') };
if (!report.versionFound || !report.releaseNotesFound) throw new Error('La publicación todavía no expone la versión 1.14.1 esperada.');
await writeFile('output/capture-backend-20261029.local/web-release.json', JSON.stringify(report, null, 2));
console.log(JSON.stringify(report));
