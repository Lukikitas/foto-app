import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  DEFAULT_REFUTADO_DAYS,
  QUEJA_VENCIDA_STATUS,
  emptyRefutadoDays,
  isRefutadoExpired,
  normalizeRefutadoDays,
  refutadoDeadlineDate,
  refutadoDeadlineDays,
  refutadoDaysLeft,
  refutadoExpiryHint,
  resolveDisplayStatus,
} from './refutadoDeadline.js';

const CONFIG = { default: 7, pedidosya: 5, rappi: 3, rappi_turbo: 3, mercadopago: 10 };

function row({ status = 'queja', day = '2026-09-20', aggregator = 'rappi', orderAtIso = null } = {}) {
  return {
    history: status === 'none' ? null : { status, day, aggregator },
    complaint: { day, orderAtIso, aggregator, orderCode: 'RAPPI-123' },
    photo: null,
  };
}

test('normalizeRefutadoDays aplica defaults y recorta valores inválidos', () => {
  assert.deepEqual(normalizeRefutadoDays(null), emptyRefutadoDays());
  assert.equal(emptyRefutadoDays().default, DEFAULT_REFUTADO_DAYS);
  assert.deepEqual(normalizeRefutadoDays({ default: '9', pedidosya: '45' }), {
    default: 9,
    pedidosya: 45,
    rappi: 9,
    rappi_turbo: 9,
    mercadopago: 9,
  });
  // Fuera de rango → al tope; no numérico → default.
  assert.equal(normalizeRefutadoDays({ default: 999 }).default, 90);
  assert.equal(normalizeRefutadoDays({ default: 0 }).default, 1);
  assert.equal(normalizeRefutadoDays({ default: 'pronto' }).default, DEFAULT_REFUTADO_DAYS);
});

test('refutadoDeadlineDays usa los días del agregador o el general', () => {
  assert.equal(refutadoDeadlineDays(CONFIG, 'pedidosya'), 5);
  assert.equal(refutadoDeadlineDays(CONFIG, 'rappi'), 3);
  assert.equal(refutadoDeadlineDays(CONFIG, 'mercadopago'), 10);
  assert.equal(refutadoDeadlineDays(CONFIG, null), 7);
  assert.equal(refutadoDeadlineDays(CONFIG, 'desconocido'), 7);
  assert.equal(refutadoDeadlineDays(null, 'rappi'), DEFAULT_REFUTADO_DAYS);
});

test('el vencimiento se calcula desde el día del pedido y el límite es inclusivo', () => {
  // Pedido 20/09 con3 días → vence el 23 (inclusive); vencida desde el 24.
  assert.equal(refutadoDeadlineDate('2026-09-20', CONFIG, 'rappi'), '2026-09-23');
  assert.equal(refutadoDaysLeft('2026-09-20', CONFIG, 'rappi', '2026-09-23'), 0);
  assert.equal(isRefutadoExpired('2026-09-20', CONFIG, 'rappi', '2026-09-23'), false);
  assert.equal(isRefutadoExpired('2026-09-20', CONFIG, 'rappi', '2026-09-24'), true);
  assert.equal(refutadoDaysLeft('2026-09-20', CONFIG, 'rappi', '2026-09-25'), -2);
  // Cruzar mes/año: 28/02 + 3 = 03/03.
  assert.equal(refutadoDeadlineDate('2026-02-28', CONFIG, 'rappi'), '2026-03-03');
  // Sin fecha no se vence nunca.
  assert.equal(refutadoDeadlineDate('', CONFIG, 'rappi'), null);
  assert.equal(refutadoDaysLeft('', CONFIG, 'rappi', '2026-09-30'), null);
});

test('resolveDisplayStatus etiqueta «queja_vencida» solo a quejas vencidas', () => {
  assert.equal(
    resolveDisplayStatus(row({ day: '2026-09-20', aggregator: 'rappi' }), CONFIG, '2026-09-23'),
    'queja',
  );
  assert.equal(
    resolveDisplayStatus(row({ day: '2026-09-20', aggregator: 'rappi' }), CONFIG, '2026-09-24'),
    QUEJA_VENCIDA_STATUS,
  );
  // Ya refutadas (cualquier estado) no cambian aunque el plazo haya pasado.
  assert.equal(
    resolveDisplayStatus(row({ status: 'refutado', day: '2026-01-01' }), CONFIG, '2026-09-30'),
    'refutado',
  );
  assert.equal(
    resolveDisplayStatus(
      row({ status: 'refutado_aceptado', day: '2026-01-01' }),
      CONFIG,
      '2026-09-30',
    ),
    'refutado_aceptado',
  );
  // Sin historial ni fecha no se vence.
  assert.equal(resolveDisplayStatus(row({ status: 'none', day: '' }), CONFIG, '2026-09-30'), 'queja');
});

test('refutadoExpiryHint avisa solo los últimos días de la ventana', () => {
  assert.equal(refutadoExpiryHint(row({ day: '2026-09-20', aggregator: 'rappi' }), CONFIG, '2026-09-30'), null);
  assert.equal(
    refutadoExpiryHint(row({ day: '2026-09-20', aggregator: 'rappi' }), CONFIG, '2026-09-21'),
    'Vence en 2 d',
  );
  assert.equal(
    refutadoExpiryHint(row({ day: '2026-09-20', aggregator: 'rappi' }), CONFIG, '2026-09-22'),
    'Vence mañana',
  );
  assert.equal(
    refutadoExpiryHint(row({ day: '2026-09-20', aggregator: 'rappi' }), CONFIG, '2026-09-23'),
    'Vence hoy',
  );
  // Vencida ya lleva su propio tag, no el aviso.
  assert.equal(
    refutadoExpiryHint(row({ day: '2026-09-20', aggregator: 'rappi' }), CONFIG, '2026-09-24'),
    null,
  );
  assert.equal(
    refutadoExpiryHint(row({ status: 'refutado', day: '2026-09-22' }), CONFIG, '2026-09-23'),
    null,
  );
});
