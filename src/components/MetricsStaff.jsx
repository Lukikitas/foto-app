import { useEffect, useMemo, useState } from 'react';
import { listHistoryItems } from '../lib/complaintHistory';
import { downloadTextFile } from '../lib/complaints';
import { formatMoney, formatNumber, formatPct } from '../lib/metrics';
import { fetchPhotos, fetchPhotosByIds } from '../lib/photos';
import { buildStaffCsv, buildStaffReport } from '../lib/staffPerformance';

const STAFF_COLUMNS = 'id,name,file_path,created_at,taken_by,has_complaint,is_refutado,aggregator';

const SORT_BUTTONS = [
  { key: 'photos', label: 'Por fotos' },
  { key: 'complaints', label: 'Por quejas' },
];

function hourLabel(hour) {
  return hour == null ? 'Sin hora' : `${String(hour).padStart(2, '0')}:00`;
}

function StaffBar({ pct }) {
  const width = Math.max(0, Math.min(100, Number(pct) || 0));
  return (
    <span className="staff-bar" aria-hidden="true">
      <span className="staff-bar__fill" style={{ width: `${width}%` }} />
    </span>
  );
}

function SortHeader({ label, sortKey, current, dir, onSort, numeric = true }) {
  const active = current === sortKey;
  return (
    <th
      scope="col"
      className={numeric ? 'staff__th--num' : undefined}
      aria-sort={active ? (dir === 'asc' ? 'ascending' : 'descending') : 'none'}
    >
      <button
        type="button"
        className={`staff__sort${active ? ' is-active' : ''}`}
        onClick={() => onSort(sortKey)}
        title={`Ordenar por ${label}`}
      >
        {label}{active ? (dir === 'asc' ? ' ▲' : ' ▼') : ''}
      </button>
    </th>
  );
}

/**
 * "Desempeño de personal": who takes the photos, complaint rates per person
 * and the hourly distribution of orders (photos) vs complaints (history).
 */
