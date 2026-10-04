import { useEffect, useRef, useState } from 'react';
import { AGGREGATOR_OPTIONS, getPhotoAggregator } from '../lib/aggregators';
import { isOrderPhoto, isUnidentifiedOrder, isValidOrderDigits } from '../lib/photos';
import { loadOrderTicket, syncTicketToCloud, ticketDownloadFilename } from '../lib/orderTicketViewer';
import { fetchPhotoBlob, triggerBlobDownload, triggerUrlDownload } from '../lib/photoDownload';

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
    aggregator: getPhotoAggregator(photo) || '',
    file: null,
  });
  const [ticket, setTicket] = useState(null);
  const [ticketState, setTicketState] = useState('idle'); // idle | loading | missing | error
  const [ticketError, setTicketError] = useState(null);
  const ticketUrlRef = useRef(null);

  // La URL de objeto del ticket local se revoca al cerrar o desmontar.
  useEffect(() => () => {
    if (ticketUrlRef.current) URL.revokeObjectURL(ticketUrlRef.current);
  }, []);

  function closeTicket() {
    if (ticketUrlRef.current) {
      URL.revokeObjectURL(ticketUrlRef.current);
      ticketUrlRef.current = null;
    }
    setTicket(null);
    setTicketState('idle');
    setTicketError(null);
  }

  async function handleViewTicket() {
    if (ticket) {
      closeTicket();
      return;
    }
    setTicketState('loading');
    setTicketError(null);
    try {
      // Si el ticket está solo en este celular (la cola no llegó a subirlo),
      // se reintenta la subida en segundo plano: Supabase lo rechaza si el
      // pedido ya tiene código, así que solo aplica a los que siguen sin código.
      const found = await loadOrderTicket(photo.id, {
        syncLocalTicket: isUnidentifiedOrder(photo) ? syncTicketToCloud : null,
      });
      if (!found) {
        setTicketState('missing');
        return;
      }
      if (found.source === 'local') ticketUrlRef.current = found.url;
      setTicket(found);
      setTicketState('idle');
    } catch (err) {
      setTicketState('error');
      setTicketError(err.message || 'No se pudo obtener la foto del ticket.');
    }
  }

  async function handleDownloadTicket() {
    if (!ticket) return;
    const filename = ticketDownloadFilename(photo);
    setTicketError(null);
    let source = ticket;
    try {
      let blob = source.file;
      if (!blob) {
        try {
          blob = await fetchPhotoBlob(source.url);
        } catch (fetchError) {
          // La URL firmada venció (5 min): se pide una fresca y se reintenta.
          const fresh = await loadOrderTicket(photo.id, {
            syncLocalTicket: isUnidentifiedOrder(photo) ? syncTicketToCloud : null,
          });
          if (!fresh) throw fetchError;
          source = fresh;
          setTicket(source);
          blob = fresh.file || await fetchPhotoBlob(fresh.url);
        }
      }
      if (!blob || !triggerBlobDownload(blob, filename)) {
        throw new Error('No se pudo descargar el ticket.');
      }
    } catch {
      // Sin CORS o URL vencida: el navegador abre la imagen en otra pestaña.
      triggerUrlDownload(source.url, filename);
    }
  }

  function updateForm(key, value) {
    setForm((prev) => {
      if (key === 'has_complaint' && !value) {
        return { ...prev, has_complaint: false, is_refutado: false };
      }
      if (key === 'is_refutado' && value) {
        return { ...prev, has_complaint: true, is_refutado: true };
      }
      return { ...prev, [key]: value };
    });
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

  const invalidOrder = isOrder && form.name !== 'Código no encontrado' && !isValidOrderDigits(form.name);

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

      {isOrder && (
        <label>
          Agregador
          <select
            value={form.aggregator}
            onChange={(e) => updateForm('aggregator', e.target.value)}
            disabled={loading}
          >
            <option value="">Sin agregador</option>
            {AGGREGATOR_OPTIONS.map((item) => (
              <option key={item.id} value={item.id}>{item.label}</option>
            ))}
          </select>
        </label>
      )}

      <label>
        {isOrder ? 'Reemplazar foto' : 'Reemplazar archivo'}
        <input
          type="file"
          accept={isOrder ? 'image/*' : undefined}
          onChange={(e) => updateForm('file', e.target.files?.[0] || null)}
          disabled={loading}
        />
        {form.file && <small>Nueva foto: {form.file.name}</small>}
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

      {isOrder && (
        <div className="photo-card__edit-ticket">
          <button
            type="button"
            className="btn btn--small btn--ghost"
            onClick={handleViewTicket}
            disabled={loading || ticketState === 'loading'}
          >
            {ticketState === 'loading'
              ? 'Buscando ticket…'
              : ticket
                ? 'Ocultar ticket'
                : 'Ver / descargar ticket'}
          </button>
          {ticketState === 'missing' && (
            <small>
              {isValidOrderDigits(photo.name)
                ? 'Este pedido ya tiene código: el ticket se guarda solo mientras el pedido sigue sin código.'
                : 'No hay ticket guardado para esta foto. Se sube desde el celular que la sacó y se conserva 72 horas.'}
            </small>
          )}
          {ticketState === 'error' && ticketError && (
            <small>{ticketError}</small>
          )}
          {ticket && (
            <div className="photo-card__ticket-preview">
              <img src={ticket.url} alt="Foto del ticket" />
              <div className="photo-card__rename-actions">
                <button
                  type="button"
                  className="btn btn--small btn--primary"
                  onClick={handleDownloadTicket}
                  disabled={loading}
                >
                  Descargar ticket
                </button>
              </div>
            </div>
          )}
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
