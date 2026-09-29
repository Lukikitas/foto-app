import { useEffect, useMemo, useState } from 'react';
import {
  buildTrendChartSvg,
  buildTrendCsv,
  buildTrendSeries,
  trendChartSize,
  trendSvgToPngBlob,
  TREND_VIEWS,
} from '../lib/trendChart';
import { formatDayLabel, formatMoney, formatNumber, formatPct } from '../lib/metrics';
import { getTheme } from '../lib/theme';
import { triggerBlobDownload } from '../lib/photoDownload';
import { downloadTextFile } from '../lib/complaints';

function formatDelta(value, { pct = false, money = false } = {}) {
  if (value == null || Number.isNaN(Number(value))) return '—';
  const formatted = money ? formatMoney(Math.abs(value)) : pct ? formatPct(Math.abs(value)) : formatNumber(Math.abs(value));
  if (value > 0) return `+${formatted}`;
  if (value < 0) return `−${formatted}`;
  return formatted;
}

function useChartPalette() {
  const [theme, setTheme] = useState(getTheme);
  useEffect(() => {
    const observer = new MutationObserver(() => setTheme(getTheme()));
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    return () => observer.disconnect();
  }, []);
  return theme === 'dark' ? 'dark' : 'light';
}

function SummaryChip({ label, value, hint, tone }) {
  return (
    <article className={`trend-chip${tone ? ` trend-chip--${tone}` : ''}`}>
      <p>{label}</p>
      <strong>{value}</strong>
      {hint ? <span>{hint}</span> : null}
    </article>
  );
}

/**
 * Trend chart card: summary chips + two-view SVG (Operación / Plata) with
 * optional standalone PNG/CSV export. `series` can be provided by the caller
 * (report screen) or built from store + history.
 */
export default function TrendCard({
  store,
  history,
  range,
  aggregator = 'all',
  series: seriesProp = null,
  allowExport = true,
}) {
  const [view, setView] = useState('operation');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const palette = useChartPalette();

  const series = useMemo(
    () => seriesProp || buildTrendSeries(store, history, {
      from: range?.from || '',
      to: range?.to || '',
      aggregator,
    }),
    [seriesProp, store, history, range, aggregator],
  );

  const svg = useMemo(
    () => buildTrendChartSvg(series, { palette, view }),
    [series, palette, view],
  );

  if (!series.hasData) return null;

  const { totals, compared, target } = series;
  const summaryLabel =
    `Tendencia del ${formatDayLabel(series.from)} al ${formatDayLabel(series.to)}: ` +
    `${formatNumber(totals.orders)} pedidos, ${formatNumber(totals.complaints)} quejas, ` +
    `${formatPct(totals.complaintPct)} de quejas.`;

  async function handlePngExport() {
    setBusy(true);
    setError(null);
    try {
      const { width, height } = trendChartSize(view);
      const background = palette === 'dark' ? '#1f1f1f' : '#f7f3ee';
      const blob = await trendSvgToPngBlob(svg, { width, height, scale: 2, background });
      triggerBlobDownload(blob, `tendencia-${series.from}-a-${series.to}.png`);
    } catch (exportError) {
      setError(exportError.message || 'No se pudo exportar la imagen.');
    } finally {
      setBusy(false);
    }
  }

  function handleCsvExport() {
    downloadTextFile(`tendencia-${series.from}-a-${series.to}.csv`, buildTrendCsv(series));
  }


  return (
    <section className="trend-card" aria-label="Tendencia del período">
      <header className="trend-card__header">
        <div>
          <h3>Tendencia del período</h3>
          <p className="trend-card__period">
            {formatDayLabel(series.from)}
            {series.from !== series.to ? ` → ${formatDayLabel(series.to)}` : ''}
            {` · ${formatNumber(totals.complaints)} quejas · ${formatPct(totals.complaintPct)}`}
          </p>
        </div>
        <div className="trend-card__controls">
          <div className="filter-row filter-row--joined" role="group" aria-label="Vista del gráfico">
            {TREND_VIEWS.map((item) => (
              <button
                key={item.id}
                type="button"
                className={`filter-row__btn${view === item.id ? ' filter-row__btn--active' : ''}`}
                aria-pressed={view === item.id}
                onClick={() => setView(item.id)}
              >
                {item.label}
              </button>
            ))}
          </div>
          {allowExport && (
            <div className="trend-card__actions">
              <button
                type="button"
                className="btn btn--ghost btn--small"
                onClick={handlePngExport}
                disabled={busy}
                title="Descargar el gráfico como imagen"
              >
                {busy ? 'Generando…' : 'PNG'}
              </button>
              <button
                type="button"
                className="btn btn--ghost btn--small"
                onClick={handleCsvExport}
                title="Descargar los datos del período como CSV"
              >
                CSV
              </button>
            </div>
          )}
        </div>
      </header>

      <div className="trend-card__chips">
        <SummaryChip label="Pedidos" value={formatNumber(totals.orders)} hint={`${formatDelta(compared.orders)} vs anterior`} />
        <SummaryChip label="Quejas" value={formatNumber(totals.complaints)} hint={`${formatDelta(compared.complaints)} vs anterior`} />
        <SummaryChip
          label="% quejas"
          value={formatPct(totals.complaintPct)}
          hint={`objetivo ${formatPct(target)} · ${formatDelta(compared.complaintPct, { pct: true })}`}
          tone={totals.complaintPct > target ? 'bad' : 'good'}
        />
        <SummaryChip
          label="$ recuperado"
          value={formatMoney(totals.recoveredAmount)}
          hint={`${formatPct(totals.recoveredPctOfAmount)} de recuperación`}
          tone="good"
        />
        <SummaryChip
          label="$ perdido"
          value={formatMoney(totals.lostAmount)}
          hint={`${formatDelta(compared.lostAmount, { money: true })} vs anterior`}
          tone={totals.lostAmount > 0 ? 'bad' : undefined}
        />
      </div>

      {error ? <p className="message message--error" role="alert">{error}</p> : null}

      <div
        className="trend-card__figure"
        role="img"
        aria-label={summaryLabel}
        dangerouslySetInnerHTML={{ __html: svg }}
      />
    </section>
  );
}

