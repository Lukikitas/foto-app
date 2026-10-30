import { execFileSync } from 'node:child_process';
import { writeFile, readFile } from 'node:fs/promises';
import path from 'node:path';

// Emulator-only recovery gate. Never targets a physical phone or production
// application. A saved snapshot lets an interrupted observation resume safely.
const adb = path.join(process.env.LOCALAPPDATA, 'Android', 'Sdk', 'platform-tools', 'adb.exe');
const serial = 'emulator-5554';
const app = 'app.deliverystar.capture.debug';
const reportPath = 'output/android-camera-20261029.local/reboot-verification.json';
const command = (...args) => execFileSync(adb, ['-s', serial, ...args], { encoding: 'utf8', timeout: 15_000, stdio: ['ignore', 'pipe', 'pipe'] }).trim();
function hashes() {
  const files = command('shell', 'run-as', app, 'find', 'files/captures', '-type', 'f').split(/\r?\n/).filter(file => file.endsWith('.jpg')).sort();
  if (!files.length || files.some(file => !/^files\/captures\/[a-f0-9-]+\/(ticket|evidence)-[a-f0-9-]+\.jpg$/.test(file))) throw new Error('El escenario no reconoce sus archivos de prueba.');
  const result = [];
  for (let offset = 0; offset < files.length; offset += 25) result.push(...command('shell', 'run-as', app, 'sha256sum', ...files.slice(offset, offset + 25)).split(/\r?\n/));
  return result.sort();
}
let report;
try { report = JSON.parse(await readFile(reportPath, 'utf8')); } catch { /* First run. */ }
if (report?.passed) { console.log(`Prueba ya completada: ${report.originals.length} archivos preservados.`); process.exit(0); }
if (!report) {
  report = { serial, package: app, beforeAt: new Date().toISOString(), originals: hashes(), rebootRequested: true };
  await writeFile(reportPath, JSON.stringify(report, null, 2));
  command('reboot');
}
let booted = false;
const deadline = Date.now() + 120_000;
while (Date.now() < deadline) {
  try { if (command('shell', 'getprop', 'sys.boot_completed') === '1') { booted = true; break; } } catch { /* Same emulator is rebooting; do not restart it. */ }
  await new Promise(resolve => setTimeout(resolve, 1000));
}
if (!booted) throw new Error('El emulador todavía no confirmó el arranque. Repetir este script continúa la observación sin volver a reiniciarlo.');
command('shell', 'input', 'keyevent', '82');
const restored = hashes();
if (JSON.stringify(restored) !== JSON.stringify(report.originals)) throw new Error('Los archivos pendientes no coinciden después del reinicio.');
command('shell', 'am', 'start', '-n', `${app}/app.deliverystar.capture.MainActivity`);
await writeFile(reportPath, JSON.stringify({ ...report, afterAt: new Date().toISOString(), passed: true }, null, 2));
console.log(JSON.stringify({ serial, filesVerified: restored.length, passed: true }));
