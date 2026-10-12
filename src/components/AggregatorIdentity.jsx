const ICONS = { pedidosya: 'pedidosya', rappi: 'rappi', rappi_turbo: 'rappi', mercadopago: 'mercadopago' };

export default function AggregatorIdentity({ aggregator, label, children, compact = false }) {
  const icon = ICONS[aggregator];
  return <span className={`pending-brand${compact ? ' pending-brand--compact' : ''}`}>
    <span className="pending-brand__icon">{icon ? <img src={`${import.meta.env.BASE_URL}aggregators/${icon}.jpg`} alt="" width="40" height="40" /> : <span aria-hidden="true">?</span>}
      {aggregator === 'rappi_turbo' && <span className="pending-brand__turbo" aria-hidden="true">ϟ</span>}
    </span><span className="pending-brand__text"><strong>{label}</strong>{children}</span>
  </span>;
}
