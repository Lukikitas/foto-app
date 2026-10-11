import assert from 'node:assert/strict';
import {test} from 'node:test';
import {emptyStore,upsertDayStats,summarizeRange,previousPeriod,normalizePhotographerAliases,isIsoDate,formatKnownMoney} from './metrics.js';
import {emptyHistoryFlags,addMoneyToFlags} from './complaintHistory.js';
import {buildMetricsQuality,validateMetricFields} from './metricsQuality.js';
import {representativeOrders,orderIdentity} from './orderIdentity.js';
import {buildStaffReport} from './staffPerformance.js';
import {storageSelection,formatBytes} from './storageAccounting.js';
import {collectHistoryPhotoRefs} from './photoRetention.js';
import {parseMetricList} from './metricList.js';
import {buildComplaintReport,buildReportWorkbook,buildRegistryWorkbook} from './complaintReport.js';
import {generateReportHtml} from './pdfReportGenerator.js';

const date='2026-10-10';
function photo(id,time,author='Ana',agg='pedidosya',name='PEYA12345') {return {id,name,aggregator:agg,file_path:'orders/'+agg+'/'+id,created_at:'2026-10-10T'+time+'-03:00',taken_by:author,public_url:'https://example.test/'+id};}
test('AWT Todos uses only PedidosYa and explicit zeros remain loaded',()=>{
 let s=upsertDayStats(emptyStore(),date,'pedidosya',{orders:100,complaints:4,awt:20,reported:{orders:true,complaints:true,awt:true}});
 s=upsertDayStats(s,date,'rappi',{orders:100,complaints:2,awt:0,reported:{orders:true,complaints:true}});
 s=upsertDayStats(s,'2026-10-09','pedidosya',{orders:0,complaints:0,awt:0,reported:{orders:true,complaints:true,awt:true}});
 assert.ok(s.days['2026-10-09'].pedidosya);
 const report=summarizeRange(s,{},date,date);assert.equal(report.overall.awtPct,20);assert.equal(report.daily[0].awtPct,20);assert.equal(report.overall.complaintPct,3);
 assert.equal(buildMetricsQuality(s,{items:{}},{from:'2026-10-09',to:'2026-10-09'},'pedidosya').rows[0].state,'complete');
});
test('quality separates legacy, missing fields, explicit zero and source discrepancies',()=>{
 const s=emptyStore();s.days[date]={pedidosya:{orders:30,complaints:0,awt:0},rappi:{orders:0,complaints:0,awt:0,reported:{orders:false,complaints:false,awt:false}}};
 const q=buildMetricsQuality(s,{items:{}},{from:date,to:date});
 assert.equal(q.legacy,1);assert.equal(q.partial,1);assert.equal(q.missing,2);assert.equal(q.rows.find(r=>r.aggregator==='rappi').reported,null);assert.equal(q.discrepancies.length,0);
 s.days[date].rappi={orders:20,complaints:0,awt:0,reported:{orders:true,complaints:false,awt:false}};assert.equal(summarizeRange(s,{},date,date).aggregators.find(row=>row.id==='rappi').complaintPct,null);
});
test('money splits all statuses and expiry without rewriting source states',()=>{
 const flags=emptyHistoryFlags();
 const rows=[['refutado_aceptado',100,date],['refutado',200,date],['queja',300,date],['queja',400,'2026-09-01'],['refutado_rechazado',500,date],['no_refutable',600,date],['queja',null,date]];
 for(const [status,amount,day]of rows)addMoneyToFlags(flags,{status,amount,day,aggregator:'pedidosya'},{refutadoDays:{default:7},today:date});
 assert.equal(flags.recoveredAmount,100);assert.equal(flags.inProgressAmount,200);assert.equal(flags.pendingAmount,300);assert.equal(flags.finalLostAmount,1500);assert.equal(flags.lostAmount,1800);assert.equal(flags.missingAmountCount,1);assert.equal(rows[3][0],'queja');assert.equal(flags.missingMoney.pendingAmount,1);assert.equal(formatKnownMoney(0,1),'Sin montos conocidos');
 const noLimit=emptyHistoryFlags();addMoneyToFlags(noLimit,{status:'queja',day:'2026-01-01',amount:12},{refutadoDays:{default:0},today:date});assert.equal(noLimit.pendingAmount,12);
});
test('second chronological capture represents order; ties use ID; removed images keep attribution',()=>{
 const photos=[photo('c','13:00:00','C'),photo('b','12:00:00','B'),photo('a','11:00:00','A'),photo('z','12:00:00','R','rappi','RAPPI12345')];
 const reps=representativeOrders(photos);assert.deepEqual(reps.representatives.map(p=>p.id).sort(),['b','z']);
 const items=[{id:'claim',photoId:'a',orderCode:'PEYA12345',day:date,aggregator:'pedidosya',status:'refutado_aceptado',amount:4}];
 const r=buildStaffReport({photos,historyItems:items});const b=r.people.find(p=>p.name==='B');assert.equal(b.orders,1);assert.equal(b.photos,1);assert.equal(b.complaints,1);assert.equal(b.complaintPct,100);assert.equal(b.adjustedComplaintPct,0);
 assert.deepEqual(buildStaffReport({photos:photos.map(p=>({...p,public_url:null})),historyItems:items}),r);
 assert.equal(representativeOrders([photo('b','12:00:00'),photo('a','12:00:00')]).representatives[0].id,'b');
 assert.notEqual(orderIdentity(photo('x','12:00:00','A','pedidosya','Código no encontrado')),orderIdentity(photo('y','12:00:00','A','pedidosya','Código no encontrado')));
});
test('same code on another day is not guessed; explicit reference is preserved',()=>{
 const p=photo('a','12:00:00');const item={id:'x',orderCode:p.name,day:'2026-10-09',aggregator:'pedidosya',status:'queja'};
 assert.equal(buildStaffReport({photos:[p],historyItems:[item]}).totals.unassignedComplaints,1);
 assert.equal(buildStaffReport({photos:[],extraPhotos:[p],historyItems:[{...item,photoId:'a'}]}).totals.unassignedComplaints,0);
});
test('period comparison shifts week and clamps previous-month elapsed span',()=>{
 assert.deepEqual(previousPeriod('2026-10-05',date,'week'),{from:'2026-09-28',to:'2026-10-03'});
 assert.deepEqual(previousPeriod('2026-03-01','2026-03-31','month'),{from:'2026-02-01',to:'2026-02-28'});
 assert.equal(isIsoDate('2026-02-30'),false);
 assert.ok(validateMetricFields(date,{pedidosya:{orders:10,complaints:11,awt:1}},date));
 assert.ok(validateMetricFields(date,{pedidosya:{orders:1.2,complaints:0,awt:0}},date));
 assert.equal(validateMetricFields(date,{pedidosya:{orders:0,complaints:0,awt:0}},date),'');
 assert.equal(parseMetricList('2026-10-10 10 1.5 0',{today:date}).errors.length,1);
 assert.equal(parseMetricList('2026-10-10\t10\t\t0',{today:date}).errors.length,1);
});
test('aliases preserve originals and flatten confirmed variants',()=>{
 const aliases=normalizePhotographerAliases({'fla':'Flavia','flavia':'Flavia G'});assert.equal(aliases.fla,'Flavia G');
 const photos=[photo('x','12:00:00','Fla')];const r=buildStaffReport({photos,aliases});assert.equal(r.people[0].name,'Flavia G');assert.equal(photos[0].taken_by,'Fla');
 assert.deepEqual(normalizePhotographerAliases({a:'B',b:'A'}),{});
});
test('storage counts all rows beyond gallery limit, unique paths and protected references',()=>{
 const photos=Array.from({length:1205},(_,i)=>({...photo(String(i),'12:00:00'),created_at:'2026-08-01T12:00:00Z'}));
 photos[0].has_complaint=true;photos[1].public_url=null;photos[3].file_path=photos[2].file_path;
 const selected=storageSelection(photos,collectHistoryPhotoRefs([{photoId:'4'}]),30,new Date('2026-10-10T12:00:00Z'));
 assert.equal(selected.recordsWithoutImage,1);assert.equal(selected.retainedRecords,1204);assert.equal(selected.protectedPaths.length,2);assert.equal(selected.eligiblePaths.length,1201);
 photos[5].file_path=photos[0].file_path;assert.equal(storageSelection(photos,collectHistoryPhotoRefs([{photoId:'4'}]),30,new Date('2026-10-10T12:00:00Z')).eligiblePaths.includes(photos[0].file_path),false);
 assert.equal(formatBytes(1024),'1 KB');assert.equal(formatBytes(-1),'No disponible');
});
test('exports preserve missing amounts and include warnings, definitions and filters',()=>{
 const history={items:{x:{id:'x',orderCode:'PEYA12345',compact:'PEYA12345',day:date,aggregator:'pedidosya',amount:null,status:'queja',reason:'missing item'}}};
 const report=buildComplaintReport(history,{from:date,to:date,metrics:emptyStore(),today:date});
 assert.ok(report.warnings.length);assert.equal(report.totals.missingAmountCount,1);assert.equal(report.reasons[0].key,'Producto faltante');
 const workbook=buildReportWorkbook(report);assert.equal(workbook.sheets[5].rows[1].cells[7].value,'Sin monto');
 const html=generateReportHtml(report,{includeDetail:true});assert.ok(html.includes('Sin monto'));assert.ok(html.includes('Pérdida confirmada'));assert.ok(html.includes(report.warnings[0]));
 const registry=buildRegistryWorkbook(Object.values(history.items),{Desde:date,Hasta:date,Estado:'queja'});assert.equal(registry.sheets[1].name,'Contexto');assert.ok(JSON.stringify(registry.sheets[1]).includes('1 casos sin monto'));
});
