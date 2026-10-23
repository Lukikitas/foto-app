// Synthetic data only. All Supabase requests are intercepted before App is mounted.
import { createRoot } from 'react-dom/client';
import { useState, lazy, Suspense } from 'react';
import { performanceView } from '../../src/lib/performanceViews';
import { emptyStore } from '../../src/lib/metrics';
import { parseHistory } from '../../src/lib/complaintHistory';
import '../../src/index.css';
import '../../src/App.css';
const photos = Array.from({length:10000},(_,index) => ({id:String(index),name:`PEYA${10000+index}`,created_at:'2026-10-09T12:00:00Z',file_path:`orders/pedidosya/${index}.jpg`,public_url:'/pwa-192.png',thumbnail_path:null,taken_by:'Equipo de prueba',aggregator:'pedidosya',has_complaint:false,is_refutado:false,notes:''}));
const metrics = {...emptyStore(),updatedAt:'2026-10-09T12:00:00Z',days:{'2026-10-09':{pedidosya:{orders:10000,complaints:250,awt:400}}}};
const history = parseHistory({items:Object.fromEntries(photos.slice(0,250).map((photo,index) => [photo.name+'|2026-10-09',{id:photo.name+'|2026-10-09',orderCode:photo.name,day:'2026-10-09',photoId:photo.id,photoName:photo.name,photoUrl:photo.public_url,aggregator:'pedidosya',amount:index%5?1000:null,status:['queja','refutado','refutado_aceptado','refutado_rechazado','no_refutable'][index%5]}]))});
const counts = new Map();
const originalFetch = window.fetch.bind(window);
window.WebSocket = class extends EventTarget {
  static CONNECTING=0; static OPEN=1; static CLOSING=2; static CLOSED=3;
  constructor() { super(); this.readyState=0; }
  send() {}
  close() { this.readyState=3; }
};
globalThis.WebSocket = window.WebSocket;
window.fetch = async (input, options = {}) => {
  const url = new URL(typeof input==='string' ? input : input.url);
  if (!url.hostname.endsWith('.supabase.co')) return originalFetch(input,options);
  const path = url.pathname.split('/').at(-1);
  counts.set(path,(counts.get(path)||0)+1);
  if(options.signal?.aborted)throw new DOMException('Aborted','AbortError');
  await new Promise(resolve=>setTimeout(resolve,150));
  if(options.signal?.aborted)throw new DOMException('Aborted','AbortError');
  const args = options.body ? JSON.parse(options.body) : {};
  const response = data => new Response(JSON.stringify(data),{headers:{'Content-Type':'application/json'}});
  if(path==='foto_metrics_header')return response({data:{...metrics,days:undefined},availableLastDay:'2026-10-09',revision:1});
  if(path==='performance-data')return response(performanceView({ ...args,metrics,history,photos }));
  if(path==='foto_gallery_page') {
    const filtered=photos.filter(photo=>(!args.filters.search || photo.name.includes(args.filters.search)) && args.filters.kind!=='files');
    return response({items:filtered.slice((args.page-1)*args.page_size,args.page*args.page_size),total:filtered.length,page:args.page,asOf:args.as_of || new Date().toISOString()});
  }
  if(path==='foto_history_page') {
    const all=Object.values(history.items).filter(item=>!args.filters.search || item.orderCode.includes(args.filters.search));
    const list=all.filter(item=>args.filters.status==='all' || item.status===args.filters.status);
    const stats={all:all.length,con_foto:all.length,...Object.fromEntries(['queja','refutado','refutado_aceptado','refutado_rechazado','no_refutable'].map(status=>[status,all.filter(item=>item.status===status).length]))};
    return response({items:list.slice((args.page-1)*args.page_size,args.page*args.page_size),total:list.length,page:args.page,historyCount:250,amount:200000,stats,revision:1});
  }
  if(path==='photos')return response(photos.filter(photo=>!url.searchParams.get('id') || url.searchParams.get('id').includes(photo.id)).slice(0,100));
  if(path==='foto_document_read' || path==='foto_document_read_if_changed')return response({key:args.document_key,revision:1,data:args.document_key==='metrics'?metrics:history});
  if(path==='foto_draft_read_if_changed' || path==='foto_draft_action')return response(null);
  if(path==='order-recovery-settings.json' || path==='complaint-sync.json')return response({});
  return new Response(JSON.stringify({message:'Consulta deshabilitada en la prueba local: '+path}),{status:403,headers:{'Content-Type':'application/json'}});
};
globalThis.fetch = window.fetch;
const App=lazy(()=>import('../../src/App'));
export function Fixture() {
  const [snapshot,setSnapshot]=useState([]);
  return <><aside style={{position:'fixed',bottom:5,right:5,zIndex:9999,background:'#fff',color:'#111',padding:8,fontSize:12,maxWidth:340}}>
    <strong>Prueba local · 10.000 fotos / 250 reclamos</strong><br/>
    <button onClick={()=>setSnapshot([...counts])}>Ver consultas</button><br/>{snapshot.map(([key,value])=><div key={key}>{key}: {value}</div>)}
  </aside><Suspense fallback={<p>Cargando prueba…</p>}><App/></Suspense></>;
}
const root=createRoot(document.getElementById('root'));
document.addEventListener('unmount-fixture',()=>root.unmount(),{once:true});
root.render(<Fixture/>);
