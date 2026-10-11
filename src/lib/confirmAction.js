let presenter;
export function registerConfirmation(handler) { presenter = handler; return () => { if (presenter === handler) presenter = null; }; }
export function confirmAction(message, options = {}) {
  return presenter ? presenter(typeof message === 'object' ? message : { message, ...options }) : Promise.resolve(false);
}
