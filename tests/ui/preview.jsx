import {useState} from 'react';
import {createRoot} from 'react-dom/client';
import '../../src/index.css';
import '../../src/App.css';
import {applyTheme} from '../../src/lib/theme.js';
import {emptyStore} from '../../src/lib/metrics.js';
import {buildComplaintReport} from '../../src/lib/complaintReport.js';
import MetricsDashboard from '../../src/components/MetricsDashboard.jsx';
import MetricsEntry from '../../src/components/MetricsEntry.jsx';
import StoragePanel from '../../src/components/StoragePanel.jsx';
import ReportPdfModal from '../../src/components/ReportPdfModal.jsx';
import ConfirmationHost from '../../src/components/ConfirmationHost.jsx';
import ComplaintDetailDialog from '../../src/components/ComplaintDetailDialog.jsx';
import {confirmAction} from '../../src/lib/confirmAction.js';
const range={from:'2026-10-05',to:'2026-10-10'};
const store=emptyStore();
store.targetComplaintPct=2.2;
store.days={'2026-10-10':{pedidosya:{orders:100,complaints:5,awt:12,reported:{orders:true,complaints:true,awt:true},sources:{orders:'manual',complaints:'manual',awt:'manual'}},rappi:{orders:20,complaints:0,awt:0,reported:{orders:true,complaints:true}}}};
const history={items:Object.fromEntries(['refutado_aceptado','refutado','queja','no_refutable','refutado_rechazado'].map((status,index)=>[String(index),{id:String(index),orderCode:'PEYA1234'+index,day:'2026-10-10',status,aggregator:'pedidosya',amount:index===2?null:12500,reason:'missing item',combo:'Combo de prueba'}]))};
const storage={snapshotAt:new Date().toISOString(),total:{count:1209,bytes:785665,unknownSizeCount:2},categories:{orders:{count:1206,bytes:726615,unknownSizeCount:1},files:{count:1,bytes:10000,unknownSizeCount:0},tickets:{count:1,bytes:49050,unknownSizeCount:0},other:{count:1,bytes:0,unknownSizeCount:1}},selections:{eligible:{count:1001,bytes:501501,unknownSizeCount:0},protected:{count:205,bytes:225114,unknownSizeCount:1}},retainedRecords:1206,recordsWithoutImage:87};
const loadUsage=async()=>storage;
const failedUsage=async()=>{throw Error('Sin permiso para consultar Storage. Se puede reintentar.');};
export function Preview(){
 const [detail,setDetail]=useState(false);const [view,setView]=useState('metrics');const [pdf,setPdf]=useState(false);const [failure,setFailure]=useState(false);const [localStore,setLocalStore]=useState(store);const [dirty,setDirty]=useState(false);const [saveNotice,setSaveNotice]=useState('');
 const report=buildComplaintReport(history,{...range,metrics:store});
 return <div className="app" style={{display:"block"}}><main style={{padding:'1rem',maxWidth:1200,width:'100%',margin:'auto'}}><ConfirmationHost/><h2>v1.11 · Datos de prueba locales</h2><p>Esta página no guarda datos ni elimina archivos remotos.</p><div className="metrics-entry-selector">
 <button className="btn btn--ghost" onClick={()=>applyTheme('light')}>Tema claro</button><button className="btn btn--ghost" onClick={()=>applyTheme('dark')}>Tema oscuro</button>
 <button className="btn btn--ghost" onClick={()=>setDetail(true)}>Detalle de queja de prueba</button><button className="btn btn--ghost" onClick={()=>setView('metrics')}>Métricas de prueba</button><button className="btn btn--ghost" onClick={()=>setView('storage')}>Almacenamiento de prueba</button><button className="btn btn--ghost" onClick={()=>setPdf(true)}>PDF de prueba</button><button className="btn btn--ghost" onClick={()=>setView('entry')}>Carga de prueba</button></div>
 {view==='entry' ? <><p role="status">{dirty?'Borrador pendiente':'Sin cambios pendientes'} · {saveNotice}</p><button className="btn btn--ghost" onClick={()=>setFailure(!failure)}>{failure?'Permitir guardado local':'Simular fallo de guardado'}</button><MetricsEntry store={localStore} saving={false} onDirty={setDirty} onSave={async next=>{if(failure){setSaveNotice('Fallo simulado: el borrador se conserva.');return false;}setLocalStore(next);setSaveNotice('Datos guardados solo en la simulación local.');return true;}}/></> : view==='metrics' ? <MetricsDashboard store={store} history={history} period={range} aggregator="all" preset="week" onCases={()=>void confirmAction('Detalle de prueba. Ninguna operación remota.',{danger:false,title:'Casos de prueba'})} onChangeView={()=>{}} onFocusDay={()=>{}} onAggregator={()=>{}}/> : <><button className="btn btn--ghost" onClick={()=>setFailure(!failure)}>{failure?'Restablecer consulta':'Simular fallo de permisos'}</button><StoragePanel retention={{enabled:true,retention_days:30,last_run_at:'2026-10-10T03:00:00Z',last_removed:42}} loadUsage={failure?failedUsage:loadUsage} onCleanup={()=>void confirmAction('Se borrarían 1.001 imágenes hasta la fecha incluida. Esta es una simulación local; no se elimina ningún archivo.',{title:'Confirmación de prueba',confirmLabel:'Confirmar simulación'})}/></>}
 {detail&&<ComplaintDetailDialog item={{...history.items['2'],timeOfDay:'13:42',comment:'Registro sin evidencia: los datos del pedido se conservan.',fields:{'Origen':'Datos de prueba locales'}}} refutadoDays={store.refutadoDays} onClose={()=>setDetail(false)}/>}
 {pdf&&<ReportPdfModal report={report} onClose={()=>setPdf(false)}/>}</main></div>;
}
createRoot(document.getElementById('root')).render(<Preview/>);
