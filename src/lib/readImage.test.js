import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { readImage, IMAGE_READ_ERROR } from './readImage.js';
const originals = new Map(['createImageBitmap','Image','FileReader'].map(key => [key,Object.getOwnPropertyDescriptor(globalThis,key)]));
const createUrl = URL.createObjectURL;
const revokeUrl = URL.revokeObjectURL;
afterEach(() => {
  for (const [key,descriptor] of originals) { if (descriptor) Object.defineProperty(globalThis,key,descriptor); else delete globalThis[key]; }
  URL.createObjectURL = createUrl; URL.revokeObjectURL = revokeUrl;
});
const sample = () => new File([new Uint8Array([1,2,3])], 'evidencia.jpg', {type:'image/jpeg'});

test('normal decoding closes its bitmap and does not reread all bytes', async () => {
  let closed = false;
  const image = {width:40,height:60,close(){closed=true;}};
  globalThis.createImageBitmap = async () => image;
  const file = sample(); file.arrayBuffer = () => {throw Error('unnecessary copy');};
  const result = await readImage(file);
  assert.equal(result.image,image); assert.equal(result.width,40);
  result.close(); assert.equal(closed,true);
});
test('a saved File whose backing reference fails can decode from a fresh byte copy', async () => {
  const file = sample(); let attempts = 0;
  globalThis.createImageBitmap = async source => {
    attempts++;
    if (source === file) throw Error('An error occurred reading the Blob argument to createImageBitmap');
    assert.deepEqual([...new Uint8Array(await source.arrayBuffer())],[1,2,3]);
    return {width:40,height:60,close(){}};
  };
  const result = await readImage(file);
  assert.equal(attempts,3); assert.equal(result.height,60);
  assert.equal(await file.text(),'\x01\x02\x03');
});
test('when the bitmap decoder fails the page uses its image decoder and releases its URL', async () => {
  globalThis.createImageBitmap = async () => {throw Error('bitmap failure');};
  let revoked;
  URL.createObjectURL = () => 'blob:recovery'; URL.revokeObjectURL = url => {revoked=url;};
  globalThis.Image = class {
    naturalWidth=80;naturalHeight=100;
    set src(value) { if(value) queueMicrotask(()=>this.onload()); }
  };
  const result = await readImage(sample());
  assert.equal(result.width,80); assert.equal(result.height,100);
  assert.equal(revoked,'blob:recovery'); result.close();
});
test('a failed blob URL can be recovered using a data URL', async () => {
  globalThis.createImageBitmap = async () => {throw Error('bitmap failure');};
  globalThis.Image = class {
    naturalWidth=80;naturalHeight=100;
    set src(value) { if(value) queueMicrotask(()=>value.startsWith('data:') ? this.onload() : this.onerror()); }
  };
  globalThis.FileReader = class {readAsDataURL(){this.result='data:image/jpeg;base64,AQID';queueMicrotask(()=>this.onload());}};
  const result = await readImage(sample()); assert.equal(result.width,80); result.close();
});
test('unreadable and empty images fail clearly without replacing the saved file', async () => {
  globalThis.createImageBitmap = async () => {throw Error('Blob unreadable');};
  delete globalThis.Image;
  const file=sample(); file.arrayBuffer=async()=>{throw Error('stored bytes unavailable');};
  await assert.rejects(readImage(file),error=>error.code==='IMAGE_READ_FAILED' && error.message===IMAGE_READ_ERROR);
  await assert.rejects(readImage(new Blob([])),{code:'IMAGE_READ_FAILED'});
  assert.equal(file.size,3);
});
