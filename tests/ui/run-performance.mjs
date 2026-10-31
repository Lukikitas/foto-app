import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { createServer } from 'vite';
import { act } from 'react';
import { IDBFactory } from 'fake-indexeddb';

// React DOM integration, no real browser, camera, credentials or remote writes.
process.env.VITE_SUPABASE_URL='https://fixture.supabase.co';
process.env.VITE_SUPABASE_ANON_KEY='fixture-only';
process.env.VITE_APP_TEMPORARILY_CLOSED='false';
const dom = new JSDOM('<div id="root"></div>',{url:'http://localhost/tests/ui/performance.html',pretendToBeVisual:true});
const pageSize=process.argv.includes('--mobile')?30:100;
for(const key of ['window','document','navigator','localStorage','sessionStorage','HTMLElement','Element','MutationObserver','Event','MouseEvent'])
  Object.defineProperty(globalThis,key,{configurable:true,writable:true,value:key==='window'?dom.window:dom.window[key]});
globalThis.IS_REACT_ACT_ENVIRONMENT=true;
globalThis.indexedDB = new IDBFactory();
window.matchMedia=()=>({matches:pageSize===30,addEventListener(){},removeEventListener(){}});
globalThis.BroadcastChannel=class extends EventTarget { postMessage() {} close() {} };
window.scrollTo=()=>{};
window.HTMLElement.prototype.scrollIntoView=()=>{};
const originalFetch=globalThis.fetch;
window.fetch=originalFetch;
const originalSocket=globalThis.WebSocket;
const server=await createServer({server:{middlewareMode:true,hmr:false,watch:null},appType:'custom',optimizeDeps:{noDiscovery:true,include:[]}});
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function until(predicate,label) {
  for(let n=0;n<100;n++) { await act(async()=>{await sleep(50);}); if(predicate())return; }
  throw new Error('Timed out: '+label+'\n'+document.body.textContent.slice(0,1800));
}
async function click(element) { assert.ok(element,'missing control');await act(async()=>element.click()); }
const nav=name=>document.querySelector(`.app-nav__btn[aria-label="${name}"]`);
function queries() {
  const aside=document.querySelector('aside');
  return Object.fromEntries([...aside.querySelectorAll('div')].map(row=>{const [key,value]=row.textContent.split(': ');return [key,Number(value)];}));
}
try {
  const queueStore=await server.ssrLoadModule('/src/lib/uploadQueueStore.js');
  queueStore.useQueueStoreForTests(queueStore.createMemoryQueueStore());
  await act(async()=>{await server.ssrLoadModule('/tests/ui/performance.jsx');});
  globalThis.fetch=window.fetch;
  globalThis.WebSocket=window.WebSocket;
  await until(()=>nav('Métricas'),'application navigation');
  if(pageSize===30)await click(nav('Métricas'));
  await until(()=>document.querySelector('.metrics-dash')?.textContent.includes('10.000') && !document.querySelector('.metrics-dash').closest('[hidden]'),'server overview');
  assert.equal(document.querySelector('.metrics-dash').textContent.includes('10.000'),true);
  console.log('OK overview renders server summaries');
  await click(nav('Galería de pedidos'));
  await until(()=>document.querySelectorAll('.photo-card').length===pageSize,'bounded gallery');
  assert.match(document.querySelector('.gallery__count').textContent,/10000/);
  await click(document.querySelector('.photo-card input[type="checkbox"]'));
  await click([...document.querySelectorAll('.gallery__pager button')].find(button=>button.textContent.includes('Siguiente')));
  await until(()=>document.querySelector('.photo-card')?.textContent.includes(String(10000+pageSize)),'gallery page two');
  assert.match(document.querySelector('.gallery__count').textContent,/1 sel/);
  await click(document.querySelector('.photo-card input[type="checkbox"]'));
  assert.match(document.querySelector('.gallery__count').textContent,/2 sel/);
  console.log('OK gallery requests one page and preserves selection across pages');
  await click(nav('Historial'));
  await until(()=>document.querySelectorAll('.complaints__list > *').length===pageSize,'history first page');
  const first=document.querySelector('.complaints__list').textContent;
  await click([...document.querySelectorAll('.gallery__pager button')].find(button=>button.textContent.includes('Siguiente')));
  await until(()=>document.querySelector('.complaints__list')?.textContent && document.querySelector('.complaints__list').textContent!==first,'history second page');
  assert.equal(document.querySelectorAll('.complaints__list > *').length,pageSize);
  console.log('OK history uses bounded server pages');
  await click(nav('Reclamos'));
  await until(()=>document.body.textContent.includes('No hay ninguna lista pendiente') || document.querySelector('.draft-review'),'draft view');
  await act(async()=>{await sleep(400);});
  await click([...document.querySelectorAll('button')].find(button=>button.textContent==='Ver consultas'));
  const before=queries().foto_draft_read_if_changed;
  await click(nav('Sacar foto'));
  await act(async()=>{await sleep(5500);});
  await click([...document.querySelectorAll('button')].find(button=>button.textContent==='Ver consultas'));
  assert.equal(queries().foto_draft_read_if_changed,before);
  console.log('OK hidden complaints do not poll while capture screen is active');
  await click(nav('Métricas'));
  await until(()=>document.querySelector('.metrics-dash'),'return to metrics');
  await click([...document.querySelectorAll('.metrics__views button')].find(button=>button.textContent==='Cargar'));
  await until(()=>document.querySelector('.metrics-entry-selector'),'metrics entry');
  await click([...document.querySelectorAll('.metrics-entry-selector button')].find(button=>button.textContent==='Cargar un día'));
  const field=document.querySelector('.metrics-entry input[type="number"]');
  await act(async()=>{
    Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set.call(field,'123');
    field.dispatchEvent(new Event('input',{bubbles:true}));
  });
  await click(nav('Sacar foto'));
  await until(()=>[...document.querySelectorAll('button')].some(button=>button.textContent==='Cambiar de sección'),'dirty draft confirmation');
  await click([...document.querySelectorAll('button')].find(button=>button.textContent==='Cambiar de sección'));
  await click(nav('Métricas'));
  await until(()=>[...document.querySelectorAll('button')].some(button=>button.textContent==='Cambiar de sección'),'return confirmation');
  await click([...document.querySelectorAll('button')].find(button=>button.textContent==='Cambiar de sección'));
  assert.equal(document.querySelector('.metrics-entry input[type="number"]').value,'123');
  console.log('OK unsaved metrics entry survives hiding and reopening the page');
} finally {
  await act(async()=>{document.dispatchEvent(new Event('unmount-fixture'));});
  const {supabase}=await server.ssrLoadModule('/src/lib/supabase.js');
  supabase.realtime.disconnect();
  await supabase.auth.stopAutoRefresh();
  await server.close();dom.window.close();globalThis.fetch=originalFetch;globalThis.WebSocket=originalSocket;
}
