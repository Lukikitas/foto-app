import test from 'node:test';
import assert from 'node:assert/strict';
import { read, write } from '../vendor/xlsx.mjs';
import { parsePeyaWorkbook, mergePeyaHistory, mergePeyaMetrics, normalizeStoreName, PEYA_SHEETS } from './peyaWorkbook.js';
import { emptyHistory } from './complaintHistory.js';
import { emptyStore } from './metrics.js';
import { executePeyaImport } from './peyaImportFlow.js';

function put(sheet, address, value) { sheet[address] = { t: typeof value === 'number' ? 'n' : 's', v: value }; }
function fixture() {
  const complaints = { '!ref': 'A1:L10' };
  for (const [c,v] of Object.entries({C:'Partner_Name',F:'Motivo',L:'Monto'})) put(complaints,c+'1',v);
  for (const [c,v] of Object.entries({B:2287321383,C:'KFC -   LA PLATA',D:46282,E:0.5,F:'missing item',G:'Faltó una papa',H:'Combo',I:'Extra',L:3780})) put(complaints,c+'2',v);
  put(complaints,'C3','KFC OTRO LOCAL'); put(complaints,'B3',9876543210);
  const orders = { '!ref': 'T1:AB100' };
  const awt = { '!ref': 'H1:P100' };
  put(orders,'U61','Partner_Name'); put(orders,'U62','KFC - LA PLATA');
  put(awt,'I2','Partner Name'); put(awt,'I3','KFC – LA PLATA');
  const orderCols=['V','W','X','Y','Z','AA','AB'];
  const awtCols=['J','K','L','M','N','O','P'];
  for(let i=0;i<7;i++) {
    put(orders,orderCols[i]+'61',46282+i); put(orders,orderCols[i]+'62',[168,230,239,247,138,135,153][i]);
    put(awt,awtCols[i]+'2',46282+i); put(awt,awtCols[i]+'3',[33,3,13,31,10,9,33][i]);
  }
  // Different tables on the same sheet must not be mistaken for the requested table.
  put(orders,'U6','KFC - LA PLATA'); put(orders,'V6',999);
  put(awt,'I95','KFC - LA PLATA'); put(awt,'J95',999);
  return { SheetNames: ['Reclamos - Órdenes','Resumen por tienda','AWT 5'], Sheets: {'Reclamos - Órdenes':complaints,'Resumen por tienda':orders,'AWT 5':awt} };
}
const report = () => parsePeyaWorkbook(fixture());
test('real layout, exact normalized local and cached formulas', () => {
  const book=fixture(); book.Sheets['Reclamos - Órdenes'].L2={t:'n',f:'1-1',v:0};
  const result=parsePeyaWorkbook(book);
  assert.equal(result.complaints.length,1); assert.equal(result.excluded,1);
  assert.equal(result.complaints[0].amount,0);
  assert.equal(result.complaints[0].orderAtIso,'2026-09-17T15:00:00.000Z');
  assert.equal(result.complaints[0].fields['Nombre opcional'],'Extra');
  assert.deepEqual(result.daily.map(r=>r.orders),[168,230,239,247,138,135,153]);
  assert.deepEqual(result.daily.map(r=>r.awt),[33,3,13,31,10,9,33]);
  assert.deepEqual(result.daily.map(r=>r.complaints),[1,0,0,0,0,0,0]);
  assert.equal(normalizeStoreName(' KFC —   La Plata '),'KFC-LA PLATA');
});
test('reader round trip through XLSX bytes preserves zero formula results', () => {
  const book=fixture(); book.Sheets['Reclamos - Órdenes'].L2={t:'n',f:'1-1',v:0};
  const bytes=write(book,{type:'buffer',bookType:'xlsx'});
  assert.equal(parsePeyaWorkbook(read(bytes,{type:'buffer',sheets:PEYA_SHEETS})).complaints[0].amount,0);
});
test('blank counts mean zero; optional fields and zero amounts are preserved', () => {
  const book=fixture(); delete book.Sheets['Resumen por tienda'].V62; delete book.Sheets['AWT 5'].J3;
  delete book.Sheets['Reclamos - Órdenes'].I2; delete book.Sheets['Reclamos - Órdenes'].G2;
  const result=parsePeyaWorkbook(book); assert.equal(result.daily[0].orders,0); assert.equal(result.daily[0].awt,0); assert.deepEqual(result.complaints[0].fields,{});
});
test('similar store names are excluded', () => {
  const book=fixture();put(book.Sheets['Reclamos - Órdenes'],'C2','KFC - LA PLATA II');
  assert.equal(parsePeyaWorkbook(book).complaints.length,0);
});
test('missing and ambiguous sheets, missing local and mismatched dates fail', () => {
  const missing=fixture();delete missing.Sheets['AWT 5'];assert.throws(()=>parsePeyaWorkbook(missing),/AWT/);
  const alias=fixture();alias.Sheets.AWT5=alias.Sheets['AWT 5'];delete alias.Sheets['AWT 5'];assert.equal(parsePeyaWorkbook(alias).daily.length,7);
  alias.Sheets['AWT 5']=alias.Sheets.AWT5;assert.throws(()=>parsePeyaWorkbook(alias),/única/);
  const absent=fixture();put(absent.Sheets['Resumen por tienda'],'U62','KFC OTRO');assert.throws(()=>parsePeyaWorkbook(absent),/sola fila/);
  const dates=fixture();put(dates.Sheets['AWT 5'],'J2',46281);assert.throws(()=>parsePeyaWorkbook(dates),/no coinciden/);
});
test('invalid values and uncached formulas never silently become zero', () => {
  for (const value of [-1,1.5,'texto']) { const b=fixture();put(b.Sheets['AWT 5'],'J3',value);assert.throws(()=>parsePeyaWorkbook(b),/cantidad inválida/); }
  const formula=fixture();formula.Sheets['Reclamos - Órdenes'].L2={t:'n',f:'1+1'};assert.throws(()=>parsePeyaWorkbook(formula),/resultado/);
  const error=fixture();error.Sheets['Reclamos - Órdenes'].L2={t:'e',v:42};assert.throws(()=>parsePeyaWorkbook(error),/error de Excel/);
  const day=fixture();put(day.Sheets['Reclamos - Órdenes'],'D2','31/02/2026');assert.throws(()=>parsePeyaWorkbook(day),/Fecha inválida/);
  const time=fixture();put(time.Sheets['Reclamos - Órdenes'],'E2','24:99');assert.throws(()=>parsePeyaWorkbook(time),/Hora inválida/);
});
test('date headers drive periods; dates and hours are independent of device timezone', () => {
  const book=fixture();put(book.Sheets['Reclamos - Órdenes'],'D2','17/09/2026');put(book.Sheets['Reclamos - Órdenes'],'E2','00:05');
  assert.equal(parsePeyaWorkbook(book).complaints[0].orderAtIso,'2026-09-17T03:05:00.000Z');
  const dated=fixture();dated.Workbook={WBProps:{date1904:true}};
  for(const s of Object.values(dated.Sheets)) for(const c of Object.values(s)) if(c?.t==='n'&&c.v>=46282&&c.v<=46288)c.v-=1462;
  assert.equal(parsePeyaWorkbook(dated).daily[0].day,'2026-09-17');
});
test('identical duplicates collapse, conflicting details fail with row numbers', () => {
  const book=fixture();const s=book.Sheets['Reclamos - Órdenes'];for(const c of ['B','C','D','E','F','G','H','I','L'])s[c+'4']={...s[c+'2']};
  assert.equal(parsePeyaWorkbook(book).duplicates,1);assert.equal(parsePeyaWorkbook(book).daily[0].complaints,1);
  put(s,'H4','Otro producto');assert.throws(()=>parsePeyaWorkbook(book),/filas 2 y 4/);
});
test('reimport and overlapping periods replace counts without touching other data', () => {
  const initial=emptyStore();initial.targetAwtPct=4;initial.days={'2026-09-17':{pedidosya:{orders:20,complaints:4,awt:1},rappi:{orders:99,complaints:2,awt:0}},'2026-09-01':{pedidosya:{orders:100,complaints:0,awt:0}}};
  const next=mergePeyaMetrics(initial,report());assert.deepEqual(mergePeyaMetrics(next,report()),next);
  assert.equal(next.days['2026-09-17'].rappi.orders,99);assert.equal(next.days['2026-09-01'].pedidosya.orders,100);assert.equal(next.targetAwtPct,4);assert.equal(initial.days['2026-09-17'].pedidosya.orders,20);
});
test('reimport preserves resolutions, evidence and prefixed existing codes', () => {
  const r=report();const prefixed={...r,complaints:r.complaints.map(c=>({...c,orderCode:'PEYA'+c.orderCode}))};
  const initial=mergePeyaHistory(emptyHistory(),prefixed).store;const item=Object.values(initial.items)[0];
  item.status='refutado_aceptado';item.photoId='photo-1';item.photoUrl='https://example.test/photo';
  const next=mergePeyaHistory(initial,r);assert.equal(next.added,0);assert.equal(Object.keys(next.store.items).length,1);
  const after=Object.values(next.store.items)[0];assert.equal(after.status,'refutado_aceptado');assert.equal(after.photoId,'photo-1');assert.equal(after.amount,3780);
});
test('manual corrections and unrelated records survive import', () => {
  const r=report();const initial=mergePeyaHistory(emptyHistory(),r).store;const old=Object.values(initial.items)[0];
  delete initial.items[old.id];const corrected={...old,id:'99999999|2026-09-17',orderCode:'99999999',sourceId:old.id,manualEdit:true,aggregator:'rappi',amount:500,combo:'Corregido'};initial.items[corrected.id]=corrected;
  const next=mergePeyaHistory(initial,r);assert.equal(next.added,0);assert.equal(Object.values(next.store.items)[0].amount,500);assert.equal(Object.values(next.store.items)[0].combo,'Corregido');assert.equal(Object.values(next.store.items)[0].aggregator,'rappi');
});
test('same numeric code on another aggregator is not overwritten', () => {
  const r=report();const initial=mergePeyaHistory(emptyHistory(),r).store;Object.values(initial.items)[0].aggregator='rappi';assert.throws(()=>mergePeyaHistory(initial,r),/otro agregador/);
});
function flowDeps() {
  const state={history:emptyHistory(),metrics:emptyStore(),writes:0};
  return {state,deps:{loadMetrics:async()=>state.metrics,validateHistory:async()=>{},matchPhotos:async()=>[],saveHistory:async(r,rows)=>{state.writes++;const result=mergePeyaHistory(state.history,r,rows);state.history=result.store;return result;},saveMetrics:async next=>{state.writes++;state.metrics=next;return next;}}};
}
test('preview parsing and merging perform no persistence', () => {
  const {state}=flowDeps();mergePeyaHistory(state.history,report());mergePeyaMetrics(state.metrics,report());assert.equal(state.writes,0);assert.deepEqual(state.history,emptyHistory());
});
test('partial failure is explicit and retry does not duplicate history', async () => {
  const {state,deps}=flowDeps();const save=deps.saveMetrics;deps.saveMetrics=async()=>{throw Error('sin red');};
  await assert.rejects(executePeyaImport(report(),deps),e=>e.result.historySaved&&!e.result.metricsSaved&&/Reintentá/.test(e.message));
  assert.equal(Object.keys(state.history.items).length,1);deps.saveMetrics=save;
  const result=await executePeyaImport(report(),deps);assert.equal(result.history.added,0);assert.equal(Object.keys(state.history.items).length,1);assert.equal(state.metrics.days['2026-09-17'].pedidosya.orders,168);
});
test('read or validation failure prevents all writes', async () => {
  for(const key of ['loadMetrics','validateHistory']){const {state,deps}=flowDeps();deps[key]=async()=>{throw Error('falló');};await assert.rejects(executePeyaImport(report(),deps));assert.equal(state.writes,0);}
});
test('photo lookup failure warns without losing import', async () => {
  const {deps}=flowDeps();deps.matchPhotos=async()=>{throw Error('sin red');};const result=await executePeyaImport(report(),deps);assert.ok(result.metricsSaved);assert.match(result.warning,/fotos/);
});

test('legacy bulk edits without manualEdit are preserved', () => {
  const r=report();const initial=mergePeyaHistory(emptyHistory(),r).store;const item=Object.values(initial.items)[0];
  item.amount=123;item.combo='Producto corregido';item.reason='Motivo corregido';item.comment='Nota interna';
  const after=Object.values(mergePeyaHistory(initial,r).store.items)[0];
  assert.equal(after.amount,123);assert.equal(after.combo,'Producto corregido');assert.equal(after.reason,'Motivo corregido');assert.equal(after.comment,'Nota interna');
});
