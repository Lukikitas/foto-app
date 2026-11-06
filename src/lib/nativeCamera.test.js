import test from 'node:test';
import assert from 'node:assert/strict';
import { nativeCameraLinks, normalizeCameraAuthor, usesNativeCamera, NATIVE_CAMERA_PACKAGE, DEMO_CAMERA_PACKAGE } from './nativeCamera.js';

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

test('demo handoff pins the separate demo APK and its local download page', () => {
  for (const origin of ['https://demo.example.com', 'http://localhost:4174']) {
    const links = nativeCameraLinks(origin, { demo: true });
    assert.equal(links.download, `${origin}/demo/camara/`);
    assert.equal(links.open, `intent://capture#Intent;scheme=deliverystar;package=${DEMO_CAMERA_PACKAGE};S.browser_fallback_url=${encodeURIComponent(links.download)};end`);
    assert.ok(!links.open.includes('/manual/piloto-android/'));
  }
});

test('photographer passes as one encoded Intent extra without changing the route or fallback', () => {
  for (const author of ['  María   López  ', 'Ana;S.browser_fallback_url=https://other.example/#Intent;end']) {
    const links = nativeCameraLinks('https://delivery.star-app.com.ar', { demo: true, author });
    const extra = links.open.split(';').find(part => part.startsWith('S.capture_author='));
    assert.equal(decodeURIComponent(extra.slice('S.capture_author='.length)), normalizeCameraAuthor(author));
    assert.equal(links.open.split(';').filter(part => part.startsWith('S.browser_fallback_url=')).length, 1);
    assert.equal(links.download, 'https://delivery.star-app.com.ar/demo/camara/');
    assert.ok(links.open.startsWith('intent://capture#Intent;scheme=deliverystar;package=app.deliverystar.capture.demo;'));
  }
  assert.equal(normalizeCameraAuthor('  María\n\tLópez\u0000  '), 'María López');
  assert.equal(normalizeCameraAuthor('A'.repeat(120)).length, 80);
  assert.ok(!nativeCameraLinks('https://delivery.star-app.com.ar', { author: '  ' }).open.includes('capture_author'));
});
