import assert from 'node:assert/strict';
import {test} from 'node:test';
import {checkpointUploadQueue,canRetireMissingItem} from './uploadQueueSafety.js';
const record=(id='one')=>({id,status:'error',createdAt:123,storagePath:'orders/no_code/'+id+'.jpg',file:new Blob(['photo']),ticket:new Blob(['ticket'])});
function store(){const data=new Map();return {data,put:async row=>data.set(row.id,structuredClone(row)),list:async()=>[...data.values()]};}
test('all captures and tickets are read back before allowing an update, including errors',async()=>{
  const db=store();const items=[record(),record('two')];
  assert.deepEqual(await checkpointUploadQueue(items,db),{count:2});
  assert.equal(db.data.size,2);assert.equal(items[0].status,'error');
  assert.equal(await db.data.get('one').file.text(),'photo');
});
test('quota failure blocks updating and leaves the original capture available',async()=>{
  const item=record();const photo=item.file;let attempts=0;
  await assert.rejects(checkpointUploadQueue([item],{put:async()=>{attempts++;throw new DOMException('Full','QuotaExceededError');},list:async()=>[]}),/No se actualizó/);
  assert.equal(attempts,1);assert.equal(item.file,photo);assert.equal(await item.file.text(),'photo');
});
test('a reported successful write without a stored record blocks updating',async()=>{
  await assert.rejects(checkpointUploadQueue([record()],{put:async()=>{},list:async()=>[]}),/Falta una foto pendiente/);
});
test('same-sized corruption and unreadable ticket bytes both block updating',async()=>{
  const item=record();const db=store();
  db.list=async()=>[{...item,file:new Blob(['wrong'])}];
  await assert.rejects(checkpointUploadQueue([item],db),/no coincide/);
  db.list=async()=>[{...item,ticket:{size:item.ticket.size,arrayBuffer:async()=>{throw Error('Blob unavailable');}}}];
  await assert.rejects(checkpointUploadQueue([item],db),/no permite leer/);
});
test('missing tickets, empty photos and failed reads never permit reload',async()=>{
  const item=record();
  await assert.rejects(checkpointUploadQueue([item],{put:async()=>{},list:async()=>[{...item,ticket:null}]}),/ticket completo/);
  await assert.rejects(checkpointUploadQueue([{...item,file:new Blob([])}],store()),/foto completo/);
  await assert.rejects(checkpointUploadQueue([item],{put:async()=>{},list:async()=>{throw Error('storage failed');}}),/No se pudo comprobar/);
});
test('memory-only and currently saving items must not be treated as uploaded when missing from storage',()=>{
  assert.equal(canRetireMissingItem({localSaveFailed:true}),false);
  assert.equal(canRetireMissingItem({initialPersistPending:true}),false);
  assert.equal(canRetireMissingItem({initialPersistPending:false,localSaveFailed:false}),true);
});
