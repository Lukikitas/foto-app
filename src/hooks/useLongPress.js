import { useCallback, useRef } from 'react';

export function useLongPress(onLongPress, { delay = 450 } = {}) {
  const timerRef = useRef(null);
  const triggeredRef = useRef(false);

  const start = useCallback(() => {
    triggeredRef.current = false;
    if (timerRef.current) clearTimeout(timerRef.current);

    timerRef.current = setTimeout(() => {
      triggeredRef.current = true;
      onLongPress?.();
      if (navigator.vibrate) navigator.vibrate(40);
    }, delay);
  }, [onLongPress, delay]);

  const clear = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const handleClick = useCallback(
    (event, onShortPress) => {
      if (triggeredRef.current) {
        triggeredRef.current = false;
        event.preventDefault();
        return;
      }
      onShortPress?.(event);
    },
    []
  );

  const bind = useCallback(
    (onShortPress) => ({
      onTouchStart: start,
      onTouchEnd: clear,
      onTouchMove: clear,
      onTouchCancel: clear,
      onMouseDown: start,
      onMouseUp: clear,
      onMouseLeave: clear,
      onClick: (event) => handleClick(event, onShortPress),
    }),
    [start, clear, handleClick]
  );

  return { bind, clear };
}
