import test from 'node:test';
import assert from 'node:assert/strict';
import { availableCameras, cameraDiagnostic, wideCamera } from './cameraControls.js';

test('recognizes localized ultrawide labels without guessing generic lens IDs', () => {
  for (const label of ['Cámara trasera ultra gran angular', 'Ultra gran angular trasera', 'Back Ultra Wide Camera', 'Ultra-wide', 'Caméra ultra grand-angle', 'Câmera ultra angular', 'Trasera 0,5x']) {
    assert.equal(wideCamera([{deviceId:'wide',label}])?.deviceId, 'wide', label);
  }
  for (const label of ['camera2 0, facing back', 'Camera 3', 'Back Wide Camera', 'Telephoto', 'Macro']) assert.equal(wideCamera([{label}]), undefined, label);
});
test('picker retains unnamed and front cameras and restores an omitted active camera', () => {
  const devices = availableCameras([
    {kind:'videoinput',deviceId:'front',label:'Front'},
    {kind:'videoinput',deviceId:'unknown',label:''},
    {kind:'videoinput',deviceId:'unknown',label:''},
    {kind:'audioinput',deviceId:'mic',label:'Microphone'},
  ], {deviceId:'active',label:'Back'});
  assert.deepEqual(devices.map(d=>d.deviceId), ['front','unknown','active']);
});
test('camera report distinguishes native zoom and excludes device identifiers', () => {
  const diagnostic = cameraDiagnostic({devices:[{deviceId:'private-device-id',label:'Back'}],deviceId:'private-device-id',range:{min:1,max:4,step:0.1},userAgent:'Test Browser',standalone:true});
  assert.equal(diagnostic.includes('private-device-id'), false);
  const report=JSON.parse(diagnostic);
  assert.equal(report.installed,true);assert.equal(report.cameras[0].active,true);assert.equal(report.nativeZoom.min,1);
  assert.equal(JSON.parse(cameraDiagnostic({devices:[],range:null})).nativeZoom,null);
});
