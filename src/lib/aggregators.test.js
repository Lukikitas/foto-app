import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  assignComplaintsAggregator,
  getComplaintAggregator,
  getPhotoAggregator,
  openPartnerPortal,
  resetPartnerPortalWindows,
} from './aggregators.js';

test('assignComplaintsAggregator stamps a known partner on every row', () => {
  const stamped = assignComplaintsAggregator(
    [{ orderCode: '2093192289' }, { orderCode: 'PEYA-1', aggregator: 'pedidosya' }],
    'rappi',
  );
  assert.equal(stamped[0].aggregator, 'rappi');
  assert.equal(stamped[1].aggregator, 'rappi');
  assert.equal(getComplaintAggregator(stamped[0]), 'rappi');
  assert.equal(getComplaintAggregator(stamped[1]), 'rappi');
});

test('assignComplaintsAggregator leaves rows alone when no partner is chosen', () => {
  const list = [{ orderCode: 'PEYA-1' }];
  assert.equal(assignComplaintsAggregator(list, ''), list);
  assert.equal(assignComplaintsAggregator(list, 'unknown'), list);
  assert.equal(getComplaintAggregator(list[0]), 'pedidosya');
});

test('corrected no-code photos show their aggregator without moving the stored image', () => {
  assert.equal(getPhotoAggregator({ file_path: 'orders/no_code/photo.jpg', name: 'MPD48024738630' }), 'mercadopago');
  assert.equal(getPhotoAggregator({ file_path: 'orders/no_code/photo.jpg', name: 'Código no encontrado' }), null);
  assert.equal(getPhotoAggregator({ file_path: 'files/photo.jpg', name: 'MPD48024738630' }), null);
});

function fakeWindow() {
  return {
    closed: false,
    focused: 0,
    focus() {
      this.focused += 1;
    },
  };
}

test('opens the partner portal only when that window is closed', () => {
  const opened = [];
  const first = fakeWindow();
  const second = fakeWindow();
  globalThis.window = {
    open(url, name) {
      opened.push({ url, name });
      return opened.length === 1 ? first : second;
    },
  };
  resetPartnerPortalWindows();

  const portal = openPartnerPortal('pedidosya');
  assert.equal(portal.url, 'https://portal-app.pedidosya.com/orders');
  assert.equal(portal.opened, true);
  assert.equal(opened.length, 1);
  assert.equal(opened[0].name, 'foto-app-portal-pedidosya');

  const again = openPartnerPortal('pedidosya');
  assert.equal(again.opened, false);
  assert.equal(opened.length, 1);
  assert.equal(first.focused, 1);

  first.closed = true;
  const reopened = openPartnerPortal('pedidosya');
  assert.equal(reopened.opened, true);
  assert.equal(opened.length, 2);
});

test('Rappi and Rappi Turbo share the same portal window', () => {
  const opened = [];
  globalThis.window = {
    open(url, name) {
      opened.push({ url, name });
      return fakeWindow();
    },
  };
  resetPartnerPortalWindows();
  openPartnerPortal('rappi');
  openPartnerPortal('rappi_turbo');
  assert.equal(opened.length, 1);
  assert.equal(opened[0].url, 'https://partners.rappi.com');
});
