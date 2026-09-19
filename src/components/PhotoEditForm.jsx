import { useState } from 'react';
import { isOrderPhoto, isValidOrderDigits } from '../lib/photos';

export default function PhotoEditForm({
  photo,
  loading = false,
  onSubmit,
  onCancel,
}) {
  const isOrder = isOrderPhoto(photo);
  const [form, setForm] = useState({
    name: photo.name,
    notes: photo.notes || '',
    has_complaint: Boolean(photo.has_complaint),
    taken_by: photo.taken_by || '',
    is_refutado: Boolean(photo.is_refutado),
  });

  function updateForm(key, value) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  function handleNameChange(e) {
    const value = isOrder
      ? e.target.value.replace(/[^A-Za-z0-9-]/g, '').toUpperCase().slice(0, 32)
      : e.target.value;
    updateForm('name', value);
  }

  function handleSubmit(e) {
    e.preventDefault();
    onSubmit?.(form);
  }

  const invalidOrder = isOrder && !isValidOrderDigits(form.name);

  return (
    <form className="photo-card__edit-form" onSubmit={handleSubmit}>
      <label>
        {isOrder ? 'Código del pedido' : 'Nombre'}
        <input
          type="text"
          value={form.name}
          onChange={handleNameChange}
          disabled={loading}
          maxLength={isOrder ? 32 : 120}
          autoFocus
        />
      </label>

      <label>
        Quién lo subió
        <input
          type="text"
          value={form.taken_by}
          onChange={(e) => updateForm('taken_by', e.target.value)}
          disabled={loading}
          maxLength={80}
        />
      </label>

      <label>
        Anotaciones
        <textarea
          value={form.notes}
          onChange={(e) => updateForm('notes', e.target.value)}
          disabled={loading}
          maxLength={500}
          rows={2}
        />
      </label>

      {isOrder && (
        <div className="photo-card__edit-flags">
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={form.has_complaint}
              onChange={(e) => updateForm('has_complaint', e.target.checked)}
              disabled={loading}
            />
            <span>Pedido con reclamo</span>
          </label>
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={form.is_refutado}
              onChange={(e) => updateForm('is_refutado', e.target.checked)}
              disabled={loading}
            />
            <span>Es un refutado</span>
          </label>
        </div>
      )}

      <div className="photo-card__rename-actions">
        <button
          type="submit"
          className="btn btn--small btn--primary"
          disabled={loading || !form.name.trim() || invalidOrder}
        >
          Guardar
        </button>
        <button
          type="button"
          className="btn btn--small btn--ghost"
          onClick={onCancel}
          disabled={loading}
        >
          Cancelar
        </button>
      </div>
    </form>
  );
}
