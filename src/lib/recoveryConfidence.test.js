import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateScheduledReadings } from './recoveryConfidence.js';

test('automatic confirmation requires two agreeing labeled sources', () => {
  const one = { source: 'ticket', code: 'PEYA1234567890', aggregator: 'pedidosya', reliable: true };
  assert.equal(evaluateScheduledReadings([one]).highConfidence, false);
  assert.equal(evaluateScheduledReadings([one, { ...one, source: 'evidence' }]).highConfidence, true);
  assert.equal(evaluateScheduledReadings([one, { ...one, source: 'evidence', reliable: false }]).highConfidence, false);
});

test('conflicting sources remain a manual proposal', () => {
  const result = evaluateScheduledReadings([
    { source: 'ticket', code: 'RAPPI123456789', aggregator: 'rappi', reliable: true },
    { source: 'evidence', code: 'RAPPI123456788', aggregator: 'rappi', reliable: true },
  ]);
  assert.equal(result.highConfidence, false);
  assert.equal(result.conflict, true);
  assert.equal(result.code, 'RAPPI123456789');
});
