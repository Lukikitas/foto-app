export default function PhotographerPicker({
  value,
  history = [],
  onChange,
  compact = false,
  autoFocus = false,
  autoComplete = 'name',
}) {
  const trimmedValue = value?.trim() || '';

  function emit(name, selected) {
    onChange(name, { selected });
  }

  return (
    <div className={`photographer${compact ? ' photographer--compact' : ''}`}>
      <p className="photographer__label">¿Quién saca la foto?</p>
      {history.length > 0 && (
        <div className="photographer__chips" role="group" aria-label="Nombres recientes">
          {history.map((name) => {
            const active = trimmedValue.toLowerCase() === name.toLowerCase();
            return (
              <button
                key={name}
                type="button"
                className={`photographer__chip${active ? ' photographer__chip--active' : ''}`}
                onClick={() => emit(name, true)}
                aria-pressed={active}
              >
                {name}
              </button>
            );
          })}
        </div>
      )}
      <label className="photographer__field">
        <span className="photographer__field-label">Nombre</span>
        <input
          type="text"
          value={value}
          onChange={(e) => emit(e.target.value, false)}
          onBlur={() => {
            if (trimmedValue) emit(trimmedValue, true);
          }}
          placeholder="Tu nombre"
          maxLength={80}
          autoComplete={autoComplete}
          autoCapitalize="words"
          enterKeyHint="done"
          autoFocus={autoFocus}
        />
      </label>
    </div>
  );
}
