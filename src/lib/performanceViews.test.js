import assert from 'node:assert/strict';
import { test } from 'node:test';
import { performanceView } from './performanceViews.js';
import { emptyStore, summarizeRange, previousPeriod, resolveAvailablePeriod } from './metrics.js';
import { groupHistoryFlags, parseHistory } from './complaintHistory.js';
import { buildMetricsQuality } from './metricsQuality.js';
import { buildDailyPending } from './dailyPending.js';
import { buildStaffReport } from './staffPerformance.js';
import { createActivityCoordinator } from './activity.js';
import { createByteCache } from './byteCache.js';
import { enablePerformanceMetrics, recordPerformance, performanceSamples } from './performanceMetrics.js';
import { sharpenImageData, sharpenImageDataCooperatively } from './compressImage.js';
import { withRequestTimeout } from './requestTimeout.js';
import { buildComplaintReport, buildRegistryCsv } from './complaintReport.js';

const metrics = { ...emptyStore(), days: { '2026-10-02': { pedidosya: { orders: 100, complaints: 6, awt: 9 } }, '2026-10-09': { pedidosya: { orders: 100, complaints: 6, awt: 9 } } } };
const history = parseHistory({ items: Object.fromEntries(Array.from({ length: 1000 }, (_, index) => [String(index), {
  id: String(index), orderCode: `PEYA${10000+index}`, day: index % 2 ? '2026-10-09' : '2026-10-02', aggregator: index % 4 ? 'pedidosya' : null,
  status: ['queja','refutado','refutado_aceptado','refutado_rechazado','no_refutable'][index % 5], amount: index % 7 ? index : null,
}])) });
const range = { from: '2026-10-05', to: '2026-10-11' };
test('server overview preserves totals, money, missing amounts, quality and period comparisons without returning history rows', () => {
  const result = performanceView({ view:'overview', metrics, history, ...range, aggregator:'all', preset:'week' });
  assert.equal(Object.keys(result.history.items).length,0);
  const previous = previousPeriod(range.from,range.to,'week');
  for (const window of [range,previous]) {
    const flags = groupHistoryFlags(history,window.from,window.to,{ refutadoDays:metrics.refutadoDays });
    assert.deepEqual(summarizeRange(result.metrics,{},window.from,window.to,groupHistoryFlags(result.history,window.from,window.to)),summarizeRange(metrics,{},window.from,window.to,flags));
    assert.deepEqual(buildMetricsQuality(result.metrics,result.history,window,'all'),buildMetricsQuality(metrics,history,window,'all'));
  }
  assert.deepEqual(resolveAvailablePeriod('week',result.metrics,'2026-10-23'),resolveAvailablePeriod('week',metrics,'2026-10-23'));
});
test('staff and pending server models use the original attribution and pending rules', () => {
  const staff=performanceView({view:'staff',metrics,history,...range,photos:[],extraPhotos:[]});
  assert.deepEqual(staff.staff,buildStaffReport({photos:[],historyItems:Object.values(staff.history.items),extraPhotos:[],aliases:{}}));
  const result=performanceView({view:'pending',metrics,history,...range,today:'2026-10-23'});
  const expected=buildDailyPending({metrics,history,...range,today:'2026-10-23'});
  assert.deepEqual(result.report.days,expected.days);
  assert.deepEqual(result.report.totals,expected.totals);
  assert.deepEqual(result.report.outsideTotals,expected.outsideTotals);
  assert.equal(result.report.outside.length,expected.outside.length);
});
test('server reports keep all export rows while omitting repeated detail arrays from aggregates',()=>{
  const result=performanceView({view:'report',metrics,history,...range});
  const expected=buildComplaintReport(history,{...range,metrics});
  assert.deepEqual(result.report.totals,expected.totals);
  assert.equal(buildRegistryCsv(result.report.items),buildRegistryCsv(expected.items));
  assert.equal(result.report.items.length,500);
  assert.equal(result.report.days.some(row=>row.items),false);
});
test('camera activity postpones work, renews its quiet interval and releases it on close', async () => {
  let clock=0; let tick;
  const gate=createActivityCoordinator({ now:()=>clock, schedule:callback=>{tick=callback;return 1;}, cancel:()=>{} });
  gate.setCamera(true);
  let started=false;
  const waiting=gate.wait().then(()=>{started=true;});
  clock=2000;gate.touch();clock=3001;tick();await Promise.resolve();assert.equal(started,false);
  clock=5001;tick();await waiting;assert.equal(started,true);
  gate.touch();const resume=gate.wait();gate.setCamera(false);await resume;
  const abort=new AbortController();gate.setCamera(true);const stopped=gate.wait(abort.signal);abort.abort();await assert.rejects(stopped,{name:'AbortError'});gate.setCamera(false);
});
test('image cache is bounded by bytes, refreshes recency and never retains oversized blobs', () => {
  const cache=createByteCache(10);
  cache.set('a',new Blob(['1234']));cache.set('b',new Blob(['5678']));cache.get('a');cache.set('c',new Blob(['abcd']));
  assert.equal(cache.has('a'),true);assert.equal(cache.has('b'),false);assert.equal(cache.bytes,8);
  cache.set('huge',new Blob(['01234567890123']));assert.equal(cache.has('huge'),false);assert.equal(cache.bytes,8);
});
test('performance diagnostics are opt-in, bounded and omit personal information', () => {
  enablePerformanceMetrics(true);
  for(let n=0;n<250;n++)recordPerformance('test',n,{bytes:12,orderCode:'private',url:'private',taken_by:'private'});
  assert.equal(performanceSamples().length,200);
  assert.equal(JSON.stringify(performanceSamples()).includes('private'),false);
  enablePerformanceMetrics(false);const count=performanceSamples().length;recordPerformance('ignored',1);assert.equal(performanceSamples().length,count);
});
test('cooperative image preparation yields between blocks without changing evidence pixels',async()=>{
  const image={width:64,height:130,data:Uint8ClampedArray.from({length:64*130*4},(_,index)=>(index*17)%256)};
  const sync=sharpenImageData(structuredClone(image));
  let yields=0;
  const result=await sharpenImageDataCooperatively(structuredClone(image),async()=>{yields++;});
  assert.ok(yields>=4);assert.deepEqual(result,sync);
});
test('a hung read aborts the request and releases loading; navigation cancellation is distinct',async()=>{
  let aborted=false;
  await assert.rejects(withRequestTimeout(signal=>{signal.addEventListener('abort',()=>{aborted=true;});return new Promise(()=>{});},{timeoutMs:5}),{code:'REQUEST_TIMEOUT'});
  assert.equal(aborted,true);
  const controller=new AbortController();
  const pending=withRequestTimeout(()=>new Promise(()=>{}),{signal:controller.signal});
  controller.abort();await assert.rejects(pending,{name:'AbortError'});
});
