import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';
import {
  NATIVE_PROTOCOL_VERSION,
  buildNativeCameraIntentUri,
  clearStoredNativeSession,
  generateCryptoToken,
  getStoredNativeSession,
  getStoredNativeSessions,
  hashTokenSha256,
  isValidSessionId,
  isValidSessionToken,
  parseReturnSessionFromUrl,
  saveStoredNativeSession,
} from './nativeCameraSession.js';

function memoryStorage() {
  const data = new Map();
  return {
    getItem(key) {
      return data.has(key) ? data.get(key) : null;
    },
    setItem(key, value) {
      data.set(String(key), String(value));
    },
    removeItem(key) {
      data.delete(String(key));
    },
  };
}

let previousStorage;

beforeEach(() => {
  previousStorage = globalThis.localStorage;
  globalThis.localStorage = memoryStorage();
});

afterEach(() => {
  globalThis.localStorage = previousStorage;
});

test('session ID and token format validation', () => {
  const validUuid = '123e4567-e89b-12d3-a456-426614174000';
  assert.equal(isValidSessionId(validUuid), true);
  assert.equal(isValidSessionId('invalid-uuid'), false);
  assert.equal(isValidSessionId(''), false);
  assert.equal(isValidSessionId(null), false);

  const token = generateCryptoToken(32);
  assert.equal(token.length, 64);
  assert.equal(isValidSessionToken(token), true);
  assert.equal(isValidSessionToken('short'), false);
  assert.equal(isValidSessionToken(''), false);
});

test('token SHA-256 hash is consistent and accurate', async () => {
  const token = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
  const hash1 = await hashTokenSha256(token);
  const hash2 = await hashTokenSha256(token);
  assert.equal(hash1, hash2);
  assert.equal(hash1.length, 64);
  assert.notEqual(hash1, token);
});

test('buildNativeCameraIntentUri generates compliant explicit intent format', () => {
  const sessionId = '123e4567-e89b-12d3-a456-426614174000';
  const token = generateCryptoToken(32);
  const uri = buildNativeCameraIntentUri({
    sessionId,
    sessionToken: token,
    protocolVersion: NATIVE_PROTOCOL_VERSION,
  });

  assert.match(uri, /^intent:\/\/capture\/123e4567-e89b-12d3-a456-426614174000#Intent;/);
  assert.match(uri, /scheme=fotoapp;/);
  assert.match(uri, /package=ar\.com\.starapp\.fotoappcamera;/);
  assert.match(uri, new RegExp(`S\\.sessionToken=${token};`));
  assert.match(uri, /i\.protocolVersion=1;/);
  assert.match(uri, /S\.browser_fallback_url=https%3A%2F%2Fdelivery\.star-app\.com\.ar%2Finstalar-camara;/);
  assert.match(uri, /end$/);
});

test('buildNativeCameraIntentUri throws on invalid input', () => {
  assert.throws(() => {
    buildNativeCameraIntentUri({
      sessionId: 'bad-id',
      sessionToken: 'bad-token',
    });
  });
});

test('parseReturnSessionFromUrl extracts valid session parameter', () => {
  const validUrl = 'https://delivery.star-app.com.ar/camera-return?session=123e4567-e89b-12d3-a456-426614174000';
  assert.equal(parseReturnSessionFromUrl(validUrl), '123e4567-e89b-12d3-a456-426614174000');

  const invalidUrl = 'https://delivery.star-app.com.ar/camera-return?session=malicious';
  assert.equal(parseReturnSessionFromUrl(invalidUrl), null);

  const noParamUrl = 'https://delivery.star-app.com.ar/camera-return';
  assert.equal(parseReturnSessionFromUrl(noParamUrl), null);
});

test('local native session storage saves, retrieves and clears correctly', () => {
  const sessionId = '123e4567-e89b-12d3-a456-426614174000';
  const sessionToken = generateCryptoToken(32);
  const record = {
    sessionId,
    sessionToken,
    takenBy: 'Lucas',
    protocolVersion: 1,
    createdAt: Date.now(),
  };

  assert.equal(getStoredNativeSession(), null);
  saveStoredNativeSession(record);
  assert.deepEqual(getStoredNativeSession(), record);

  clearStoredNativeSession();
  assert.equal(getStoredNativeSession(), null);
});

test('opening another camera session keeps earlier pending session tokens', async () => {
  const token = generateCryptoToken(32);
  const first = {
    sessionId: '123e4567-e89b-12d3-a456-426614174000',
    sessionToken: token,
    takenBy: 'Pepe',
    createdAt: 1000,
    expiresAt: new Date(60_000).toISOString(),
  };
  const second = {
    ...first,
    sessionId: '223e4567-e89b-12d3-a456-426614174000',
    takenBy: 'Lucas',
    createdAt: 2000,
  };

  saveStoredNativeSession(first);
  saveStoredNativeSession(second);
  assert.deepEqual(getStoredNativeSessions(), [first, second]);
  assert.equal(getStoredNativeSession().sessionId, second.sessionId);

  clearStoredNativeSession(first.sessionId);
  assert.deepEqual(getStoredNativeSessions(), [second]);
});

test('legacy single-session storage remains readable', () => {
  const legacy = {
    sessionId: '123e4567-e89b-12d3-a456-426614174000',
    sessionToken: generateCryptoToken(32),
  };
  localStorage.setItem('foto_app_native_camera_session', JSON.stringify(legacy));
  assert.deepEqual(getStoredNativeSessions(), [legacy]);
});
