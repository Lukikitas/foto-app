// Shared by the read-only Edge Function and Node parity tests.
import { parseStore, previousPeriod, lastLoadedMetricsDay, argentinaToday } from './metrics.js';
import { parseHistory, groupHistoryFlags, listHistoryItems } from './complaintHistory.js';
import { buildMetricsQuality } from './metricsQuality.js';
import { buildStaffReport } from './staffPerformance.js';
import { buildDailyPending } from './dailyPending.js';
import { buildComplaintReport } from './complaintReport.js';
import { buildTrendSeries } from './trendChart.js';

/** @param {{view: string, metrics: Object, history: Object, from: string, to: string, aggregator?: string, preset?: string, photos?: Object[], extraPhotos?: Object[], today?: string}} options */
export function performanceView({ view, metrics, history, from, to, aggregator = 'all', preset = '', photos = [], extraPhotos = [], today = argentinaToday() }) {
  const store = parseStore(metrics);
  const source = parseHistory(history);
  const previous = previousPeriod(from, to, preset);
  const start = view === 'overview' || view === 'report' ? previous.from : from;
  const slicedMetrics = { ...store, days: Object.fromEntries(Object.entries(store.days).filter(([day]) => day >= start && day <= to)),
    availableLastDay: lastLoadedMetricsDay(store,today) || null };
  if (view === 'pending') {
    const report = buildDailyPending({ metrics: store, history: source, from, to, aggregator, today });
    // Only counts are used for days outside the selected range.
    return { report: { ...report, outside: report.outside.map(day => ({ day: day.day })) }, metrics: slicedMetrics };
  }
  if (view === 'staff') {
    const items = listHistoryItems(source, { from, to, aggregator });
    return { metrics: slicedMetrics, history: { version: 2, items: Object.fromEntries(items.map(item => [item.id,item])) },
      staff: buildStaffReport({ photos, historyItems: items, extraPhotos, aliases: store.photographerAliases }),
      variants: [...new Set(photos.map(photo => photo.taken_by).filter(Boolean))].sort() };
  }
  if (view === 'overview' || view === 'report') {
    const quality = {};
    for (const range of [{ from, to }, previous]) quality[`${range.from}|${range.to}|${aggregator}`] = buildMetricsQuality(store, source, range, aggregator);
    const result = { metrics: slicedMetrics, history: { version: 2, items: {}, summaryFrom: start, summaryTo: to,
      summaryFlags: groupHistoryFlags(source, start, to, { refutadoDays: store.refutadoDays, today }), quality } };
    if (view === 'report') {
      const report=buildComplaintReport(source,{from,to,aggregator,metrics:store,today});
      for(const key of ['aggregators','combos','reasons','days']) report[key]=report[key].map(row=>{const copy={...row};delete copy.items;return copy;});
      return {...result,report,trend:buildTrendSeries(store,source,{from,to,aggregator,preset})};
    }
    return result;
  }
  const items = listHistoryItems(source, { from: start, to });
  return { metrics: slicedMetrics, history: { ...source, items: Object.fromEntries(items.map(item => [item.id,item])) } };
}
