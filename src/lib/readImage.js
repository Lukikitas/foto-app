export const IMAGE_READ_ERROR = 'No se pudo abrir la foto guardada en este dispositivo. Reintentá con la app abierta. Si vuelve a fallar, conservá este pendiente: puede ser necesario volver a tomar la foto.';

function imageError(cause) {
  return Object.assign(new Error(IMAGE_READ_ERROR, { cause }), { code: 'IMAGE_READ_FAILED' });
}

function fromBitmap(image) {
  return { image, width: image.width, height: image.height, close: () => image.close() };
}

function fromImageUrl(url) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => {
      if (!image.naturalWidth || !image.naturalHeight) { reject(imageError()); return; }
      image.width = image.naturalWidth;
      image.height = image.naturalHeight;
      resolve({ image, width: image.naturalWidth, height: image.naturalHeight, close: () => { image.src = ''; } });
    };
    image.onerror = () => reject(imageError());
    image.src = url;
  });
}

function dataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.onabort = () => reject(imageError());
    reader.readAsDataURL(file);
  });
}

/** Read pending camera/IndexedDB files without replacing or discarding their originals. */
export async function readImage(file) {
  if (!file || !file.size) throw imageError();
  let failure;
  if (typeof createImageBitmap === 'function') {
    try { return fromBitmap(await createImageBitmap(file, { imageOrientation: 'from-image' })); }
    catch { /* Retry without orientation options for older decoders. */ }
    try { return fromBitmap(await createImageBitmap(file)); }
    catch (error) { failure = error; }
  }
  // Materialize the bytes: a restored File can retain a problematic backing reference.
  let source = file;
  try {
    const bytes = await file.arrayBuffer();
    if (bytes.byteLength !== file.size) throw imageError();
    source = new Blob([bytes], { type: file.type || 'image/jpeg' });
    if (typeof createImageBitmap === 'function') {
      try { return fromBitmap(await createImageBitmap(source, { imageOrientation: 'from-image' })); }
      catch (error) { failure = error; }
    }
  } catch (error) { failure = error; }
  // The page has a different decoder from createImageBitmap; workers fall back to the page.
  if (typeof Image === 'function') {
    if (typeof URL.createObjectURL === 'function') {
      const url = URL.createObjectURL(source);
      try { return await fromImageUrl(url); }
      catch (error) { failure = error; }
      finally { URL.revokeObjectURL(url); }
    }
    if (typeof FileReader === 'function') {
      try { return await fromImageUrl(await dataUrl(source)); }
      catch (error) { failure = error; }
    }
  }
  throw imageError(failure);
}
