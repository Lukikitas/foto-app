import assert from 'node:assert/strict';
import { test } from 'node:test';
import { argentinaHour, buildStaffCsv, buildStaffReport, NO_PERSON } from './staffPerformance.js';

const PERIOD_PHOTOS = [
  {
    id: 'p1',
    name: '4696',
    file_path: 'orders/pedidosya/4696.jpg',
    created_at: '2026-09-01T13:05:00-03:00',
    taken_by: 'Sofi',
  },
  {
    id: 'p2',
    name: 'PEYA-2286878556',
    file_path: 'orders/pedidosya/peya.jpg',
    created_at: '2026-09-01T21:40:00-03:00',
    taken_by: '  sofi ',
  },
  {
    id: 'p3',
    name: 'Remito proveedores',
    file_path: 'files/remito.jpg',
    created_at: '2026-09-01T13:10:00-03:00',
    taken_by: 'Ana',
  },
  {
    id: 'p4',
    name: '4698',
    file_path: 'orders/rappi/4698.jpg',
    created_at: '2026-09-01T15:00:00-03:00',
    taken_by: '',
  },
];

const HISTORY_ITEMS = [
  {
    compact: '4696',
    orderCode: '4696',
    photoId: 'p1',
    timeOfDay: '13:05',
    amount: 1000,
    status: 'refutado_aceptado',
    day: '2026-09-01',
  },
  {
    compact: 'PEYA2286878556',
    orderCode: 'PEYA-2286878556',
    photoId: null,
    photoName: null,
    timeOfDay: '21:40',
    amount: 500,
    status: 'queja',
    day: '2026-09-01',
  },
  {
    compact: '999999',
    orderCode: '999999',
    photoId: null,
    timeOfDay: null,
    orderAtIso: null,
    amount: 200,
    status: 'refutado_rechazado',
    day: '2026-09-01',
  },
];

test('staff report groups photos and complaints per person with normalized names', () => {
  const report = buildStaffReport({ photos: PERIOD_PHOTOS, historyItems: HISTORY_ITEMS });
  const sofia = report.people.find((row) => row.key === 'sofi');
  const ana = report.people.find((row) => row.key === 'ana');
  const unassigned = report.people.find((row) => row.isUnassigned);

  assert.ok(sofia, 'Sofi and " sofi " must merge into one person');
  assert.equal(sofia.name, 'Sofi');
  assert.equal(sofia.photos, 2);
  assert.equal(sofia.orders, 2);
  assert.equal(sofia.complaints, 2);
  assert.equal(sofia.complaintAmount, 1500);
  assert.equal(sofia.recoveredAmount, 1000);
  assert.ok(Math.abs(sofia.photoSharePct - 50) < 0.01);
  assert.equal(sofia.complaintPct, 100);

  assert.ok(ana);
  assert.equal(ana.photos, 1);
  assert.equal(ana.orders, 0);
  assert.equal(ana.complaints, 0);
  assert.equal(ana.complaintPct, null);

  assert.ok(unassigned);
  assert.equal(unassigned.name, NO_PERSON);
  assert.equal(unassigned.complaints, 1);
  assert.equal(unassigned.recoveredAmount, 0);
});

test('staff report totals aggregate photos, complaints and rates', () => {
  const report = buildStaffReport({ photos: PERIOD_PHOTOS, historyItems: HISTORY_ITEMS });
  assert.equal(report.totals.photos, 4);
  assert.equal(report.totals.orders, 3);
  assert.equal(report.totals.complaints, 3);
  assert.equal(report.totals.people, 2);
  assert.equal(report.totals.unassignedComplaints, 1);
  assert.equal(report.totals.complaintAmount, 1700);
  assert.equal(report.totals.recoveredAmount, 1000);
  assert.ok(Math.abs(report.totals.complaintPct - 100) < 0.01);
});

test('staff report separates accepted refutations from unrefutable complaints per person', () => {
  const photos = [
    {
      id: 'p1',
      name: '4696',
      file_path: 'orders/pedidosya/4696.jpg',
      created_at: '2026-09-01T13:05:00-03:00',
      taken_by: 'Sofi',
    },
    {
      id: 'p2',
      name: '4698',
      file_path: 'orders/rappi/4698.jpg',
      created_at: '2026-09-01T15:00:00-03:00',
      taken_by: 'Ana',
    },
  ];
  const historyItems = [
    {
      compact: '4696',
      orderCode: '4696',
      photoId: 'p1',
      timeOfDay: '13:05',
      amount: 1000,
      status: 'refutado_aceptado',
      day: '2026-09-01',
    },
    {
      compact: '4698',
      orderCode: '4698',
      photoId: 'p2',
      timeOfDay: '15:00',
      amount: 2000,
      status: 'no_refutable',
      unrefutableReason: 'Queja real',
      day: '2026-09-01',
    },
  ];
  const report = buildStaffReport({ photos, historyItems });
  const sofia = report.people.find((row) => row.key === 'sofi');
  const ana = report.people.find((row) => row.key === 'ana');

  assert.equal(sofia.refutadoAceptado, 1, 'Ref. aceptado cuenta como queja falsa');
  assert.equal(sofia.noRefutable, 0);
  assert.equal(ana.noRefutable, 1, 'No refutable es la pérdida que importa');
  assert.equal(ana.refutadoAceptado, 0);
  assert.equal(report.totals.refutadoAceptado, 1);
  assert.equal(report.totals.noRefutable, 1);

  const csv = buildStaffCsv(report);
  assert.match(csv, /refutadas_aceptadas,no_refutables/);
});

