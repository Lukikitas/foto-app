export default function DataPager({page,pageSize,pageCount,total,setPage}) {
  if(pageCount<=1)return null;
  return <nav className="gallery__pager" aria-label="Páginas del detalle">
    <button className="btn btn--ghost btn--small" disabled={page<=1} onClick={()=>setPage(page-1)}>‹ Anterior</button>
    <span>Mostrando {(page-1)*pageSize+1}–{Math.min(page*pageSize,total)} de {total.toLocaleString('es-AR')}</span>
    <button className="btn btn--ghost btn--small" disabled={page>=pageCount} onClick={()=>setPage(page+1)}>Siguiente ›</button>
  </nav>;
}
