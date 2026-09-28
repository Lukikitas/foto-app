import { isAbortError, OCR_ENGINE_ERROR } from './tesseractAssets.js';
import { EVIDENCE_IMAGE_OPTIONS } from './compressImage.js';
import { buildStoragePath, isDocumentHidden, itemNeedsOcr } from './uploadQueueProtocol.js';
import { saveUnresolvedTicket } from './unresolvedTicketStore.js';

function releaseTicket(item) {
  item.ticketFile = null;
}

function isInterrupted(error, shouldYield, signal) {
  if (typeof shouldYield === 'function' && shouldYield()) return true;
  if (signal?.aborted) return true;
  return isAbortError(error);
}

export function isTransientUploadError(error) {
  if (!error) return false;
  const msg = (error.message || String(error)).toLowerCase();
  const status = error.status || error.statusCode;

  if (status) {
    if (status === 401 || status === 403 || status === 400 || status === 413 || status === 422) {
      return false; // Permanent auth, bad request, payload too large, or validation error
    }
    if (status >= 500 && status <= 599) return true;
    if (status === 408 || status === 429) return true;
  }

  if (
    msg.includes('network') ||
    msg.includes('failed to fetch') ||
    msg.includes('fetch failed') ||
    msg.includes('timeout') ||
    msg.includes('connection')
  ) {
    return true;
  }

  return false;
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
    onOcrError = (error) => console.error('No se pudo completar el OCR; se guarda la evidencia sin código.', error),
    retainUnresolvedTicket = saveUnresolvedTicket,
    keepTicketForRecovery,
    recoverOrderCodeInCloud,
    releaseCloudTicket,
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
    void persist(item).catch((error) => console.error('No se pudo actualizar la cola.', error));
  }, 8000);

  try {
    if (itemNeedsOcr(item)) {
      item.status = 'analyzing';
      item.label = 'Leyendo el código…';
      notify();
      await persist(item);

      try {
        // Enforce 15s maximum for OCR so a blocked OCR does not hold up the queue
        const ocrPromise = detectOrderFromPhoto(item.ticketFile, {
          signal,
          requireStrong: true,
          fallbackFiles: item.file?.type?.startsWith('image/') ? [item.file] : [],
        });
        const ocrTimeout = new Promise((_, reject) => {
          setTimeout(() => reject(new Error('Tiempo límite de OCR agotado (15s)')), 15000);
        });

        detectedOrder = await Promise.race([ocrPromise, ocrTimeout]);
      } catch (error) {
        if (isInterrupted(error, shouldYield, signal) || isDocumentHidden()) {
          return yieldNow();
        }
        onOcrError(error);
        detectedOrder = null;
      }

      if (detectedOrder?.displayCode) {
        item.orderDigits = detectedOrder.displayCode;
        item.aggregator = detectedOrder.aggregator;
        item.label = `Pedido #${detectedOrder.displayCode}`;
        releaseTicket(item);
        await persist(item);
      }
      if (yielded()) return yieldNow();
    }

    if (yielded()) return yieldNow();

    const preparedFile = item.file?.type?.startsWith('image/')
      ? await compressImage(item.file, item.kind === 'order' ? EVIDENCE_IMAGE_OPTIONS : undefined)
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

    if (item.ticketFile && !item.orderDigits && item.kind === 'order') {
      if (!photo?.id) throw new Error('No se pudo conservar el ticket sin identificar.');
      await retainUnresolvedTicket(photo.id, item.ticketFile);
    }

    if (!item.orderDigits && item.kind === 'order' && photo?.id && recoverOrderCodeInCloud) {
      try {
        if (item.ticketFile && keepTicketForRecovery) {
          await keepTicketForRecovery(photo.id, item.ticketFile);
        }
        const recovered = await recoverOrderCodeInCloud(photo.id);
        if (recovered?.displayCode && recovered.reliable && recovered.aggregator) {
          photo = await uploadPhoto(
            preparedFile,
            recovered.displayCode,
            item.meta,
            recovered.aggregator,
            item.storagePath,
          );
          item.orderDigits = recovered.displayCode;
          item.aggregator = recovered.aggregator;
          item.label = `Pedido #${recovered.displayCode}`;
          await releaseCloudTicket?.(photo.id);
        }
      } catch (cloudError) {
        console.warn('No se pudo completar el OCR en la nube; la foto queda pendiente de revisión.', cloudError);
      }
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

    item.uploadAttempts = (item.uploadAttempts || 0) + 1;
    const isTransient = isTransientUploadError(error);

    if (isTransient && item.uploadAttempts <= 3) {
      item.status = 'pending';
      item.error = null;
      notify();
      await persist(item, { holdLease: false });
      return { yielded: true, transientRetry: true };
    }

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
