import { useState } from 'react';
import { getAggregatorLabel } from '../lib/aggregators';
import { formatDayLabel } from '../lib/metrics';
import { buildMetricsQuality } from '../lib/metricsQuality';

export default function MetricsQualityPanel({ store, history, range, aggregator }) {
  const [includeEmpty, setIncludeEmpty] = useState(false);
  const quality = buildMetricsQuality(store, history, range, aggregator);
  const labels = { missing: 'Sin totales cargados', partial: 'Faltan algunos campos', legacy: 'Datos anteriores', complete: 'Todos los campos cargados' };
  const rows = quality.rows.filter(row => includeEmpty || row.state !== 'missing' || row.cases > 0);
  return <details className="metrics-quality">
    <summary>De dónde salen los números <span className="metric-source">Totales diarios y reclamos del historial · ver explicación</span></summary>
    <div className="metrics-sources">
      <div><h4>Totales diarios</h4><p>Pedidos, quejas informadas y demorados de PedidosYa se toman de lo que cargaste en Cargar, mediante Excel, una lista o el formulario.</p></div>
      <div><h4>Reclamos del historial</h4><p>Los casos, sus estados y los importes se toman de los reclamos guardados en Historial. Hay {quality.cases} casos para el filtro seleccionado.</p></div>
      <div><h4>¿Por qué pueden ser distintos?</h4><p>Un total diario puede informar quejas que todavía no tienen un reclamo guardado. Se muestran ambas cantidades para que puedas compararlas; ninguna reemplaza automáticamente a la otra.</p></div>
    </div>
    <p>«Sin totales cargados» significa que falta esa carga, no que hubo cero pedidos. «Datos anteriores» conserva los valores guardados antes de registrar qué campos se completaron; no significa que estén mal.</p>
    {quality.discrepancies.length > 0 && <p>Hay {quality.discrepancies.length} diferencias entre las quejas informadas del día y los reclamos guardados. Las filas señaladas con ⚠ muestran dónde revisar.</p>}
    {quality.partial > 0 && <p>En {quality.partial} cargas faltan algunos campos. Podés completarlos en Cargar.</p>}
    {quality.missingAmounts > 0 && <p>{quality.missingAmounts} reclamos no tienen monto informado. Los importes muestran solo el dinero conocido.</p>}
    <div className="metrics-sources__detail"><h4>Detalle de las cargas y reclamos</h4><label><input type="checkbox" checked={includeEmpty} onChange={event=>setIncludeEmpty(event.target.checked)}/> Incluir días y plataformas sin datos</label></div>
    {rows.length ? <div className="metrics-table-wrap"><table className="metrics-table"><thead><tr><th>Fecha</th><th>Plataforma</th><th>Totales del día</th><th>Quejas informadas</th><th>Reclamos guardados</th><th>Valores cargados</th><th>Cómo se cargaron</th></tr></thead>
      <tbody>{rows.map(row => <tr key={row.day+'-'+row.aggregator}>
        <td>{formatDayLabel(row.day)}</td><td>{getAggregatorLabel(row.aggregator)}</td><td>{labels[row.state]}</td>
        <td>{row.reported ?? 'Sin cargar'}{row.discrepancy ? ' ⚠' : ''}</td><td>{row.cases}</td>
        <td>{['orders','complaints',...(row.aggregator==='pedidosya'?['awt']:[])].map(key => {const stats=store.days?.[row.day]?.[row.aggregator];return (({orders:'Pedidos',complaints:'Quejas',awt:'Demorados'})[key])+': '+(!stats || stats.reported?.[key] === false ? 'Sin cargar' : stats[key]);}).join(' · ')}</td>
        <td>{Object.entries(store.days?.[row.day]?.[row.aggregator]?.sources || {}).filter(([, value]) => value).map(([key, value]) => (({orders:'Pedidos',complaints:'Quejas',awt:'Demorados'})[key])+': '+(({manual:'Formulario',lista:'Lista pegada',excel_pedidosya:'Excel PedidosYa',excel_rappi:'Excel Rappi'})[value] || value)).join(' · ') || 'No se registró el método'}</td>
      </tr>)}</tbody></table></div> : <p>No hay cargas ni reclamos para este filtro.</p>}
  </details>;
}
