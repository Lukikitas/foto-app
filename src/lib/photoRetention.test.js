import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import {
  collectDraftRefs,
  collectHistoryPhotoRefs,
  isRetentionCandidate,
  mergePhotoRefs,
  normalizeRetentionDays,
  PHOTO_RETENTION_DEFAULT_DAYS,
  retentionCutoffIso,
} from './photoRetention.js';

const CUTOFF = '2026-09-18T03:00:00.000Z';

function photo(overrides = {}) {
  return {
    id: 'photo-1',
    file_path: 'orders/pedidosya/4696.jpg',
    name: '4696',
    created_at: '2026-08-01T15:00:00.000-03:00',
    public_url: 'https://cdn.example/orders/pedidosya/4696.jpg',
    has_complaint: false,
    is_refutado: false,
    ...overrides,
  };
}

test('retention days fall back to the default and clamp to 7..365', () => {
  assert.equal(normalizeRetentionDays('14'), 14);
  assert.equal(normalizeRetentionDays(14.6), 15);
  assert.equal(normalizeRetentionDays(''), PHOTO_RETENTION_DEFAULT_DAYS);
  assert.equal(normalizeRetentionDays(null), PHOTO_RETENTION_DEFAULT_DAYS);
  assert.equal(normalizeRetentionDays('recomprar'), PHOTO_RETENTION_DEFAULT_DAYS);
  assert.equal(normalizeRetentionDays(0), 7, 'el mínimo evita borrar todo con un cero mal cargado');
  assert.equal(normalizeRetentionDays(-5), 7);
  assert.equal(normalizeRetentionDays(500), 365);
});

test('retention cutoff moves the date back by the configured days', () => {
  const now = new Date('2026-10-08T03:00:00.000Z');
  assert.equal(retentionCutoffIso(14, now), '2026-09-24T03:00:00.000Z');
  assert.equal(retentionCutoffIso('inválido', now), '2026-09-08T03:00:00.000Z', 'default 30');
});

test('history refs cover photoId, order compact and photo name compact', () => {
  const refs = collectHistoryPhotoRefs([
    { photoId: 'p-1', compact: 'PEYA4696', orderCode: 'PEYA-4696' },
    { orderCode: 'RAPPI-7788' },              // item legacy sin `compact`
    { orderCode: 'OTRO-1', photoName: '4696' },
    null,
    'no-es-un-item',
  ]);
  assert.ok(refs.photoIds.has('p-1'));
  assert.ok(refs.compacts.has('PEYA4696'));
  assert.ok(refs.compacts.has('RAPPI7788'), 'compact calculado del orderCode cuando falta');
  assert.ok(refs.compacts.has('4696'), 'el nombre de foto también protege');
  assert.deepEqual(collectHistoryPhotoRefs(), { photoIds: new Set(), compacts: new Set() });
});

test('an old plain order photo is the only retention candidate', () => {
  assert.equal(isRetentionCandidate(photo(), { cutoffIso: CUTOFF }), true);
});

test('photos inside the retention window are never candidates', () => {
  const young = photo({ created_at: '2026-10-01T15:00:00.000-03:00' });
  assert.equal(isRetentionCandidate(young, { cutoffIso: CUTOFF }), false);
});

test('photos with a complaint or a refutation are protected', () => {
  assert.equal(isRetentionCandidate(photo({ has_complaint: true }), { cutoffIso: CUTOFF }), false);
  assert.equal(isRetentionCandidate(photo({ is_refutado: true }), { cutoffIso: CUTOFF }), false);
});

test('photos referenced by the complaint history are protected', () => {
  const refs = collectHistoryPhotoRefs([{ photoId: 'photo-1' }]);
  assert.equal(isRetentionCandidate(photo(), { cutoffIso: CUTOFF, refs }), false);

  const byCode = collectHistoryPhotoRefs([{ compact: 'PEYA4696' }]);
  assert.equal(
    isRetentionCandidate(photo({ name: 'PEYA-4696' }), { cutoffIso: CUTOFF, refs: byCode }),
    false,
    'una queja con el mismo código protege la foto aunque no tenga photoId',
  );

  const unrelated = collectHistoryPhotoRefs([{ photoId: 'otra' }]);
  assert.equal(isRetentionCandidate(photo(), { cutoffIso: CUTOFF, refs: unrelated }), true);
});

