import {
  UPLOAD_QUEUE_CHANNEL,
  UPLOAD_QUEUE_MESSAGE,
  UPLOAD_QUEUE_SYNC_TAG,
} from './uploadQueueProtocol.js';

export async function requestBackgroundQueueProcessing(deps = globalThis) {
  const serviceWorker = deps.navigator?.serviceWorker;
  if (!serviceWorker) return false;

  try {
    const registration = await serviceWorker.ready;
    const worker = registration.active || serviceWorker.controller;
    if (!worker) return false;
    worker.postMessage({ type: UPLOAD_QUEUE_MESSAGE.process });
    if (registration.sync) {
      await registration.sync.register(UPLOAD_QUEUE_SYNC_TAG);
    }
    return true;
  } catch {
    return false;
  }
}

export function subscribeBackgroundQueueUpdates(onUpdate, deps = globalThis) {
  const serviceWorker = deps.navigator?.serviceWorker;
  const handleMessage = (event) => {
    if (event.data?.type === UPLOAD_QUEUE_MESSAGE.updated) onUpdate();
  };

  serviceWorker?.addEventListener?.('message', handleMessage);

  let channel = null;
  try {
    channel = new (deps.BroadcastChannel || BroadcastChannel)(UPLOAD_QUEUE_CHANNEL);
    channel.onmessage = handleMessage;
  } catch {
    channel = null;
  }

  return () => {
    serviceWorker?.removeEventListener?.('message', handleMessage);
    channel?.close?.();
  };
}

export async function notifyQueueProcessed(deps = globalThis) {
  try {
    const channel = new (deps.BroadcastChannel || BroadcastChannel)(UPLOAD_QUEUE_CHANNEL);
    channel.postMessage({ type: UPLOAD_QUEUE_MESSAGE.updated });
    channel.close();
  } catch {
    // BroadcastChannel no está en todos los runtimes
  }

  const clientsApi = deps.clients || deps.self?.clients;
  if (!clientsApi?.matchAll) return;
  const clients = await clientsApi.matchAll({ type: 'window', includeUncontrolled: true });
  for (const client of clients) {
    client.postMessage({ type: UPLOAD_QUEUE_MESSAGE.updated });
  }
}
