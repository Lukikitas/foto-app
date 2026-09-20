import { isAbortError, OCR_ENGINE_ERROR } from './tesseractAssets.js';
import { buildStoragePath, isDocumentHidden, itemNeedsOcr } from './uploadQueueProtocol.js';

function releaseTicket(item) {
  item.ticketFile = null;
}

function isInterrupted(error, shouldYield, signal) {
  if (typeof shouldYield === 'function' && shouldYield()) return true;
  if (signal?.aborted) return true;
  return isAbortError(error);
}

export async function processQueueItem(item, options = {}) {
  const {
    detectOrderFromPhoto,
    compressImage,
    uploadFile,
    uploadPhoto,
    uploadUnidentifiedOrder,
    persist = async () => {},
    notify = () => {},
    shouldYield = () => false,
    onComplete,
    signal,
    allowOcr = true,
  } = options;

  if (
    typeof compressImage !== 'function'
    || typeof uploadFile !== 'function'
    || typeof uploadPhoto !== 'function'
    || typeof uploadUnidentifiedOrder !== 'function'
  ) {
    throw new Error('Faltan las funciones de la cola de subida.');
  }
  if (allowOcr && typeof detectOrderFromPhoto !== 'function') {
    throw new Error('Faltan las funciones de la cola de subida.');
  }

  const yielded = () => shouldYield() || Boolean(signal?.aborted) || isDocumentHidden();

  const yieldNow = async () => {
    if (item.status !== 'done' && item.status !== 'error') {
      item.status = 'pending';
      item.error = null;
    }
    notify();
    await persist(item, { holdLease: false });
    return { yielded: true };
  };

  await persist(item);
  if (yielded()) return yieldNow();
  if (itemNeedsOcr(item) && !allowOcr) return yieldNow();

  let detectedOrder = null;
  const heartbeat = setInterval(() => {
    void persist(item);
  }, 8000);

  try {
    if (itemNeedsOcr(item)) {
      item.status = 'analyzing';
      item.label = 'Leyendo el código…';
      notify();
      await persist(item);
      try {
        detectedOrder = await detectOrderFromPhoto(item.ticketFile, {
          fallbackFiles: item.file && item.file !== item.ticketFile ? [item.file] : [],
          signal,
        });
      } catch (error) {
        if (isInterrupted(error, shouldYield, signal) || isDocumentHidden()) {
          return yieldNow();
        }
        throw error;
      }
      if (detectedOrder?.displayCode) {
        item.orderDigits = detectedOrder.displayCode;
        item.aggregator = detectedOrder.aggregator;
        item.label = `Pedido #${detectedOrder.displayCode}`;
        await persist(item);
      }
      if (yielded()) return yieldNow();
    }

    if (yielded()) return yieldNow();

    const preparedFile = item.file?.type?.startsWith('image/')
      ? await compressImage(item.file)
      : item.file;

    if (yielded()) return yieldNow();

    item.storagePath = buildStoragePath(item, preparedFile);
    item.status = 'uploading';
    if (item.orderDigits && item.label === 'Leyendo el código…') {
      item.label = `Pedido #${item.orderDigits}`;
    } else if (!item.orderDigits && item.kind !== 'file') {
      item.label = 'Código no encontrado';
    }
    notify();
    await persist(item);

    let photo;
    if (item.kind === 'file') {
      photo = await uploadFile(preparedFile, item.title, item.meta, item.storagePath);
    } else if (item.orderDigits) {
      photo = await uploadPhoto(
        preparedFile,
        item.orderDigits,
        item.meta,
        item.aggregator,
        item.storagePath,
      );
    } else if (detectedOrder?.aggregator) {
      photo = await uploadPhoto(
        preparedFile,
        detectedOrder.displayCode,
        item.meta,
        detectedOrder.aggregator,
        item.storagePath,
      );
    } else {
      photo = await uploadUnidentifiedOrder(preparedFile, item.meta, item.storagePath);
    }

    releaseTicket(item);
    item.status = 'done';
    item.error = null;
    notify();
    await persist(item);
    onComplete?.(photo);
    return { photo };
  } catch (error) {
    if (isInterrupted(error, shouldYield, signal)) return yieldNow();
    if (item.status === 'analyzing' && isDocumentHidden()) return yieldNow();
    const analyzing = item.status === 'analyzing';
    item.status = 'error';
    item.error = error.message || (analyzing ? OCR_ENGINE_ERROR : 'Error al subir la foto.');
    notify();
    await persist(item);
    throw error;
  } finally {
    clearInterval(heartbeat);
  }
}