export default function MetricsStaff({ history, range, aggregator = 'all' }) {
  const [photos, setPhotos] = useState(null);
  const [loadedKey, setLoadedKey] = useState(null);
  const [extraPhotos, setExtraPhotos] = useState([]);
  const [error, setError] = useState(null);
  const [sort, setSort] = useState({ key: 'photos', dir: 'desc' });

  const photosKey = `${range.from}|${range.to}|${aggregator}`;
  const loading = loadedKey !== photosKey;

  const items = useMemo(
    () => listHistoryItems(history, { from: range.from, to: range.to, aggregator }),
    [history, range.from, range.to, aggregator],
  );

  // Fotos del período: solo se reejecutan al cambiar rango o agregador. Los
  // refrescos del historial que llegan desde otras pantallas no deben volver
  // a mostrar el spinner.
  useEffect(() => {
    let cancelled = false;
    async function load() {
      setError(null);
      try {
        const filters = { dateFrom: range.from, dateTo: range.to, columns: STAFF_COLUMNS };
        if (aggregator && aggregator !== 'all') filters.aggregator = aggregator;
        const periodPhotos = await fetchPhotos(filters);
        if (!cancelled) {
          setPhotos(periodPhotos);
          setLoadedKey(photosKey);
        }
      } catch (loadError) {
        if (!cancelled) {
          setError(loadError.message || 'No se pudieron leer las fotos del período.');
          setLoadedKey(photosKey);
        }
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [photosKey, range.from, range.to, aggregator]);

  // Fotos de fuera del período que sirven para atribuir quejas: solo se piden
  // cuando cambia el conjunto real de ids faltantes.
  const missingIds = useMemo(() => {
    const known = new Set((photos || []).map((photo) => photo.id));
    return [...new Set(items.map((item) => item.photoId).filter((id) => id && !known.has(id)))];
  }, [photos, items]);
  const missingKey = missingIds.join(',');

  useEffect(() => {
    if (!missingKey) return undefined;
    let cancelled = false;
    fetchPhotosByIds(missingKey.split(','))
      .then((extras) => {
        if (!cancelled) setExtraPhotos(extras);
      })
      .catch(() => {
        // Sin fotos extra la queja queda como "Sin asignar"; no bloquea la vista.
      });
    return () => {
      cancelled = true;
    };
  }, [missingKey]);

  const report = useMemo(
    () => buildStaffReport({ photos: photos || [], historyItems: items, extraPhotos }),
    [photos, items, extraPhotos],
  );

  const people = useMemo(() => {
    const rows = [...report.people];
    const factor = sort.dir === 'desc' ? -1 : 1;
    rows.sort((left, right) => {
      if (left.isUnassigned !== right.isUnassigned) return left.isUnassigned ? 1 : -1;
      if (sort.key === 'name') return factor * left.name.localeCompare(right.name, 'es');
      return factor * ((Number(left[sort.key]) || 0) - (Number(right[sort.key]) || 0));
    });
    return rows;
  }, [report.people, sort]);

  const maxPhotos = Math.max(...report.people.map((row) => row.photos), 1);

  function toggleSort(key) {
    setSort((prev) => (prev.key === key
      ? { key, dir: prev.dir === 'desc' ? 'asc' : 'desc' }
      : { key, dir: 'desc' }));
  }

  function handleCsv() {
    downloadTextFile(
      `desempeno-personal-${range.from}-a-${range.to}.csv`,
      buildStaffCsv(report),
    );
  }


  const unassigned = report.people.find((row) => row.isUnassigned);
  const rateTone = report.totals.complaintPct != null && report.totals.complaintPct > 0
    ? (report.totals.orders > 0 && report.totals.complaintPct > 2.4 ? 'bad' : undefined)
    : undefined;

  return (
    <section className="staff" aria-label="Desempeño de personal">
      <header className="staff__header">
        <div>
          <h3 className="staff__title">Desempeño de personal</h3>
          <p className="staff__lead">
            Fotos y quejas atribuidas a quien tomó la foto, en el período seleccionado.
            Los pedidos hora por hora salen de las fotos de pedidos (el Excel solo trae totales diarios).
          </p>
        </div>
        <button
          type="button"
          className="btn btn--ghost btn--small"
          onClick={handleCsv}
          disabled={loading || (!report.people.length && !report.hourly.length)}
          title="Descargar el desempeño y la distribución horaria como CSV"
        >
          Descargar CSV
        </button>
      </header>

      {error ? <p className="message message--error" role="alert">{error}</p> : null}

      {loading ? (
        <div className="gallery__state">
          <div className="spinner" aria-hidden="true" />
          <p>Cargando fotos del período…</p>
        </div>
      ) : (
        <>
          <div className="metrics-kpis staff__kpis">
            <article className="metrics-kpi">
              <p>Fotos</p>
              <strong>{formatNumber(report.totals.photos)}</strong>
              <span>{formatNumber(report.totals.orders)} de pedidos</span>
            </article>
            <article className="metrics-kpi">
              <p>Personal</p>
              <strong>{formatNumber(report.totals.people)}</strong>
              <span>con fotos en el período</span>
            </article>
            <article className="metrics-kpi">
              <p>Quejas</p>
              <strong>{formatNumber(report.totals.complaints)}</strong>
              <span>
                {report.totals.unassignedComplaints > 0
                  ? `${formatNumber(report.totals.unassignedComplaints)} sin asignar`
                  : 'todas con foto asignada'}
              </span>
            </article>
            <article className={`metrics-kpi${rateTone ? ' metrics-kpi--bad' : ''}`}>
              <p>% quejas</p>
              <strong>{formatPct(report.totals.complaintPct)}</strong>
              <span>sobre pedidos fotografiados</span>
            </article>
            <article className={`metrics-kpi${report.totals.recoveredAmount > 0 ? ' metrics-kpi--good' : ''}`}>
              <p>$ recuperado</p>
              <strong>{formatMoney(report.totals.recoveredAmount)}</strong>
              <span>de {formatMoney(report.totals.complaintAmount)} en quejas</span>
            </article>
          </div>


          {people.length === 0 ? (
            <div className="gallery__state gallery__state--empty">
              <p>No hay fotos ni quejas en este período.</p>
            </div>
          ) : (
            <>
              <div className="staff__toolbar">
                <span className="staff__toolbar-label">Ordenar</span>
                {SORT_BUTTONS.map((button) => (
                  <button
                    key={button.key}
                    type="button"
                    className={`filter-row__btn${sort.key === button.key ? ' filter-row__btn--active' : ''}`}
                    onClick={() => setSort({ key: button.key, dir: 'desc' })}
                    aria-pressed={sort.key === button.key}
                  >
                    {button.label}
                  </button>
                ))}
              </div>

              <div className="metrics-table-wrap">
                <table className="metrics-table staff__table">
                  <thead>
                    <tr>
                      <SortHeader label="Persona" sortKey="name" current={sort.key} dir={sort.dir} onSort={toggleSort} numeric={false} />
                      <SortHeader label="Fotos" sortKey="photos" current={sort.key} dir={sort.dir} onSort={toggleSort} />
                      <th scope="col" className="staff__th--num">% del total</th>
                      <SortHeader label="Pedidos" sortKey="orders" current={sort.key} dir={sort.dir} onSort={toggleSort} />
                      <SortHeader label="Quejas" sortKey="complaints" current={sort.key} dir={sort.dir} onSort={toggleSort} />
                      <SortHeader label="% quejas" sortKey="complaintPct" current={sort.key} dir={sort.dir} onSort={toggleSort} />
                      <SortHeader label="$ quejas" sortKey="complaintAmount" current={sort.key} dir={sort.dir} onSort={toggleSort} />
                      <SortHeader label="$ recuperado" sortKey="recoveredAmount" current={sort.key} dir={sort.dir} onSort={toggleSort} />
                    </tr>
                  </thead>
                  <tbody>
                    {people.map((row) => (
                      <tr key={row.key} className={row.isUnassigned ? 'staff__row--unassigned' : undefined}>
                        <td>
                          <span className={`staff__person${row.isUnassigned ? ' staff__person--none' : ''}`}>
                            {row.name}
                          </span>
                        </td>
                        <td className="staff__td--bar">
                          <span className="staff__td-value">{formatNumber(row.photos)}</span>
                          <StaffBar pct={(row.photos / maxPhotos) * 100} />
                        </td>
                        <td className="staff__td--num">{formatPct(row.photoSharePct, 1)}</td>
                        <td className="staff__td--num">{formatNumber(row.orders)}</td>
                        <td className="staff__td--num">{formatNumber(row.complaints)}</td>
                        <td className={`staff__td--num${row.complaintPct != null && row.complaintPct > 2.4 ? ' is-bad' : ''}`}>
                          {formatPct(row.complaintPct)}
                        </td>
                        <td className="staff__td--num">{formatMoney(row.complaintAmount)}</td>
                        <td className="staff__td--num">{formatMoney(row.recoveredAmount)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}


          {report.hourly.length > 0 && (
            <div className="staff__hourly">
              <h4 className="staff__subtitle">Pedidos y quejas hora por hora</h4>
              <div className="metrics-table-wrap">
                <table className="metrics-table staff__table">
                  <thead>
                    <tr>
                      <th scope="col">Hora</th>
                      <th scope="col" className="staff__th--bar">Pedidos</th>
                      <th scope="col" className="staff__th--num">% pedidos</th>
                      <th scope="col" className="staff__th--num">Quejas</th>
                      <th scope="col" className="staff__th--num">% quejas</th>
                      <th scope="col" className="staff__th--num">% quejas s/ pedidos</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.hourly.map((row) => (
                      <tr key={hourLabel(row.hour)}>
                        <td><strong>{hourLabel(row.hour)}</strong></td>
                        <td className="staff__td--bar">
                          <span className="staff__td-value">{formatNumber(row.orders)}</span>
                          <StaffBar pct={row.ordersPct} />
                        </td>
                        <td className="staff__td--num">{formatPct(row.ordersPct, 1)}</td>
                        <td className="staff__td--num">{formatNumber(row.complaints)}</td>
                        <td className="staff__td--num">{formatPct(row.complaintsPct, 1)}</td>
                        <td className={`staff__td--num${row.ratePct != null && row.ratePct > 2.4 ? ' is-bad' : ''}`}>
                          {formatPct(row.ratePct)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="staff__footnote">
                {unassigned && unassigned.complaints > 0
                  ? `${formatNumber(unassigned.complaints)} queja(s) sin foto asignada no se atribuyen a ninguna persona. `
                  : ''}
                Los pedidos se cuentan por fotos de pedidos tomadas en el período.
              </p>
            </div>
          )}
        </>
      )}
    </section>
  );
}

