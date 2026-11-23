export default function ImportStoreField({ value, onChange, disabled }) {
  return <label className="peya-import__store">Local del reporte
    <input type="text" value={value} disabled={disabled} placeholder="Nombre completo del local en el Excel" onChange={event => onChange(event.target.value)} />
    <small>Si hay un solo local, se detecta automáticamente. Si hay varios, indicá cuál importar.</small>
  </label>;
}
