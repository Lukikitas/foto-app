import { isAbortError, OCR_ENGINE_ERROR } from './tesseractAssets.js';
import { EVIDENCE_IMAGE_OPTIONS } from './compressImage.js';
import { buildStoragePath, isDocumentHidden, itemNeedsOcr } from './uploadQueueProtocol.js';
import { saveUnresolvedTicket } from './unresolvedTicketStore.js';
import { measurePerformance } from './performanceMetrics.js';
import { scheduleUploadRetry } from './uploadRetry.js';
import { recordReliability } from './reliabilityDiagnostics.js';

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
    onOcrError = (error) => console.error('No se pudo completar el OCR; se guarda la evidencia sin código.', error),
    retainUnresolvedTicket = saveUnresolvedTicket,
    keepTicketForRecovery,
    recoverOrderCodeInCloud,
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

  // createdAt del job = momento en que se encoló el par, recién sacadas las
  // fotos. La cola puede tardar minutos: esa es la hora que se guarda y se
  // muestra del pedido, no la del momento en que por fin sube.
  const capturedAt = Number.isFinite(item.createdAt)
    ? new Date(item.createdAt).toISOString()
    : null;

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
    if (itemNeedsOcr(item) && !item.uploadedPhoto) {
      item.status = 'analyzing';
      item.label = 'Leyendo el código…';
      notify();
      await persist(item);
      try {
        detectedOrder = await measurePerformance('queue.ocr', () => detectOrderFromPhoto(item.ticketFile, {
          signal,
          requireStrong: true,
          fallbackFiles: item.file?.type?.startsWith('image/') ? [item.file] : [],
        }));
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
        await persist(item);
      }
      if (yielded()) return yieldNow();
    }

    if (yielded()) return yieldNow();

    item.status = 'preparing';
    if (!item.orderDigits && item.kind === 'order') item.label = 'Preparando foto…';
    notify();
    await persist(item);

    const preparedFile = !item.uploadedPhoto && item.file?.type?.startsWith('image/')
      ? await measurePerformance('queue.compress', () => compressImage(item.file, item.kind === 'order' ? EVIDENCE_IMAGE_OPTIONS : undefined))
      : item.file;

    if (yielded()) return yieldNow();

    item.storagePath = buildStoragePath(item, preparedFile);
    item.status = 'uploading';
    if (item.orderDigits) {
      item.label = `Pedido #${item.orderDigits}`;
    } else if (!item.orderDigits && item.kind !== 'file') {
      item.label = 'Código no encontrado';
    }
    notify();
    await persist(item);

    let photo = item.uploadedPhoto;
    if (photo) {
      // Evidence and registration are already acknowledged. A ticket retry must
      // never repeat the evidence upload or recreate its database record.
    } else if (item.kind === 'file') {
      photo = await uploadFile(preparedFile, item.title, item.meta, item.storagePath, capturedAt, { signal, captureId: item.id });
    } else if (item.orderDigits) {
      photo = await uploadPhoto(
        preparedFile,
        item.orderDigits,
        item.meta,
        item.aggregator,
        item.storagePath,
        capturedAt,
        { signal, captureId: item.id },
      );
    } else if (detectedOrder?.aggregator) {
      photo = await uploadPhoto(
        preparedFile,
        detectedOrder.displayCode,
        item.meta,
        detectedOrder.aggregator,
        item.storagePath,
        capturedAt,
        { signal, captureId: item.id },
      );
    } else {
      photo = await uploadUnidentifiedOrder(preparedFile, item.meta, item.storagePath, capturedAt, { signal, captureId: item.id });
    }
    if (!photo?.id) throw new Error('El servidor no confirmó la foto. Conservá el pendiente.');
    item.uploadedPhoto = photo;
    await persist(item);

    if (item.ticketFile && !item.orderDigits && item.kind === 'order') {
      if (!photo?.id) throw new Error('No se pudo conservar el ticket sin identificar.');
      await retainUnresolvedTicket(photo.id, item.ticketFile);
    }
    if (item.ticketFile && item.kind === 'order' && !item.ticketUploaded && keepTicketForRecovery) {
      // Todos los pedidos conservan su ticket en Supabase durante 72 h para
      // poder verlo desde Editar, aunque el código ya se haya encontrado.
      // Un fallo (cuota, red, ventana) no detiene el resto del proceso.
      try {
        item.ticketUploaded = await keepTicketForRecovery(photo.id, item.ticketFile, { signal });
        if (!item.ticketUploaded && item.orderDigits) await retainUnresolvedTicket(photo.id, item.ticketFile);
        await persist(item);
      } catch (ticketError) {
        if (scheduleUploadRetry(item, ticketError)) {
          recordReliability('queue.retry', { attempt: item.retryAttempt, delay: item.nextAttemptAt - Date.now() });
          notify();
          await persist(item, { holdLease: false });
          return { retryScheduled: true, photo };
        }
        // Keep a recoverable local ticket even when a permanent quota or server
        // configuration error prevents its remote transfer.
        await retainUnresolvedTicket(photo.id, item.ticketFile);
        console.warn('No se pudo subir el ticket; la foto se sube igual.', ticketError);
      }
    }
    if (!item.orderDigits && item.kind === 'order' && photo?.id && recoverOrderCodeInCloud) {
      try {
        const recovered = await recoverOrderCodeInCloud(photo.id, { signal });
        if (recovered?.displayCode && recovered.reliable && recovered.aggregator) {
          photo = await uploadPhoto(
            preparedFile,
            recovered.displayCode,
            item.meta,
            recovered.aggregator,
            item.storagePath,
            capturedAt,
            { signal, captureId: item.id },
          );
          item.orderDigits = recovered.displayCode;
          item.aggregator = recovered.aggregator;
          item.label = `Pedido #${recovered.displayCode}`;
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
    if (scheduleUploadRetry(item, error)) {
      recordReliability('queue.retry', { attempt: item.retryAttempt, delay: item.nextAttemptAt - Date.now() });
      notify();
      await persist(item, { holdLease: false });
      return { retryScheduled: true };
    }
    recordReliability('queue.error');
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
