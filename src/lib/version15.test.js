import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyHistory } from './complaintHistory.js';
import { emptyStore } from './metrics.js';
import { mergePeyaHistory } from './peyaWorkbook.js';
import { mergeRappiHistory } from './rappiWorkbook.js';
import { mergeDraft, mergeDraftMetrics, validateDraft } from './complaintDraft.js';
import { documentChanges, applyDocumentChanges } from './documentChanges.js';
import { clampOffset, zoomAt, pinchDistance } from './touchZoom.js';
import { cameraZoomRange, snapCameraZoom, rearCameras, wideCamera } from './cameraControls.js';

const complaint = (overrides = {}) => ({ id:'PEYA123456|2026-09-17',orderCode:'PEYA123456',day:'2026-09-17',
  aggregator:'pedidosya',reason:'Faltante',comment:'Detalle',combo:'Combo',amount:100,fields:{Local:'La Plata'},...overrides });

for (const [name, merge, base] of [
  ['PedidosYa',mergePeyaHistory,complaint()],
  ['Rappi',mergeRappiHistory,complaint({ id:'RAPPI123456|2026-09-17',orderCode:'RAPPI123456',aggregator:'rappi' })],
]) {
  test(name + ': reimport updates amounts including zero, keeps missing details and status', () => {
    let store=merge(emptyHistory(),{complaints:[base]}).store;
    const item=Object.values(store.items)[0];item.status='refutado_aceptado';item.photoId='photo';
    for (const amount of [200,50,0]) {
      store=merge(store,{complaints:[{...base,amount,reason:'Nuevo',comment:'Actualizado'}]}).store;
      const next=Object.values(store.items)[0];
      assert.equal(next.amount,amount);assert.equal(next.reason,'Nuevo');assert.equal(next.comment,'Actualizado');
      assert.equal(next.status,'refutado_aceptado');assert.equal(next.photoId,'photo');assert.equal(Object.keys(store.items).length,1);
    }
    store=merge(store,{complaints:[{...base,amount:null,reason:'',comment:'',combo:'',fields:{Local:''}}]}).store;
    const next=Object.values(store.items)[0];assert.equal(next.amount,0);assert.equal(next.reason,'Nuevo');assert.equal(next.comment,'Actualizado');assert.equal(next.combo,'Combo');assert.equal(next.fields.Local,'La Plata');
  });
}
test('draft preparation is pure and preserves original daily counts when rows are excluded',()=>{
  const before=emptyHistory();const draft={source:'peya',complaints:[complaint()],report:{daily:[{day:'2026-09-17',orders:100,complaints:10,awt:2}]}};
  const merged=mergeDraft(before,draft);
  assert.equal(merged.added,1);assert.deepEqual(before,emptyHistory());
  assert.equal(mergeDraftMetrics(emptyStore(),draft).days['2026-09-17'].pedidosya.complaints,10);
  assert.equal(mergeDraft(merged.store,draft).added,0);
});
test('draft preserves existing photo unless an explicit replacement was chosen',()=>{
  const c=complaint();const store=mergePeyaHistory(emptyHistory(),{complaints:[c]}).store;
  store.items[c.id].photoId='original';
  const row={complaint:c,photo:{id:'candidate',name:c.orderCode,public_url:'test'}};
  assert.equal(mergeDraft(store,{complaints:[c]},[row]).store.items[c.id].photoId,'original');
  assert.equal(mergeDraft(store,{complaints:[c],pickedPhotoIds:{[c.id]:'candidate'}},[row]).store.items[c.id].photoId,'candidate');
});
test('draft rejects duplicates, missing identity and invalid amounts',()=>{
  assert.throws(()=>validateDraft([complaint(),complaint()]),/duplicadas/);
  assert.throws(()=>validateDraft([complaint({day:'',id:'x'})]),/fecha/);
  assert.throws(()=>validateDraft([complaint({amount:-1})]),/monto/);
});
test('field-level document edits preserve another device and reject conflicting edits',()=>{
  const before={days:{a:{orders:1,complaints:2}}};
  const changes=documentChanges(before,{days:{a:{orders:3,complaints:2}}});
  assert.deepEqual(applyDocumentChanges({days:{a:{orders:1,complaints:4}}},changes),{days:{a:{orders:3,complaints:4}}});
  assert.throws(()=>applyDocumentChanges({days:{a:{orders:5,complaints:2}}},changes),/Otro dispositivo/);
  assert.deepEqual(applyDocumentChanges({days:{a:{orders:3,complaints:2}}},changes),{days:{a:{orders:3,complaints:2}}});
});
test('pinch geometry, focal anchor and image bounds',()=>{
  assert.equal(pinchDistance(new Map([[1,{x:0,y:0}],[2,{x:3,y:4}]])),5);
  assert.deepEqual(zoomAt({x:0,y:0},1,2,{x:20,y:10}),{x:-20,y:-10});
  assert.deepEqual(clampOffset({x:500,y:-500},2,{width:200,height:100},{width:300,height:300}),{x:50,y:0});
});
test('camera honors a minimum below 1 and identifies wide lenses without index guessing',()=>{
  const range=cameraZoomRange({getCapabilities:()=>({zoom:{min:0.5,max:10,step:0.1}})});
  assert.equal(range.min,0.5);assert.equal(range.max,4);assert.equal(snapCameraZoom(0.1,range),0.5);
  const devices=[{kind:'videoinput',deviceId:'f',label:'Front'},{kind:'videoinput',deviceId:'n',label:'Back'},{kind:'videoinput',deviceId:'w',label:'Ultra Wide'}];
  assert.equal(rearCameras(devices,'n').length,2);assert.equal(wideCamera(devices).deviceId,'w');
  assert.equal(wideCamera([{label:'Camera 1'},{label:'Camera 2'}]),undefined);
});
