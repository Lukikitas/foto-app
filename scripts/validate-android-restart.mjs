import { execFileSync } from 'node:child_process';
import { writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { JSDOM } from 'jsdom';

// Restricted to the dedicated debug package on an emulator. Its APK points to
// android-test.invalid; this scenario cannot create production orders.
const adb = path.join(process.env.LOCALAPPDATA, 'Android', 'Sdk', 'platform-tools', 'adb.exe');
const serial = 'emulator-5554';
const app = 'app.deliverystar.capture.debug';
const folder = 'output/android-camera-20261029.local';
await mkdir(folder, { recursive: true });
const command = (...args) => execFileSync(adb, ['-s', serial, ...args], { encoding: 'utf8', timeout: 30_000, stdio: ['ignore', 'pipe', 'pipe'] });
function ui() {
  const dumped = command('shell', 'uiautomator', 'dump', '/sdcard/foto-restart-test.xml');
  if (!dumped.includes('dumped to:')) return null;
  const xml = command('exec-out', 'cat', '/sdcard/foto-restart-test.xml');
  if (!xml.trimStart().startsWith('<?xml') && !xml.trimStart().startsWith('<hierarchy')) return null;
  return new JSDOM(xml, { contentType: 'text/xml' });
}
function click(dom, text) {
  let target = [...dom.window.document.querySelectorAll('node')].find(node => node.getAttribute('text') === text);
  while (target && target.getAttribute('clickable') !== 'true') target = target.parentElement;
  if (!target || target.getAttribute('package') !== app || target.getAttribute('enabled') !== 'true') throw new Error(`Control no disponible: ${text}`);
  const [left, top, right, bottom] = target.getAttribute('bounds').match(/\d+/g).map(Number);
  command('shell', 'input', 'tap', String(Math.round((left + right) / 2)), String(Math.round((top + bottom) / 2)));
}
function until(...texts) {
  for (let attempt = 0; attempt < 8; attempt++) {
    const dom = ui();
    if (!dom) continue;
    if ([...dom.window.document.querySelectorAll('node')].some(node => texts.includes(node.getAttribute('text')))) return dom;
    dom.window.close();
  }
  throw new Error(`No apareció: ${texts.join(' / ')}`);
}
const report = { serial, package: app, checks: [] };
command('shell', 'am', 'start', '-n', `${app}/app.deliverystar.capture.MainActivity`);
let dom = until('Sacar ticket', 'Sacar bolsa');
const author = dom.window.document.querySelector('node[class="android.widget.EditText"]')?.getAttribute('text') || '';
if (!author.startsWith('QA-')) throw new Error('El escenario requiere el autor sintético creado por CameraFlowTest. No se modificó ninguna captura.');
if ([...dom.window.document.querySelectorAll('node')].some(node => node.getAttribute('text') === 'Sacar ticket')) click(dom, 'Sacar ticket');
dom.window.close();
dom = until('Sacar bolsa'); dom.window.close();
report.checks.push('ticket-durable-before-process-stop');
command('shell', 'am', 'force-stop', app);
command('shell', 'am', 'start', '-n', `${app}/app.deliverystar.capture.MainActivity`);
dom = until('Ticket recuperado. Ahora sacá la bolsa.');
if (![...dom.window.document.querySelectorAll('node')].some(node => node.getAttribute('text')?.includes('Ticket recuperado'))) throw new Error('No se confirmó la recuperación del ticket.');
report.checks.push('incomplete-ticket-recovered-after-process-stop');
click(dom, 'Sacar bolsa'); dom.window.close();
dom = until('Par guardado en este celular. Podés seguir.'); dom.window.close();
report.checks.push('recovered-ticket-completed-with-new-bag');
const memory = command('shell', 'dumpsys', 'meminfo', app);
await writeFile(`${folder}/restart-memory.txt`, memory);
command('shell', 'screencap', '-p', '/sdcard/foto-restart-test.png');
command('pull', '/sdcard/foto-restart-test.png', `${folder}/restart.png`);
await writeFile(`${folder}/restart-verification.json`, JSON.stringify({ ...report, at: new Date().toISOString() }, null, 2));
console.log(JSON.stringify(report));
