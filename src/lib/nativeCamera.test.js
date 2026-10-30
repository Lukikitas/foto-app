import test from 'node:test';
import assert from 'node:assert/strict';
import { nativeCameraLinks, usesNativeCamera, NATIVE_CAMERA_PACKAGE } from './nativeCamera.js';

test('Android capture opens only our package and supplies the same-origin download fallback', () => {
  for (const origin of ['https://delivery.star-app.com.ar', 'http://localhost:5173', 'http://10.0.2.2:5173']) {
    const links = nativeCameraLinks(origin);
    assert.equal(links.download, `${origin}/manual/piloto-android/`);
    assert.equal(links.open, `intent://capture#Intent;scheme=deliverystar;package=${NATIVE_CAMERA_PACKAGE};S.browser_fallback_url=${encodeURIComponent(links.download)};end`);
    assert.equal(decodeURIComponent(links.open.split('S.browser_fallback_url=')[1].split(';')[0]), links.download);
    assert.ok(!links.open.includes('taken_by') && !links.open.includes('token'));
  }
  assert.throws(() => nativeCameraLinks('javascript:alert(1)'), TypeError);
});

test('native handoff is Android only and can be rolled back without changing stored captures', () => {
  const android = 'Mozilla/5.0 (Linux; Android 16; 2311DRK48G) AppleWebKit/537.36 Chrome/141.0 Mobile';
  assert.equal(usesNativeCamera(android), true);
  assert.equal(usesNativeCamera(android, 'false'), false);
  assert.equal(usesNativeCamera(android, 'true'), true);
  assert.equal(usesNativeCamera('Mozilla/5.0 (Linux; Android 7.1.2; Mobile)'), false);
  assert.equal(usesNativeCamera('Mozilla/5.0 (Linux; Android 8.0; Mobile)'), true);
  for (const ua of ['', 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)']) {
    assert.equal(usesNativeCamera(ua), false);
  }
});
