import test from 'node:test';
import assert from 'node:assert/strict';
import { parseRappiWorkbook, mergeRappiMetrics, mergeRappiHistory } from './rappiWorkbook.js';
import { emptyHistory, complaintDay, complaintHistoryId, parseHistory, historyItemToRow, editHistoryItemInStore, listHistoryItems, groupHistoryFlags } from './complaintHistory.js';
import { emptyStore } from './metrics.js';
import { matchComplaintsToPhotos } from './complaintMatch.js';
import { executePeyaImport } from './peyaImportFlow.js';
import { beginWorkbookImport } from './workbookImportEvents.js';
function cell(sheet, address, value) { sheet[address] = { t: typeof value === 'number' ? 'n' : 's', v: value }; }
function fixture() {
  const s = { '!ref': 'A1:O14' };
  for (const [col,v] of Object.entries({B:'ORDEN ID',C:'TIENDA ID',D:'TIENDA',E:'FECHA',F:'MOTIVO',J:'DETALLE DEL MOTIVO',M:'COMPENSACIÓN AL CLIENTE PAGADA POR EL RESTAURANTE',N:'COMENTARIOS'})) cell(s,col+'8',v);
  for (const [a,v] of Object.entries({B5:'Fecha inicio',C5:'01/09/2026',E5:'Fecha fin',F5:'03/09/2026',B9:'478947179',D9:' KFC – La Plata ',E9:'02/09/2026',F9:'Producto Faltante',J9:'Bolsa cerrada',M9:'$4,800',N9:'Faltó una papa',L9:'$999,999'})) cell(s,a,v);
  cell(s,'D10','KFC OTRO LOCAL');cell(s,'B10','123456789');
  return { Sheets:{'Reclamos - Órdenes':s} };
}
const report = (account='rappi') => parseRappiWorkbook(fixture(),account);
test('Rappi account is mandatory and other aggregators are rejected',()=>{
  for(const account of ['',undefined,'pedidosya']) assert.throws(()=>parseRappiWorkbook(fixture(),account),/Elegí/);
});
test('maps only relevant columns, filters store, keeps detail and comment separate',()=>{
  const r=report();const c=r.complaints[0];assert.equal(r.excluded,1);assert.equal(c.orderCode,'RAPPI478947179');assert.equal(c.day,'2026-09-02');assert.equal(c.orderAtIso,null);assert.equal(c.timeOfDay,null);assert.equal(c.amount,4800);assert.equal(c.reason,'Producto Faltante');assert.equal(c.comment,'Faltó una papa');assert.equal(c.fields['Detalle del motivo'],'Bolsa cerrada');assert.equal(c.combo,'');assert.deepEqual(r.daily.map(d=>d.complaints),[0,1,0]);
});
test('currency symbol and explicit zero are zero, international and Argentine formats work',()=>{
  for(const [raw,amount] of [['$',0],['$0',0],['$24,032.81',24032.81],['$24.032,81',24032.81],['',null]]){const b=fixture();cell(b.Sheets['Reclamos - Órdenes'],'M9',raw);assert.equal(parseRappiWorkbook(b,'rappi').complaints[0].amount,amount);}
});
test('ignored columns cannot override fields or block import',()=>{
  const b=fixture();for(const col of ['C','G','H','I','K','L'])b.Sheets['Reclamos - Órdenes'][col+'9']={t:'e',v:42};assert.equal(parseRappiWorkbook(b,'rappi').complaints[0].amount,4800);
});
test('invalid dates, amounts, schema, missing local and wrong periods fail before writes',()=>{
  for(const [address,v] of [['E9','31/02/2026'],['E9','04/09/2026'],['M9','dinero'],['D9','KFC - LA PLATA II'],['M8','Importe de Rappi'],['F5','01/08/2026']]){const b=fixture();cell(b.Sheets['Reclamos - Órdenes'],address,v);assert.throws(()=>parseRappiWorkbook(b,'rappi'));}
  assert.throws(()=>parseRappiWorkbook({Sheets:{}},'rappi'),/Falta/);
});
test('Excel serial dates preserve calendar day without inventing time',()=>{
  const b=fixture();cell(b.Sheets['Reclamos - Órdenes'],'E9',46267);const c=parseRappiWorkbook(b,'rappi').complaints[0];assert.equal(c.day,'2026-09-02');assert.equal(c.orderAtIso,null);
});
test('identical duplicates collapse; conflicting duplicates report rows',()=>{
  const b=fixture();const s=b.Sheets['Reclamos - Órdenes'];for(const col of ['B','D','E','F','J','M','N'])s[col+'11']={...s[col+'9']};assert.equal(parseRappiWorkbook(b,'rappi').duplicates,1);cell(s,'N11','Otro comentario');assert.throws(()=>parseRappiWorkbook(b,'rappi'),/filas 9 y 11/);
});
test('same order number is independent for Rappi and Turbo, including reimports',()=>{
  let s=mergeRappiHistory(emptyHistory(),report()).store;s=mergeRappiHistory(s,report('rappi_turbo')).store;assert.equal(Object.keys(s.items).length,2);assert.equal(mergeRappiHistory(s,report()).added,0);assert.equal(mergeRappiHistory(s,report('rappi_turbo')).added,0);assert.deepEqual(Object.values(s.items).map(i=>i.aggregator).sort(),['rappi','rappi_turbo']);
});
test('date-only records survive persistence, filters, edits, resolution IDs and reports',()=>{
  const s=mergeRappiHistory(emptyHistory(),report()).store;const item=Object.values(parseHistory(JSON.parse(JSON.stringify(s))).items)[0];assert.equal(complaintDay(item),'2026-09-02');assert.equal(complaintHistoryId(item),item.id);assert.equal(historyItemToRow(item,[]).complaint.day,item.day);assert.equal(listHistoryItems(s,{from:'2026-09-02',to:'2026-09-02'}).length,1);assert.equal(groupHistoryFlags(s,'2026-09-01','2026-09-03')['2026-09-02'].rappi.queja,1);
  const edited=editHistoryItemInStore(s,item.id,{orderCode:'RAPPI999999999',aggregator:'rappi'});assert.ok(edited.items['RAPPI999999999|2026-09-02']);assert.equal(mergeRappiHistory(edited,report()).added,0);
});
test('existing numeric Rappi codes are reused without touching Turbo or manual details',()=>{
  const s=emptyHistory();const c={...report().complaints[0],orderCode:'478947179',id:'478947179|2026-09-02',status:'refutado_aceptado',photoId:'evidence',amount:800,comment:'Corregido'};s.items[c.id]=c;const next=mergeRappiHistory(s,report());assert.equal(next.added,0);const i=Object.values(next.store.items)[0];assert.equal(i.photoId,'evidence');assert.equal(i.amount,800);assert.equal(i.comment,'Corregido');assert.equal(i.status,'refutado_aceptado');
});
test('daily complaint import preserves all orders, AWT, other accounts and outside days',()=>{
  const s=emptyStore();s.days={'2026-09-02':{rappi:{orders:50,awt:3,complaints:9},rappi_turbo:{orders:88,awt:0,complaints:7},pedidosya:{orders:100,awt:10,complaints:5}},'2026-08-31':{rappi:{orders:20,awt:0,complaints:2}}};
  const next=mergeRappiMetrics(s,report());assert.deepEqual(next.days['2026-09-02'].rappi,{orders:50,awt:3,complaints:1});assert.deepEqual(next.days['2026-09-02'].rappi_turbo,s.days['2026-09-02'].rappi_turbo);assert.deepEqual(next.days['2026-09-02'].pedidosya,s.days['2026-09-02'].pedidosya);assert.deepEqual(next.days['2026-08-31'],s.days['2026-08-31']);assert.deepEqual(mergeRappiMetrics(next,report()),next);assert.equal(s.days['2026-09-02'].rappi.complaints,9);
});
test('photo matching respects selected account and does not require an hour',()=>{
  const c=report().complaints[0];const photos=[{id:'turbo',name:'RAPPITURBO478947179',file_path:'orders/rappi_turbo/test.jpg',created_at:'2026-09-02T15:00:00Z'},{id:'normal',name:'RAPPI478947179',file_path:'orders/rappi/test.jpg',created_at:'2026-09-02T23:00:00Z'}];assert.equal(matchComplaintsToPhotos([c],photos)[0].photo.id,'normal');assert.equal(matchComplaintsToPhotos([c],[photos[0]])[0].photo,null);
});
test('Rappi partial save retries without duplicates and leaves total orders unchanged',async()=>{
  let history=emptyHistory();let metrics=emptyStore();metrics.days={'2026-09-02':{rappi:{orders:77,complaints:0,awt:0}}};let fail=true;const deps={loadMetrics:async()=>metrics,validateHistory:async()=>{},matchPhotos:async()=>[],saveHistory:async r=>{const saved=mergeRappiHistory(history,r);history=saved.store;return saved;},mergeMetrics:mergeRappiMetrics,saveMetrics:async next=>{if(fail)throw Error('sin red');metrics=next;return next;}};await assert.rejects(executePeyaImport(report(),deps),e=>e.result.historySaved&&!e.result.metricsSaved);fail=false;const r=await executePeyaImport(report(),deps);assert.equal(r.history.added,0);assert.equal(Object.keys(history.items).length,1);assert.equal(metrics.days['2026-09-02'].rappi.orders,77);
});
test('only one workbook can be persisted at a time across importers',()=>{const release=beginWorkbookImport();assert.throws(()=>beginWorkbookImport(),/en curso/);release();beginWorkbookImport()();});