test('hourly distribution buckets orders and complaints in Argentina time with a sin-hora row', () => {
  const report = buildStaffReport({ photos: PERIOD_PHOTOS, historyItems: HISTORY_ITEMS });
  const byHour = new Map(report.hourly.map((row) => [row.hour, row]));

  assert.equal(byHour.get(13).orders, 1);
  assert.equal(byHour.get(13).complaints, 1);
  assert.equal(byHour.get(15).orders, 1);
  assert.equal(byHour.get(21).orders, 1);
  assert.equal(byHour.get(21).complaints, 1);
  assert.equal(byHour.get(null).complaints, 1);

  const hour13 = byHour.get(13);
  assert.ok(Math.abs(hour13.ordersPct - 100 / 3) < 0.01);
  assert.ok(Math.abs(hour13.complaintsPct - 33.33) < 0.01);
  assert.equal(hour13.ratePct, 100);

  const ordersTotal = report.hourly.reduce((sum, row) => sum + (row.ordersPct || 0), 0);
  assert.ok(Math.abs(ordersTotal - 100) < 0.01);
});

test('argentinaHour converts ISO instants to Argentina hours', () => {
  assert.equal(argentinaHour('2026-09-01T16:05:00Z'), 13);
  assert.equal(argentinaHour('2026-09-01T13:05:00-03:00'), 13);
  assert.equal(argentinaHour(null), null);
  assert.equal(argentinaHour('not-a-date'), null);
});

test('staff report attributes a complaint whose photo lives outside the fetched window', () => {
  // La foto PEYA no está en `photos` (fuera de la ventana) pero llega como extra.
  const report = buildStaffReport({
    photos: [{
      id: 'p1',
      name: '4696',
      file_path: 'orders/pedidosya/4696.jpg',
      created_at: '2026-09-01T13:05:00-03:00',
      taken_by: 'Sofi',
    }],
    extraPhotos: [{
      id: 'p9',
      name: 'PEYA-2286878556',
      file_path: 'orders/pedidosya/peya.jpg',
      created_at: '2026-08-30T21:40:00-03:00',
      taken_by: 'Lu',
    }],
    historyItems: HISTORY_ITEMS,
  });
  const lu = report.people.find((row) => row.key === 'lu');
  const unassigned = report.people.find((row) => row.isUnassigned);
  assert.ok(lu, 'la foto de fuera del período debe atribuir la queja');
  assert.equal(lu.complaints, 1);
  assert.equal(unassigned.complaints, 1, 'solo la queja sin foto queda sin asignar');
});

test('staff report matches photos ignoring aggregator prefix differences', () => {
  const report = buildStaffReport({
    photos: [{ id: 'px', name: '4696', file_path: 'orders/rappi/4696.jpg', created_at: '2026-09-01T15:00:00-03:00', taken_by: 'Ana' }],
    historyItems: [{
      compact: 'RAPPI4696',
      orderCode: 'RAPPI-4696',
      photoId: null,
      photoName: null,
      timeOfDay: null,
      amount: 100,
      status: 'queja',
      day: '2026-09-01',
    }],
  });
  const ana = report.people.find((row) => row.key === 'ana');
  assert.ok(ana, 'el código numérico debe matchear aunque el reclamo tenga prefijo');
  assert.equal(ana.complaints, 1);
});

test('staff report never attributes a photo of a different aggregator', () => {
  const report = buildStaffReport({
    photos: [{ id: 'px', name: 'PEYA-4696', file_path: 'orders/pedidosya/4696.jpg', created_at: '2026-09-01T15:00:00-03:00', taken_by: 'Ana' }],
    historyItems: [{
      compact: 'RAPPI4696',
      orderCode: 'RAPPI-4696',
      photoId: null,
      photoName: null,
      timeOfDay: null,
      amount: 100,
      status: 'queja',
      day: '2026-09-01',
    }],
  });
  const unassigned = report.people.find((row) => row.isUnassigned);
  assert.ok(unassigned, 'PEYA-4696 no puede atribuir una queja de RAPPI-4696');
  assert.equal(unassigned.complaints, 1);
});

test('staff report tolerates empty input without NaN', () => {
  const report = buildStaffReport();
  assert.deepEqual(report.people, []);
  assert.deepEqual(report.hourly, []);
  assert.equal(report.totals.photos, 0);
  assert.equal(report.totals.complaintPct, null);
  assert.equal(report.complaintsWithoutHour, 0);
});

test('staff CSV includes people and hourly sections with headers', () => {
  const report = buildStaffReport({ photos: PERIOD_PHOTOS, historyItems: HISTORY_ITEMS });
  const csv = buildStaffCsv(report);
  const lines = csv.trim().split('\n');
  assert.equal(lines[0], 'persona,fotos,pedidos,porcentaje_fotos,quejas,porcentaje_quejas,refutadas_aceptadas,no_refutables,monto_quejas,monto_recuperado');
  assert.ok(lines.some((line) => line.startsWith('Sofi,')));
  assert.ok(lines.some((line) => line.startsWith('Sin asignar,')));
  assert.ok(lines.includes('hora,pedidos,porcentaje_pedidos,quejas,porcentaje_quejas,porcentaje_quejas_sobre_pedidos'));
  assert.ok(lines.some((line) => line.startsWith('13:00,')));
  assert.ok(lines.some((line) => line.startsWith('Sin hora,')));
});
