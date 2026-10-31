import assert from 'node:assert/strict';
import { JSDOM, VirtualConsole } from 'jsdom';
import { createServer } from 'vite';
import { act } from 'react';
import { IDBFactory } from 'fake-indexeddb';

// Render the real App with the existing isolated backend fixture. Never uses
// production credentials, camera hardware or an actual native-app redirect.
const android = !process.argv.includes('--desktop');
const rollback = process.argv.includes('--rollback');
const closed = process.argv.includes('--closed');
process.env.VITE_SUPABASE_URL = 'https://fixture.supabase.co';
process.env.VITE_SUPABASE_ANON_KEY = 'fixture-only';
process.env.VITE_NATIVE_CAMERA_ENABLED = rollback ? 'false' : 'true';
// In closure mode leave the flag absent: the production default must be closed.
if (closed) delete process.env.VITE_APP_TEMPORARILY_CLOSED;
else process.env.VITE_APP_TEMPORARILY_CLOSED = 'false';
let handoffs = 0;
const virtualConsole = new VirtualConsole();
virtualConsole.on('jsdomError', error => {
  if (error.type === 'not-implemented' && error.message.includes('navigation')) handoffs++;
  else throw error;
});
const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost/tests/ui/performance.html', pretendToBeVisual: true, virtualConsole });
Object.defineProperty(dom.window.navigator, 'userAgent', { value: android ? 'Mozilla/5.0 (Linux; Android 16; 2311DRK48G) Chrome/141.0 Mobile' : 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' });
for (const key of ['window', 'document', 'navigator', 'localStorage', 'sessionStorage', 'HTMLElement', 'Element', 'MutationObserver', 'Event', 'MouseEvent']) {
  Object.defineProperty(globalThis, key, { configurable: true, writable: true, value: key === 'window' ? dom.window : dom.window[key] });
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
globalThis.indexedDB = new IDBFactory();
globalThis.BroadcastChannel = class extends EventTarget { postMessage() {} close() {} };
window.matchMedia = () => ({ matches: android, addEventListener() {}, removeEventListener() {} });
window.scrollTo = () => {};
window.HTMLElement.prototype.scrollIntoView = () => {};
window.fetch = globalThis.fetch;
if (closed) Object.defineProperty(navigator, 'onLine', { value: false });
const previousFetch = globalThis.fetch;
const previousSocket = globalThis.WebSocket;
let cameraRequests = 0;
Object.defineProperty(navigator, 'mediaDevices', { value: { getUserMedia() { cameraRequests++; throw new Error('Web camera must not be opened by native handoff'); } } });
const server = await createServer({ server: { middlewareMode: true, hmr: false, watch: null }, appType: 'custom', optimizeDeps: { noDiscovery: true, include: [] } });
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(predicate, label) {
  for (let i = 0; i < 100; i++) { await act(async () => { await sleep(50); }); if (predicate()) return; }
  throw new Error(`Timed out: ${label}; ${document.body.textContent.slice(0, 1500)}`);
}
const nav = label => document.querySelector(`.app-nav__btn[aria-label="${label}"]`);
async function click(node) { assert.ok(node); await act(async () => node.click()); }
try {
  const queueStore = await server.ssrLoadModule('/src/lib/uploadQueueStore.js');
  if (!closed) queueStore.useQueueStoreForTests(queueStore.createMemoryQueueStore());
  const drafts = await server.ssrLoadModule('/src/lib/captureDraftStore.js');
  const original = { id: 'pending-web-ticket', createdAt: 1700000000000, ticketFile: new Blob(['exact ticket bytes']), meta: { taken_by: 'QA pending web' } };
  await drafts.saveCaptureDraft(original);
  let pair;
  if (closed) {
    const queue = await server.ssrLoadModule('/src/lib/uploadQueue.js');
    await queue.enqueue({ id: 'closed-web-pair', createdAt: 1700000000001,
      file: new File(['exact bag bytes'], 'bag.jpg', {type:'image/jpeg'}), ticketFile: new File(['exact pair ticket bytes'], 'ticket.jpg', {type:'image/jpeg'}),
      kind: 'order', orderDigits: '1234', meta: { taken_by: 'QA preserved pair' } });
    pair = await queueStore.getQueueRecord('closed-web-pair');
  }
  await act(async () => { await server.ssrLoadModule('/tests/ui/performance.jsx'); });
  if (closed) {
    await until(() => document.querySelector('.temporary-closure'), 'web closure on entry');
    assert.equal(document.querySelector('h1').textContent, 'La app se encuentra momentáneamente cerrada');
    assert.ok(document.body.textContent.includes('Gracias por haberla usado y por ayudarnos en su desarrollo.'));
    assert.equal(document.querySelector('.app-nav'), null, 'Normal app navigation must not mount');
    assert.equal(document.querySelector('input[type="file"]'), null);
    assert.equal(document.querySelector('a[href^="intent:"]'), null, 'Closure must not launch native capture');
    assert.equal(document.querySelector('.temporary-closure').querySelector('button, a, input, select, textarea, [role="button"]'), null, 'Only the notice is accessible when no update is available');
    assert.equal(document.querySelector('.upload-queue'), null, 'Pending uploads must not be accessible');
    const stored = await queueStore.getQueueRecord(pair.id);
    assert.equal(stored.createdAt, pair.createdAt);
    assert.deepEqual(stored.meta, pair.meta);
    assert.equal(await stored.file.text(), await pair.file.text());
    assert.equal(await stored.ticket.text(), await pair.ticket.text());
    assert.equal(await (await drafts.getCaptureDraft(original.id)).ticketFile.text(), await original.ticketFile.text());
    assert.equal(handoffs, 0);
    assert.equal(cameraRequests, 0);
    console.log(`PASS ${android ? 'mobile' : 'desktop'} web closure: notice, blocked navigation/capture, original ticket and queued pair preserved in IndexedDB`);
  } else {
  await until(() => nav('Sacar foto'), 'app navigation');
  if (!android) await click(nav('Sacar foto'));
  const native = android && !rollback;
  await until(() => native ? document.querySelector('.native-camera-entry') : document.querySelector('.uploader'), 'capture screen');
  if (native) {
    const open = document.querySelector('.native-camera-entry a[href^="intent:"]');
    assert.ok(open);
    const fallback = document.querySelector('.native-camera-entry__download');
    assert.equal(fallback.href, 'http://localhost/manual/piloto-android/');
    assert.ok(open.href.includes('package=app.deliverystar.capture;'));
    assert.ok(open.href.includes(`S.browser_fallback_url=${encodeURIComponent(fallback.href)};`));
    assert.equal(document.querySelector('input[capture]'), null);
    assert.equal(document.querySelector('.order-camera'), null);
    assert.equal(handoffs, 0, 'Initial page load must not auto-launch an app');
    await click(open);
    await until(() => handoffs === 1, 'explicit intent gesture');
    assert.equal(handoffs, 1, 'The explicit capture gesture attempts the intent');
  } else {
    assert.equal(document.querySelector('.native-camera-entry'), null);
    assert.ok(document.querySelector('input[capture="environment"]'), 'Existing web camera remains available');
    assert.ok(document.querySelector('input[type="file"]'), 'Existing gallery upload remains available');
    assert.equal(handoffs, 0);
  }
  await click(nav('Galería de pedidos'));
  await until(() => document.querySelectorAll('.photo-card').length > 0, 'gallery remains functional');
  await click(nav('Sacar foto'));
  assert.equal(handoffs, native ? 2 : 0, 'Only Android native mode launches from the photo navigation button');
  if (native) {
    await click(nav('Métricas'));
    await until(() => document.querySelector('.metrics-dash'), 'metrics before dirty navigation');
    await click([...document.querySelectorAll('.metrics__views button')].find(button => button.textContent === 'Cargar'));
    await until(() => document.querySelector('.metrics-entry-selector'), 'metrics entry');
    await click([...document.querySelectorAll('.metrics-entry-selector button')].find(button => button.textContent === 'Cargar un día'));
    const field = document.querySelector('.metrics-entry input[type="number"]');
    await act(async () => {
      Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set.call(field, '123');
      field.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await click(nav('Sacar foto'));
    await until(() => document.querySelector('.app-dialog__actions'), 'unsaved changes confirmation');
    assert.equal(handoffs, 2, 'Unsaved changes must block the external app launch');
    await click([...document.querySelectorAll('.app-dialog__actions button')].find(button => button.textContent === 'Cancelar'));
    assert.equal(handoffs, 2);
    assert.equal(document.querySelector('.metrics-entry input[type="number"]').value, '123');
    await click(nav('Sacar foto'));
    await until(() => document.querySelector('.app-dialog__actions'), 'confirm leaving metrics');
    await click([...document.querySelectorAll('.app-dialog__actions button')].find(button => button.textContent === 'Cambiar de sección'));
    assert.equal(handoffs, 3);
  }
  const recovered = await drafts.getCaptureDraft(original.id);
  assert.equal(recovered.createdAt, original.createdAt);
  assert.deepEqual(recovered.meta, original.meta);
  assert.equal(await recovered.ticketFile.text(), await original.ticketFile.text());
  assert.equal(cameraRequests, 0);
  console.log(`PASS ${native ? 'Android native handoff' : rollback ? 'Android web-camera rollback' : 'desktop web camera'}: navigation, download fallback, gallery and original pending ticket preserved`);
  }
} finally {
  await act(async () => document.dispatchEvent(new Event('unmount-fixture')));
  await act(async () => { await sleep(200); });
  const { supabase } = await server.ssrLoadModule('/src/lib/supabase.js');
  supabase.realtime.disconnect();
  await supabase.auth.stopAutoRefresh();
  await server.close();
  globalThis.fetch = previousFetch;
  globalThis.WebSocket = previousSocket;
  dom.window.close();
}
