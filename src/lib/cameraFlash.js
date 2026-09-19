export function trackSupportsTorch(track) {
  try {
    return Boolean(track?.getCapabilities?.()?.torch);
  } catch {
    return false;
  }
}

export async function setTrackTorch(track, on) {
  if (!track?.applyConstraints) return false;

  const enabled = Boolean(on);
  const attempts = [{ advanced: [{ torch: enabled }] }, { torch: enabled }];

  for (const constraints of attempts) {
    try {
      await track.applyConstraints(constraints);
      return true;
    } catch {
      // Algunos navegadores solo aceptan una de las dos formas.
    }
  }

  return false;
}
