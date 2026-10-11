import { getAggregatorLabel } from './aggregators.js';
import { complaintDay, COMPLAINT_STATUSES } from './complaintHistory.js';
import { argentinaToday, enumerateDays, isIsoDate, METRIC_AGGREGATORS } from './metrics.js';
import { refutadoDaysLeft } from './refutadoDeadline.js';

export function dailyLoadState(stats) {
  // A saved row is loaded, including older imports and explicit zeros.
  // Completeness and discrepancies are informational, never pending loads.
  return { state: stats ? 'complete' : 'missing' };
}

export function pendingCase(item, deadlines, today) {
  return { ...item, day: complaintDay(item), daysLeft: item.status === COMPLAINT_STATUSES.queja
    ? refutadoDaysLeft(complaintDay(item), deadlines, item.aggregator, today) : null };
}

export function summarizePendingDays(days) {
  return {
    missingDays: days.filter(day => day.groups.some(group => group.load.state === 'missing')).length,
    unrefuted: days.reduce((sum, day) => sum + day.unrefuted, 0),
    inAnalysis: days.reduce((sum, day) => sum + day.inAnalysis, 0),
  };
}

// Derive tasks from the authoritative documents. No separate completion flags.
// Data gaps begin at the first recorded activity, never before the local operated.
export function buildDailyPending({ metrics, history, from, to, aggregator = 'all', today = argentinaToday() }) {
  const items = Object.values(history?.items || {});
  const knownDays = [...Object.keys(metrics?.days || {}), ...items.map(complaintDay)]
    .filter(day => isIsoDate(day) && day <= today).sort();
  const start = knownDays[0];
  const byDay = new Map();
  for (const item of items) {
    const day = complaintDay(item);
    if (!isIsoDate(day) || day > today) continue;
    if (!byDay.has(day)) byDay.set(day, []);
    byDay.get(day).push(item);
  }
  const days = start ? enumerateDays(start, today).map(day => {
    const cases = byDay.get(day) || [];
    const platforms = aggregator === 'all' ? [...METRIC_AGGREGATORS] : [aggregator];
    if (aggregator === 'all' && cases.some(item => !METRIC_AGGREGATORS.includes(item.aggregator))) platforms.push('unknown');
    const groups = platforms.map(id => {
      const groupItems = cases.filter(item => id === 'unknown' ? !METRIC_AGGREGATORS.includes(item.aggregator) : item.aggregator === id);
      const stats = metrics?.days?.[day]?.[id];
      const load = id === 'unknown' ? { state: 'not_applicable' } : dailyLoadState(stats);
      const unrefuted = groupItems.filter(item => item.status === COMPLAINT_STATUSES.queja)
        .map(item => pendingCase(item, metrics?.refutadoDays, today))
        .sort((a, b) => (a.daysLeft ?? Infinity) - (b.daysLeft ?? Infinity) || (b.amount ?? -1) - (a.amount ?? -1) || a.id.localeCompare(b.id));
      const inAnalysis = groupItems.filter(item => item.status === COMPLAINT_STATUSES.refutado)
        .map(item => pendingCase(item, metrics?.refutadoDays, today));
      const discrepancy = Boolean(stats && stats.reported?.complaints !== false &&
        Number.isSafeInteger(stats.complaints) && stats.complaints !== groupItems.length);
      return { id, label: getAggregatorLabel(id), load, unrefuted, inAnalysis,
        reportedComplaints: stats?.complaints, historyCases: groupItems.length, discrepancy };
    });
    const unrefuted = groups.reduce((sum, group) => sum + group.unrefuted.length, 0);
    const inAnalysis = groups.reduce((sum, group) => sum + group.inAnalysis.length, 0);
    const needsData = groups.some(group => group.load.state === 'missing');
    return { day, groups, unrefuted, inAnalysis, inProgress: day === today,
      // Today's incomplete data is work in progress, not a missed daily closing.
      hasPending: unrefuted > 0 || inAnalysis > 0 || (day !== today && needsData), needsData };
  }) : [];
  const validRange = isIsoDate(from) && isIsoDate(to) && from <= to && to <= today;
  const visible = validRange ? days.filter(day => day.day >= from && day.day <= to) : [];
  const outside = validRange ? days.filter(day => day.hasPending && (day.day < from || day.day > to)) : [];
  const undated = items.filter(item => !isIsoDate(complaintDay(item)) &&
    [COMPLAINT_STATUSES.queja, COMPLAINT_STATUSES.refutado].includes(item.status) &&
    (aggregator === 'all' || item.aggregator === aggregator));
  return { days: visible, outside, undated, start, validRange, totals: summarizePendingDays(visible), outsideTotals: summarizePendingDays(outside) };
}
