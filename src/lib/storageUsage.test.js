import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {test} from 'node:test';
import {storageSelection} from './storageAccounting.js';
function loader(bindings){
 const source=readFileSync(new URL('./storageUsage.js',import.meta.url),'utf8').replace(/^import[^\n]+\n/gm,'').replace(/^export \{[^\n]+\n/gm,'').replace(/export /g,'');
 return new Function(...Object.keys(bindings),source+'\nreturn loadStorageUsage;')(...Object.values(bindings));
}
test('storage refresh reads the current shared retention and last automatic result',async()=>{
 const retention={retention_days:7,enabled:true,last_removed:42,last_run_at:'2026-10-10T03:00:00Z'};
 const created_at=new Date(Date.now()-15*24*3600*1000).toISOString();
 let calls;
 const load=loader({storageSelection,PHOTO_GALLERY_KINDS:{orders:'orders'},fetchPhotos:async()=>[{id:1,name:'PEYA12345',file_path:'orders/a.jpg',public_url:'url',created_at}],loadCleanupRefs:async()=>null,loadPhotoCleanupSettings:async()=>retention,supabase:{rpc:async(name,args)=>{calls={name,args};return {data:{total:{count:1,bytes:100},categories:{}}};}}});
 const data=await load(30);assert.deepEqual(calls.args.eligible_paths,['orders/a.jpg']);assert.equal(data.retention.last_removed,42);assert.equal(data.retention.retention_days,7);
});
test('storage settings read failure aborts measurement without assuming default protection',async()=>{
 let measured=false;const load=loader({storageSelection,PHOTO_GALLERY_KINDS:{orders:'orders'},fetchPhotos:async()=>[],loadCleanupRefs:async()=>null,loadPhotoCleanupSettings:async()=>{throw Error('Permiso denegado');},supabase:{rpc:async()=>{measured=true;}}});
 await assert.rejects(load(),/Permiso denegado/);assert.equal(measured,false);
});
