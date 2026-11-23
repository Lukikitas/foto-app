import assert from 'node:assert/strict';
import { JSDOM, VirtualConsole } from 'jsdom';
import { createServer } from 'vite';
import { act } from 'react';
import { IDBFactory } from 'fake-indexeddb';

const mobile = process.argv.includes('--mobile');
let handoffs = 0;
const virtualConsole = new VirtualConsole();
virtualConsole.on('jsdomError', error => {
  if (error.type === 'not-implemented' && error.message.includes('navigation')) handoffs++;
  else throw error;
});
const dom = new JSDOM('<div id="root"></div>', { url: 'http://127.0.0.1:4174/', pretendToBeVisual: true, virtualConsole });
for (const key of ['window', 'document', 'navigator', 'localStorage', 'sessionStorage', 'HTMLElement', 'Element', 'MutationObserver', 'Event', 'MouseEvent'])
  Object.defineProperty(globalThis, key, { configurable: true, writable: true, value: key === 'window' ? dom.window : dom.window[key] });
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
Object.defineProperty(navigator, 'userAgent', { configurable: true, value: mobile ? 'Mozilla/5.0 (Linux; Android 15) Chrome/141.0 Mobile' : 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' });
globalThis.indexedDB = new IDBFactory();
window.matchMedia = () => ({ matches: mobile, addEventListener() {}, removeEventListener() {} });
window.scrollTo = () => {};
window.HTMLElement.prototype.scrollIntoView = () => {};
globalThis.BroadcastChannel = class extends EventTarget { postMessage() {} close() {} };
let requests = 0;
const realFetch = globalThis.fetch;
globalThis.fetch = window.fetch = async () => { requests++; throw new Error('Network is forbidden in the demo test'); };
const realSocket = globalThis.WebSocket;
globalThis.WebSocket = class { constructor() { throw new Error('Remote socket is forbidden in demo'); } };
const server = await createServer({ mode: 'demo', cacheDir: 'node_modules/.vite-demo-test', server: { middlewareMode: true, hmr: false, watch: null }, appType: 'custom', optimizeDeps: { noDiscovery: true, include: [] } });
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(predicate, label) {
  for (let n = 0; n < 100; n++) { await act(async () => { await sleep(30); }); if (predicate()) return; }
  throw new Error(`Timed out: ${label}\n${document.body.textContent.slice(0, 2000)}`);
}
async function click(element) { assert.ok(element, 'Missing control'); await act(async () => element.click()); }
const nav = name => document.querySelector(`.app-nav__btn[aria-label="${name}"]`);
try {
  await act(async () => { await server.ssrLoadModule('/tests/ui/demo.jsx'); });
  await until(() => document.querySelector('.metrics-dash') && !document.querySelector('.metrics-dash').closest('[hidden]'), 'overview without Supabase credentials');
  assert.match(document.querySelector('.demo-banner').textContent, /Datos ficticios/);
  assert.equal(document.querySelector('[role="alert"]'), null);
  const client = await server.ssrLoadModule('/src/demo/client.js');
  assert.ok(client.demoData);
  for (const tab of ['Quejas', 'Desempeño', 'Informe', 'Resumen']) {
    await click([...document.querySelectorAll('.metrics__views button')].find(button => button.textContent === tab));
    await until(() => !document.querySelector('.metrics-refresh button').disabled && !document.querySelector('.metrics .spinner'), tab);
    assert.equal(document.querySelector('[role="alert"]'), null, `${tab} must render without errors`);
  }
  await click(nav('Galería de pedidos'));
  await until(() => document.querySelectorAll('.photo-card').length === (mobile ? 30 : 100), 'gallery');
  const firstPage = document.querySelector('.photo-card').textContent;
  await click([...document.querySelectorAll('.gallery__pager button')].find(button => button.textContent.includes('Siguiente')));
  await until(() => document.querySelector('.photo-card')?.textContent !== firstPage, 'gallery pagination');
  await click(nav('Historial'));
  await until(() => document.querySelector('.complaints__list')?.children.length > 0, 'history');
  assert.equal(document.querySelector('[role="alert"]'), null);
  await click(nav('Reclamos'));
  await until(() => document.querySelector('.draft-review')?.textContent.includes('PEYA'), 'complaints matched to example evidence');
  assert.equal(document.querySelector('[role="alert"]'), null);
  await click(nav('Archivos'));
  await until(() => document.querySelectorAll('.photo-card').length === 3, 'example files');
  await click(nav('Sacar foto'));
  await until(() => document.querySelector('.native-camera-entry'), 'native capture handoff');
  assert.equal(handoffs, 0, 'first visit lets the photographer enter a name');
  const authorField = document.querySelector('.native-camera-entry .photographer input');
  const openCamera = () => document.querySelector('.native-camera-entry .uploader__hero-camera-btn');
  assert.equal(openCamera().getAttribute('aria-disabled'), 'true');
  await click(openCamera());
  assert.equal(handoffs, 0, 'an empty photographer cannot launch the camera');
  assert.match(document.querySelector('[role="alert"]').textContent, /Ingresá quién/);
  await act(async () => {
    Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set.call(authorField, 'María Demo');
    authorField.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await until(() => openCamera().getAttribute('aria-disabled') === 'false', 'photographer enables the camera');
  if (mobile) {
    assert.match(openCamera().href, /package=app\.deliverystar\.capture\.demo;/);
    assert.match(openCamera().href, /S.capture_author=Mar%C3%ADa%20Demo;/);
  } else assert.equal(openCamera().href, 'http://127.0.0.1:4174/demo/camara/');
  await click(openCamera());
  assert.equal(handoffs, 1, 'named capture opens the native camera or download page');
  assert.equal(localStorage.getItem('foto-app-taken-by'), 'María Demo');
  assert.equal(document.querySelector('.native-camera-entry__download').href, 'http://127.0.0.1:4174/demo/camara/');
  assert.equal(document.querySelector('video'), null);
  await click(nav('Ajustes'));
  await until(() => document.querySelector('.settings__retention-field') || document.querySelector('.settings'), 'settings');
  await act(async () => { await sleep(150); });
  assert.equal(document.querySelector('[role="alert"]'), null);
  await click(nav('Sacar foto'));
  await until(() => document.querySelector('.native-camera-entry .photographer input')?.value === 'María Demo', 'photographer survives navigation');
  assert.equal(handoffs, 2, 'a known photographer launches directly on later photo navigation');
  if (!mobile) {
    await click(nav('Pendientes'));
    await act(async () => { await sleep(200); });
    assert.equal(document.querySelector('[role="alert"]'), null);
  }
  const write = await client.supabase.from('photos').delete().eq('id', 'demo-1');
  assert.equal(write.error.code, 'DEMO_READ_ONLY');
  assert.equal((await client.supabase.rpc('foto_documents_commit', {})).error.code, 'DEMO_READ_ONLY');
  assert.equal((await client.supabase.storage.from('photos').remove(['orders/a.jpg'])).error.code, 'DEMO_READ_ONLY');
  assert.equal(requests, 0, 'demo must not make network requests');
  console.log(`OK demo ${mobile ? 'mobile' : 'desktop'}: real screens, pagination, blocked mutations, zero network requests`);
} finally {
  await act(async () => { document.dispatchEvent(new Event('unmount-demo')); });
  await server.close(); dom.window.close(); globalThis.fetch = realFetch; globalThis.WebSocket = realSocket;
}
