/** A database reservation is not an acknowledgement of stored image bytes. */
export async function ensureTicketStored({ findReference, reserve, exists, upload }) {
  const reference = await findReference();
  if (reference && await exists()) return { stored: true, cached: true };
  if (!await reserve()) return { stored: false, reason: 'quota' };
  try { await upload(); }
  catch (error) {
    // Upload may have committed before the connection or response failed.
    // Never remove a shared reservation on an ambiguous error.
    if (await exists()) return { stored: true, cached: true };
    throw error;
  }
  return { stored: true };
}
