import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {test} from 'node:test';
import {withRequestTimeout} from './requestTimeout.js';
function loader(bindings){
 const source=readFileSync(new URL('./storageUsage.js',import.meta.url),'utf8').replace(/^import[^\n]+\n/gm,'').replace(/^export \{[^\n]+\n/gm,'').replace(/export /g,'');
 return new Function(...Object.keys(bindings),source+'\nreturn loadStorageUsage;')(...Object.values(bindings));
}
test('storage refresh reads the current shared retention and last automatic result',async()=>{
 const retention={retention_days:7,enabled:true,last_removed:42,last_run_at:'2026-10-10T03:00:00Z'};
 let calls;
 const load=loader({withRequestTimeout,supabase:{rpc:(name,args)=>{calls={name,args};return {abortSignal:async()=>({data:{total:{count:1,bytes:100},categories:{},retention,recordsWithoutImage:0,retainedRecords:1}})};}}});
 const data=await load(30);assert.equal(calls.name,'foto_storage_summary');assert.equal(calls.args,undefined);assert.equal(data.retention.last_removed,42);assert.equal(data.retention.retention_days,7);
});
test('storage settings read failure aborts measurement without assuming default protection',async()=>{
 const load=loader({withRequestTimeout,supabase:{rpc:()=>({abortSignal:async()=>({error:{message:'Permiso denegado'}})})}});
 await assert.rejects(load(),/Permiso denegado/);
});
