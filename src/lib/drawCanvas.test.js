import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createDrawCanvas } from './drawCanvas.js';

test('createDrawCanvas uses a DOM canvas when document exists', () => {
  const originalDocument = globalThis.document;
  const created = [];
  globalThis.document = {
    createElement(tag) {
      const canvas = { tag, width: 0, height: 0 };
      created.push(canvas);
      return canvas;
    },
  };

  try {
    const canvas = createDrawCanvas(12, 8);
    assert.equal(canvas.tag, 'canvas');
    assert.equal(canvas.width, 12);
    assert.equal(canvas.height, 8);
    assert.equal(created.length, 1);
  } finally {
    globalThis.document = originalDocument;
  }
});

test('createDrawCanvas falls back to OffscreenCanvas without document', () => {
  const originalDocument = globalThis.document;
  const originalOffscreen = globalThis.OffscreenCanvas;
  delete globalThis.document;
  globalThis.OffscreenCanvas = class {
    constructor(width, height) {
      this.width = width;
      this.height = height;
      this.kind = 'offscreen';
    }
  };

  try {
    const canvas = createDrawCanvas(4, 6);
    assert.equal(canvas.kind, 'offscreen');
    assert.equal(canvas.width, 4);
    assert.equal(canvas.height, 6);
  } finally {
    globalThis.document = originalDocument;
    globalThis.OffscreenCanvas = originalOffscreen;
  }
});
