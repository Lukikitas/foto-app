import { useState } from 'react';

export default function CompleteOrderCode({ onSubmit, onCancel, loading, error }) {
  const [digits, setDigits] = useState('');

  function handleChange(e) {
    setDigits(e.target.value.replace(/\D/g, '').slice(0, 4));
  }

  function handleSubmit(e) {
    e.preventDefault();
    if (digits.length !== 4) return;
    onSubmit(digits);
  }

  return (
    <form className="complete-code" onSubmit={handleSubmit}>
      <label className="complete-code__label">
        Últimos 4 dígitos
        <input
          type="text"
          inputMode="numeric"
          pattern="\d{4}"
          value={digits}
          onChange={handleChange}
          disabled={loading}
          maxLength={4}
          autoFocus
          autoComplete="off"
          className="complete-code__input"
          placeholder="4696"
        />
      </label>
      {error && <p className="message message--error">{error}</p>}
      <div className="complete-code__actions">
        <button
          type="submit"
          className="btn btn--small btn--primary"
          disabled={loading || digits.length !== 4}
        >
          {loading ? 'Guardando…' : 'Guardar código'}
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
