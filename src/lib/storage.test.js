import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';
import {
  getCameraFlash,
  getLastTakenBy,
  getTakenByHistory,
  saveCameraFlash,
  saveLastTakenBy,
} from './storage.js';

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

test('saveLastTakenBy remembers the name and puts it first in history', () => {
  saveLastTakenBy('Lucas');
  saveLastTakenBy('María');
  saveLastTakenBy('Lucas');

  assert.equal(getLastTakenBy(), 'Lucas');
  assert.deepEqual(getTakenByHistory(), ['Lucas', 'María']);
});

test('getTakenByHistory includes the last name even without a stored list', () => {
  globalThis.localStorage.setItem('foto-app-taken-by', 'Sofi');
  assert.deepEqual(getTakenByHistory(), ['Sofi']);
});

test('camera flash preference persists', () => {
  assert.equal(getCameraFlash(), false);
  saveCameraFlash(true);
  assert.equal(getCameraFlash(), true);
  saveCameraFlash(false);
  assert.equal(getCameraFlash(), false);
});
