import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createManagedWorker} from './managedWorker.js';
import {captureWorkPolicy} from './capturePolicy.js';
import {mergeGalleryPhoto} from './galleryMemory.js';
import {queueRecordSummary,releaseQueueFiles,mergeQueueStateWithStoredFiles} from './queueMemory.js';
import {createMemoryQueueStore,serializeQueueRecord,hydrateQueueRecord} from './uploadQueueStore.js';
import {itemNeedsOcr} from './uploadQueueProtocol.js';
import {withTimeout} from './taskTimeout.js';
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
function fakeWorkers(){
  const workers=[];
  const factory=()=>{const worker={messages:[],terminated:false,postMessage(message){this.messages.push(message);},terminate(){this.terminated=true;},reply(result,index=this.messages.length-1){this.onmessage?.({data:{id:this.messages[index].id,result}});}};workers.push(worker);return worker;};
  return {workers,factory};
}
test('workers serialize jobs, use the current callback and ignore stale replies',async()=>{
  const {workers,factory}=fakeWorkers();const client=createManagedWorker(factory);
  try {
    const first=client.run({file:'one'});const second=client.run({file:'two'});await delay(0);
    assert.equal(workers.length,1);assert.equal(workers[0].messages.length,1);
    workers[0].reply('first');assert.equal(await first,'first');await delay(0);
    assert.equal(workers[0].messages.length,2);workers[0].reply('stale',0);workers[0].reply('second');assert.equal(await second,'second');
  }finally{client.dispose();}
});
test('a hung image worker is terminated and the next job gets a fresh worker',async()=>{
  const {workers,factory}=fakeWorkers();const client=createManagedWorker(factory,{timeoutMs:20});
  try {await assert.rejects(client.run({file:'hung'}),{code:'WORKER_TIMEOUT'});assert.equal(workers[0].terminated,true);
    const next=client.run({file:'next'});await delay(0);assert.equal(workers.length,2);workers[1].reply('ok');assert.equal(await next,'ok');
  }finally{client.dispose();}
});
test('aborting an active worker frees it and does not send a queued aborted capture',async()=>{
  const {workers,factory}=fakeWorkers();const client=createManagedWorker(factory);const abort=new AbortController();
  try {const active=client.run({}, {signal:abort.signal});const rejected=assert.rejects(active,{name:'AbortError'});await delay(0);abort.abort();await rejected;assert.equal(workers[0].terminated,true);
    await assert.rejects(client.run({}, {signal:abort.signal}),{name:'AbortError'});assert.equal(workers.length,1);
  }finally{client.dispose();}
});
test('idle workers release their heaps; postMessage errors also terminate the worker',async()=>{
  const {workers,factory}=fakeWorkers();const client=createManagedWorker(factory,{idleMs:10});
  const job=client.run({});await delay(0);workers[0].reply('ok');await job;await delay(25);assert.equal(workers[0].terminated,true);client.dispose();
  const broken=factory();broken.postMessage=()=>{throw new Error('clone failed');};const failing=createManagedWorker(()=>broken);
  await assert.rejects(failing.run({}),/clone failed/);assert.equal(broken.terminated,true);failing.dispose();
});
test('1,000 parked captures retain no binary files and reload exact evidence and ticket bytes',async()=>{
  const store=createMemoryQueueStore();const queue=[];
  for(let i=0;i<1000;i++){
    const item={id:String(i),status:'pending',kind:'order',file:new File([Uint8Array.of(i%256,17)],'evidence-'+i+'.jpg',{type:'image/jpeg'}),ticketFile:new File([Uint8Array.of(5,i%256)],'ticket-'+i+'.jpg',{type:'image/jpeg'}),createdAt:1700000000000+i,meta:{taken_by:'Employee '+i},storagePath:'orders/'+i+'.jpg'};
    await store.put(serializeQueueRecord(item));item.persisted=true;assert.equal(releaseQueueFiles(item),true);queue.push(item);
  }
  assert.equal(queue.filter(item=>item.file||item.ticketFile).length,0);
  const summaries=await store.summaries();assert.equal(summaries.length,1000);assert.ok(summaries.every(row=>!row.file&&!row.ticket));
  for(const summary of summaries){
    const parked=hydrateQueueRecord(summary,{includeFiles:false});assert.equal(itemNeedsOcr(parked),true);
    const state=serializeQueueRecord({...parked,status:'error',error:'offline'});
    await store.put(mergeQueueStateWithStoredFiles(parked,await store.get(parked.id),state));
    const loaded=hydrateQueueRecord(await store.get(parked.id));
    assert.deepEqual(new Uint8Array(await loaded.file.arrayBuffer()),Uint8Array.of(Number(loaded.id)%256,17));
    assert.deepEqual(new Uint8Array(await loaded.ticketFile.arrayBuffer()),Uint8Array.of(5,Number(loaded.id)%256));
    assert.equal(loaded.status,'pending');assert.equal(loaded.error,null);assert.equal(loaded.createdAt,1700000000000+Number(loaded.id));assert.equal(loaded.storagePath,'orders/'+loaded.id+'.jpg');assert.equal(loaded.file.name,'evidence-'+loaded.id+'.jpg');
  }
});
test('unsaved and failed captures keep their only in-memory copies',()=>{
  for(const flags of [{},{persisted:true,localSaveFailed:true},{persisted:true,initialPersistPending:true}]){
    const file=new Blob(['original']);const item={file,ticketFile:file,...flags};assert.equal(releaseQueueFiles(item),false);assert.equal(item.file,file);assert.equal(item.ticketFile,file);
  }
  assert.throws(()=>mergeQueueStateWithStoredFiles({filesUnloaded:true},null,{}),/No se encontró/);
});
test('gallery realtime growth is bounded across 10,000 inserts while retaining selection and updates',()=>{
  let rows=[];const selectedIds=new Set(['0','1']);
  for(let i=0;i<10000;i++)rows=mergeGalleryPhoto(rows,{id:String(i),created_at:String(i).padStart(8,'0')},{limit:100,selectedIds});
  assert.equal(rows.length,100);assert.ok(rows.some(row=>row.id==='0'));assert.ok(rows.some(row=>row.id==='1'));assert.equal(rows[0].id,'9999');
  rows=mergeGalleryPhoto(rows,{id:'9999',created_at:'00009999',title:'edited'},{limit:100,selectedIds});assert.equal(rows.length,100);assert.equal(rows[0].title,'edited');
});
test('burst policy adapts to backlog and low memory without disabling the anti-blur burst',()=>{
  assert.deepEqual(captureWorkPolicy(),{burstFrames:3,useNativeStill:true});
  for(const options of [{pendingTasks:8},{pendingTasks:135},{deviceMemory:2}])assert.deepEqual(captureWorkPolicy(options),{burstFrames:2,useNativeStill:false});
  assert.equal(captureWorkPolicy({deviceMemory:4}).useNativeStill,true);
});
test('timeouts allow fallback without waiting for an unresolved native photo promise',async()=>{
  let cancelled=false;await assert.rejects(withTimeout(new Promise(()=>{}),10,()=>{cancelled=true;}),{code:'WORKER_TIMEOUT'});assert.equal(cancelled,true);
  assert.equal(await withTimeout(Promise.resolve('ready'),100),'ready');
});
test('summary keeps ticket presence and known sizes without retaining either Blob',()=>{
  const row=queueRecordSummary({id:'q',file:new Blob(['abc']),ticket:new Blob(['12345'])});assert.equal(row.hasFile,true);assert.equal(row.hasTicket,true);assert.equal(row.fileSize,3);assert.equal(row.ticketSize,5);assert.equal('file' in row,false);assert.equal('ticket' in row,false);
});
