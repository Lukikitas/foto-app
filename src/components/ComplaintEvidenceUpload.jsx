export default function ComplaintEvidenceUpload({ disabled, onFile }) {
  function handleChange(event) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (file) onFile(file);
  }

  return (
    <>
      <label className="btn btn--ghost btn--small">
        Cámara
        <input
          type="file"
          accept="image/*"
          capture="environment"
          hidden
          disabled={disabled}
          onChange={handleChange}
        />
      </label>
      <label className="btn btn--ghost btn--small">
        Subir foto
        <input type="file" accept="image/*" hidden disabled={disabled} onChange={handleChange} />
      </label>
    </>
  );
}