test('photos referenced by the active import draft are protected', () => {
  const draft = {
    data: {
      pickedPhotoIds: { c1: 'photo-1' },
      complaints: [{ orderCode: 'PEYA-4696' }, { orderCode: 'RAPPI-7788' }],
    },
  };
  const refs = mergePhotoRefs(collectHistoryPhotoRefs([]), collectDraftRefs(draft));
  assert.equal(
    isRetentionCandidate(photo(), { cutoffIso: CUTOFF, refs }),
    false,
    'la foto ya elegida en la lista queda protegida',
  );
  assert.equal(
    isRetentionCandidate(photo({ id: 'otra-foto', name: 'PEYA-4696' }), { cutoffIso: CUTOFF, refs }),
    false,
    'el código de un reclamo del draft también protege su foto',
  );
  assert.equal(
    isRetentionCandidate(photo({ id: 'foto-suelta', name: 'OTRO-9' }), { cutoffIso: CUTOFF, refs }),
    true,
    'los demás pedidos siguen siendo candidatos',
  );
  assert.deepEqual(collectDraftRefs(null), { photoIds: new Set(), compacts: new Set() });
});

test('unidentified, unpublished and non-order photos are excluded', () => {
  assert.equal(
    isRetentionCandidate(photo({ name: 'Código no encontrado' }), { cutoffIso: CUTOFF }),
    false,
    'la cola de recuperación de códigos queda intacta',
  );
  assert.equal(
    isRetentionCandidate(photo({ public_url: null }), { cutoffIso: CUTOFF }),
    false,
    'sin URL no hay archivo: ya purgada',
  );
  assert.equal(
    isRetentionCandidate(photo({ file_path: 'files/manuales/notas.png' }), { cutoffIso: CUTOFF }),
    false,
    'solo se limpian pedidos (orders/)',
  );
  assert.equal(isRetentionCandidate(photo({ created_at: null }), { cutoffIso: CUTOFF }), false);
  assert.equal(isRetentionCandidate(null, { cutoffIso: CUTOFF }), false);
  assert.equal(isRetentionCandidate(photo(), {}), false, 'sin corte no se borra nada');
});

test('the edge function embeds an exact copy of the shared retention logic', () => {
  // La función se despliega desde el editor del dashboard de Supabase (sin CLI),
  // que solo empaqueta archivos dentro de su carpeta: index.ts lleva la lógica
  // copiada entre marcadores y este test impide que la copia se desincronice
  // de la fuente que usan la app y el popup de Ajustes.
  const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
  const edge = read('../../supabase/functions/cleanup-photo-retention/index.ts');
  const startToken = '/* RETENTION_SOURCE_START */';
  const endToken = '/* RETENTION_SOURCE_END */';
  const start = edge.indexOf(startToken);
  const end = edge.indexOf(endToken);
  assert.ok(start !== -1 && end > start, 'los marcadores RETENTION_SOURCE deben existir en index.ts');
  const embedded = edge.slice(start + startToken.length, end).trim();

  const retention = read('./photoRetention.js')
    .replace("import { compactCode } from './complaintMatch.js';", '')
    .trim();
  const matchSource = read('./complaintMatch.js');
  const from = matchSource.indexOf('export function compactCode');
  assert.ok(from !== -1, 'compactCode sigue exportado en complaintMatch.js');
  const compact = matchSource.slice(from, matchSource.indexOf('\n}', from) + 2).trim();

  assert.equal(
    embedded,
    `${compact}\n\n${retention}`,
    'la copia incrustada en la función edge debe ser idéntica a photoRetention.js + compactCode',
  );
});
