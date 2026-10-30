import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createServer} from 'vite';
const tick=()=>new Promise(resolve=>setTimeout(resolve,0));
test('page queue parks 135 captures, loads one pair at a time and restores failures after restart',async(t)=>{
  t.mock.method(console,'error',()=>{});
  const server=await createServer({configFile:false,envDir:false,define:{'import.meta.env.VITE_SUPABASE_URL':JSON.stringify('https://example.supabase.co'),'import.meta.env.VITE_SUPABASE_ANON_KEY':JSON.stringify('test-only'),'import.meta.env.VITE_CLOUD_OCR_ENABLED':JSON.stringify('false')},server:{middlewareMode:true,hmr:false,watch:null},appType:'custom'});
  const originalDocument=globalThis.document;
  let queue;
  try {
    const storeModule=await server.ssrLoadModule('/src/lib/uploadQueueStore.js');
    queue=await server.ssrLoadModule('/src/lib/uploadQueue.js');
    const store=storeModule.createMemoryQueueStore();let reads=0;
    storeModule.useQueueStoreForTests({...store,get:async id=>{reads++;return store.get(id);}});
    globalThis.document={visibilityState:'hidden'};
    let processed=0;
    const processor=async item=>{processed++;assert.ok(item.file);assert.ok(item.ticketFile);assert.equal(new Uint8Array(await item.file.arrayBuffer())[0],processed-1);throw new Error('network offline');};
    queue.resetUploadQueueForTests({processor});
    for(let i=0;i<135;i++)await queue.enqueue({file:new File([Uint8Array.of(i)],'photo.jpg',{type:'image/jpeg'}),ticketFile:new File(['ticket'],'ticket.jpg',{type:'image/jpeg'}),meta:{taken_by:'team'}});
    assert.equal(reads,0);assert.equal((await store.summaries()).length,135);
    globalThis.document.visibilityState='visible';await queue.handleQueueVisibilityChange();
    for(let i=0;i<2000&&processed<135;i++)await tick();
    assert.equal(processed,135);assert.equal(reads,135);assert.equal((await store.list()).length,135);
    // Error persistence normally belongs to the real processor. Simulate its record,
    // then restart the page and verify the same IDs and original bytes remain.
    for(const row of await store.list())await store.put({...row,status:'error',error:'archivo inválido'});
    queue.resetUploadQueueForTests({processor});const restored=await queue.restorePersistedQueue();
    assert.equal(restored.length,135);assert.ok(restored.every(item=>item.status==='error'));
    for(const row of await store.list())assert.equal(row.file.size,1);
  }finally{
    globalThis.document=originalDocument;queue?.resetUploadQueueForTests();await server.close();
  }
});

test('offline captures are durable and wait for connection before processing',async()=>{
  const server=await createServer({configFile:false,envDir:false,define:{'import.meta.env.VITE_SUPABASE_URL':JSON.stringify('https://example.supabase.co'),'import.meta.env.VITE_SUPABASE_ANON_KEY':JSON.stringify('test-only'),'import.meta.env.VITE_CLOUD_OCR_ENABLED':JSON.stringify('false')},server:{middlewareMode:true,hmr:false,watch:null},appType:'custom'});
  const originalNavigator=Object.getOwnPropertyDescriptor(globalThis,'navigator');
  const originalDocument=globalThis.document;
  let queue;
  try {
    const storeModule=await server.ssrLoadModule('/src/lib/uploadQueueStore.js');
    queue=await server.ssrLoadModule('/src/lib/uploadQueue.js');
    const store=storeModule.createMemoryQueueStore();storeModule.useQueueStoreForTests(store);
    Object.defineProperty(globalThis,'navigator',{configurable:true,value:{onLine:false}});
    globalThis.document={visibilityState:'visible'};
    let processed=0;
    queue.resetUploadQueueForTests({processor:async(item,{persist})=>{
      processed++;assert.equal(await item.file.text(),'evidence');assert.equal(await item.ticketFile.text(),'ticket');
      item.status='done';await persist(item);return {};
    }});
    await queue.enqueue({file:new File(['evidence'],'photo.jpg',{type:'image/jpeg'}),ticketFile:new File(['ticket'],'ticket.jpg',{type:'image/jpeg'})});
    await tick();assert.equal(processed,0);assert.equal((await store.list()).length,1);
    navigator.onLine=true;queue.handleQueueVisibilityChange();
    for(let n=0;n<100&&processed===0;n++)await tick();
    assert.equal(processed,1);
  } finally {
    if(originalNavigator)Object.defineProperty(globalThis,'navigator',originalNavigator);else delete globalThis.navigator;
    globalThis.document=originalDocument;queue?.resetUploadQueueForTests();await server.close();
  }
});
