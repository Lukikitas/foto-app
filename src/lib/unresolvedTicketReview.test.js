import assert from 'node:assert/strict';
import { test } from 'node:test';
import { suggestUnresolvedOrderCode } from './unresolvedTicketReview.js';

test('review uses the local ticket when its code is readable', async () => {
  const ticket = new File(['ticket'], 'ticket.jpg', { type: 'image/jpeg' });
  const code = await suggestUnresolvedOrderCode({ id: 'photo-1', public_url: 'unused' }, {
    getTicket: async () => ticket,
    detect: async (file) => {
      assert.equal(file, ticket);
      return { displayCode: 'PEYA2299229072' };
    },
    fetchPhoto: async () => { throw new Error('Evidence should not be fetched'); },
  });
  assert.equal(code, 'PEYA2299229072');
});

test('review reads saved evidence when the original ticket is unavailable', async () => {
  const code = await suggestUnresolvedOrderCode({ id: 'photo-2', public_url: 'https://example.test/evidence.jpg' }, {
    getTicket: async () => null,
    fetchPhoto: async () => ({
      ok: true,
      blob: async () => new Blob(['evidence'], { type: 'image/jpeg' }),
    }),
    detect: async (file, options) => {
      assert.equal(file.name, 'evidencia.jpg');
      assert.equal(options.evidence, true);
      return { displayCode: 'RAPPI481440437' };
    },
  });
  assert.equal(code, 'RAPPI481440437');
});

test('review falls back to evidence when the local ticket has no readable code', async () => {
  const sources = [];
  const code = await suggestUnresolvedOrderCode({ id: 'photo-3', public_url: 'https://example.test/evidence.jpg' }, {
    getTicket: async () => new File(['ticket'], 'ticket.jpg', { type: 'image/jpeg' }),
    fetchPhoto: async () => ({
      ok: true,
      blob: async () => new Blob(['evidence'], { type: 'image/jpeg' }),
    }),
    detect: async (file, options) => {
      sources.push(options?.evidence ? 'evidence' : 'ticket');
      return options?.evidence ? { displayCode: 'PEYA2299229072' } : null;
    },
  });
  assert.deepEqual(sources, ['ticket', 'evidence']);
  assert.equal(code, 'PEYA2299229072');
});
