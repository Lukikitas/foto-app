import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
const root = path.resolve(import.meta.dirname, '..');
const apk = path.join(root, 'android-camera/app/build/outputs/apk/demo/app-demo.apk');
const release = JSON.parse(await readFile(path.join(root, 'src/demo/camera-release.json'), 'utf8'));
let bytes;
try { bytes = await readFile(apk); }
catch (error) {
  if (error.code !== 'ENOENT') throw error;
  const response = await fetch(release.url, { signal: AbortSignal.timeout(120000) });
  if (!response.ok) throw new Error(`No se pudo descargar el APK demo publicado: HTTP ${response.status}`);
  bytes = Buffer.from(await response.arrayBuffer());
}
if (bytes.length !== release.bytes || createHash('sha256').update(bytes).digest('hex') !== release.sha256) {
  throw new Error('El APK demo no coincide con la versión verificada. No se publicará una descarga distinta.');
}
const folder = path.join(root, 'output/demo');
await mkdir(folder, { recursive: true });
await writeFile(path.join(folder, 'Delivery-Star-Camara-DEMO.apk'), bytes);
console.log('APK de cámara demo listo para la descarga desde la web.');
