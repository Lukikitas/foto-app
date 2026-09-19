import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  applyManualCruzarToSync,
  argentinaDateTimeParts,
  dailyImportDecision,
  dailyImportStatusMessage,
  emptyComplaintSync,
  hasDailyImportForToday,
  isAfterDailyImportCutoff,
  msUntilDailyImportCutoff,
  nextDailyImportAt,
  parseComplaintSync,
} from './complaintSync.js';

const beforeCutoff = new Date('2026-09-19T13:29:00.000-03:00');
const atCutoff = new Date('2026-09-19T13:30:00.000-03:00');
const afterCutoff = new Date('2026-09-19T16:05:00.000-03:00');
const morning = new Date('2026-09-19T10:00:00.000-03:00');

test('parses shared sheet sync and drops invalid days', () => {
  assert.deepEqual(parseComplaintSync(null), emptyComplaintSync());
  const parsed = parseComplaintSync({
    sheetUrl: '  https://docs.google.com/spreadsheets/d/abc  ',
    lastImportAt: '2026-09-19T16:40:00.000Z',
    lastImportDay: '2026-09-19',
    updatedAt: '2026-09-19T16:41:00.000Z',
  });
  assert.equal(parsed.sheetUrl, 'https://docs.google.com/spreadsheets/d/abc');
  assert.equal(parsed.lastImportDay, '2026-09-19');
  assert.equal(parseComplaintSync({ lastImportDay: '19/09/2026' }).lastImportDay, null);
});

test('Argentina clock parts stay on Buenos Aires time', () => {
  const parts = argentinaDateTimeParts(new Date('2026-09-19T16:30:00.000Z'));
  assert.equal(parts.date, '2026-09-19');
  assert.equal(parts.hour, 13);
  assert.equal(parts.minute, 30);
});

test('daily cutoff is 13:30 Argentina, inclusive', () => {
  assert.equal(isAfterDailyImportCutoff(beforeCutoff), false);
  assert.equal(isAfterDailyImportCutoff(atCutoff), true);
  assert.equal(isAfterDailyImportCutoff(afterCutoff), true);
  assert.equal(isAfterDailyImportCutoff(morning), false);
});

test('next automatic cruzar waits until 13:30 today or tomorrow', () => {
  assert.equal(nextDailyImportAt(morning).toISOString(), '2026-09-19T16:30:00.000Z');
  assert.equal(nextDailyImportAt(beforeCutoff).toISOString(), '2026-09-19T16:30:00.000Z');
  assert.equal(nextDailyImportAt(atCutoff).toISOString(), '2026-09-20T16:30:00.000Z');
  assert.equal(nextDailyImportAt(afterCutoff).toISOString(), '2026-09-20T16:30:00.000Z');
  assert.ok(msUntilDailyImportCutoff(morning) > 3 * 60 * 60 * 1000);
  assert.equal(msUntilDailyImportCutoff(atCutoff) > 20 * 60 * 60 * 1000, true);
});

test('shared daily import runs once after cutoff', () => {
  const sync = parseComplaintSync({
    sheetUrl: 'https://docs.google.com/spreadsheets/d/abc',
    lastImportDay: '2026-09-18',
  });
  assert.equal(dailyImportDecision(emptyComplaintSync(), afterCutoff), 'no_url');
  assert.equal(dailyImportDecision(sync, morning), 'before_cutoff');
  assert.equal(dailyImportDecision(sync, afterCutoff), 'run');
  assert.equal(
    dailyImportDecision({ ...sync, lastImportDay: '2026-09-19' }, afterCutoff),
    'already_done',
  );
  assert.equal(hasDailyImportForToday({ lastImportDay: '2026-09-19' }, afterCutoff), true);
  assert.equal(hasDailyImportForToday({ lastImportDay: '2026-09-18' }, afterCutoff), false);
});

test('a morning cruzar does not mark the daily import as done', () => {
  const current = parseComplaintSync({
    sheetUrl: 'https://docs.google.com/spreadsheets/d/old',
    lastImportDay: '2026-09-18',
  });
  const morningSync = applyManualCruzarToSync(
    current,
    'https://docs.google.com/spreadsheets/d/abc',
    morning,
  );
  assert.equal(morningSync.sheetUrl, 'https://docs.google.com/spreadsheets/d/abc');
  assert.equal(morningSync.lastImportDay, '2026-09-18');
  assert.equal(morningSync.lastImportAt, morning.toISOString());
  assert.equal(dailyImportDecision(morningSync, afterCutoff), 'run');

  const afternoonSync = applyManualCruzarToSync(morningSync, morningSync.sheetUrl, afterCutoff);
  assert.equal(afternoonSync.lastImportDay, '2026-09-19');
  assert.equal(dailyImportDecision(afternoonSync, afterCutoff), 'already_done');
});

test('status copy tells when the shared cruzar will run', () => {
  assert.match(dailyImportStatusMessage(emptyComplaintSync(), morning), /Guardá el link/);
  const withUrl = parseComplaintSync({ sheetUrl: 'https://docs.google.com/spreadsheets/d/abc' });
  assert.match(dailyImportStatusMessage(withUrl, morning), /13:30/);
  assert.match(dailyImportStatusMessage(withUrl, afterCutoff), /todavía no se cruzó/);
  assert.match(
    dailyImportStatusMessage(
      { ...withUrl, lastImportDay: '2026-09-19', lastImportAt: afterCutoff.toISOString() },
      afterCutoff,
    ),
    /Cruce automático de hoy listo/,
  );
});
