import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  deleteUnresolvedTicket,
  getUnresolvedTicket,
  hasUnresolvedTicket,
  saveUnresolvedTicket,
} from './unresolvedTicketStore.js';

test('keeps an unresolved ticket until it is corrected or deleted', async () => {
  const ticket = new File(['ticket image'], 'ticket.jpg', { type: 'image/jpeg' });
  await saveUnresolvedTicket('photo-test', ticket);
  assert.equal(await hasUnresolvedTicket('photo-test'), true);
  const restored = await getUnresolvedTicket('photo-test');
  assert.equal(restored.name, 'ticket.jpg');
  assert.equal(await restored.text(), 'ticket image');
  await deleteUnresolvedTicket('photo-test');
  assert.equal(await hasUnresolvedTicket('photo-test'), false);
  assert.equal(await getUnresolvedTicket('photo-test'), null);
});
