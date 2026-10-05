import { getPhotoAggregator } from './aggregators.js';
import { statusIsDisputed } from './complaintHistory.js';
import {
  deleteHistoryItemsByIds,
  importComplaintsToHistory,
  setHistoryResolution,
  setHistoryResolutions,
  syncGalleryComplaintToHistory,
} from './complaintHistoryStore.js';
import { applyComplaintToPhoto } from './complaints.js';
import { fetchPhotosByIds, isOrderPhoto, updatePhoto, updatePhotoDetails } from './photos.js';
import { runSynchronizedMutation } from './synchronizedMutation.js';

function metaFromPhoto(photo, overrides = {}) {
  return {
    notes: photo?.notes || '',
    taken_by: photo?.taken_by || '',
    has_complaint: Boolean(photo?.has_complaint),
    is_refutado: Boolean(photo?.is_refutado),
    ...overrides,
  };
}

async function restorePhotos(snapshots) {
  const restored = [];
  for (const photo of snapshots) {
    try {
      restored.push(await updatePhoto(
        photo.id,
        photo.name,
        metaFromPhoto(photo),
        getPhotoAggregator(photo),
      ));
    } catch (error) {
      console.error('No se pudo restaurar una foto después de un error de sincronización.', error);
    }
  }
  return restored;
}

function uniquePhotos(rows = []) {
  const photos = new Map();
  rows.forEach((row) => {
    if (row?.photo?.id) photos.set(row.photo.id, row.photo);
  });
  return [...photos.values()];
}

export async function markComplaintRows(rows = []) {
  const targets = [...new Map(
    rows.filter((row) => row?.photo?.id).map((row) => [row.photo.id, row]),
  ).values()];
  const snapshots = uniquePhotos(targets);
  const updated = [];
  try {
    for (let index = 0; index < targets.length; index += 8) {
      const chunk = targets.slice(index, index + 8);
      updated.push(...await Promise.all(chunk.map((row) => applyComplaintToPhoto(
        row.photo,
        row.complaint,
        { refutado: Boolean(row.photo.is_refutado) },
      ))));
    }
    return { updated, snapshots };
  } catch (error) {
    await restorePhotos(snapshots);
    throw error;
  }
}

export async function synchronizeRowsWithHistory(rows, writeHistory) {
  return runSynchronizedMutation({
    apply: () => markComplaintRows(rows),
    commit: async (marked) => ({ history: await writeHistory(), updatedPhotos: marked.updated }),
    rollback: (marked) => restorePhotos(marked.snapshots),
  });
}

export async function importComplaintsSynchronized(complaints, rows = []) {
  const synced = await synchronizeRowsWithHistory(
    rows,
    () => importComplaintsToHistory(complaints, rows),
  );
  return { ...synced.history, updatedPhotos: synced.updatedPhotos };
}

export async function updateGalleryPhotoWithComplaintSync(photo, changes) {
  const normalizedChanges = {
    ...changes,
    has_complaint: Boolean(changes.has_complaint),
    is_refutado: Boolean(changes.has_complaint && changes.is_refutado),
  };
  const updated = await updatePhotoDetails(photo, normalizedChanges);
  if (!isOrderPhoto(updated)) return { photo: updated, history: null };
  try {
    const history = await syncGalleryComplaintToHistory(updated);
    return { photo: updated, history };
  } catch (error) {
    let compensated = updated;
    try {
      compensated = await updatePhoto(
        updated.id,
        updated.name,
        metaFromPhoto(updated, {
          has_complaint: Boolean(photo.has_complaint),
          is_refutado: Boolean(photo.has_complaint && photo.is_refutado),
        }),
        getPhotoAggregator(updated),
      );
    } catch (rollbackError) {
      error.rollbackError = rollbackError;
    }
    error.updatedPhoto = compensated;
    throw error;
  }
}

async function loadRealPhotos(rows) {
  const known = uniquePhotos(rows).filter((photo) => photo.file_path);
  const knownIds = new Set(known.map((photo) => photo.id));
  const missingIds = uniquePhotos(rows)
    .map((photo) => photo.id)
    .filter((id) => id && !knownIds.has(id));
  const loaded = missingIds.length ? await fetchPhotosByIds(missingIds) : [];
  return [...known, ...loaded];
}

export async function deleteHistoryRowsSynchronized(rows = []) {
  const ids = [...new Set(rows.map((row) => row?.history?.id).filter(Boolean))];
  if (ids.length === 0) return { store: null, updatedPhotos: [] };
  const photos = await loadRealPhotos(rows);
  const cleared = [];
  try {
    for (const photo of photos) {
      cleared.push(await updatePhoto(
        photo.id,
        photo.name,
        metaFromPhoto(photo, { has_complaint: false, is_refutado: false }),
        getPhotoAggregator(photo),
      ));
    }
    const store = await deleteHistoryItemsByIds(ids);
    return { store, updatedPhotos: cleared };
  } catch (error) {
    await restorePhotos(photos);
    throw error;
  }
}

export async function setComplaintStatusSynchronized(row, status, { unrefutableReason, rejectionReason } = {}) {
  const photo = row?.photo?.id ? (await loadRealPhotos([row]))[0] : null;
  // Solo los estados disputados marcan la foto como refutada; «No refutable»
  // nunca entró en disputa, así que la foto no se marca is_refutado.
  const disputed = statusIsDisputed(status);
  let updatedPhoto = photo;
  if (photo) {
    updatedPhoto = await updatePhoto(
      photo.id,
      photo.name,
      metaFromPhoto(photo, { has_complaint: true, is_refutado: disputed }),
      getPhotoAggregator(photo),
    );
  }
  try {
    const history = await setHistoryResolution(
      row.complaint,
      updatedPhoto || row.photo,
      { status, unrefutableReason, rejectionReason },
    );
    return { history, updatedPhoto };
  } catch (error) {
    if (photo) await restorePhotos([photo]);
    throw error;
  }
}

export async function setComplaintStatusesSynchronized(rows, status, { unrefutableReason, rejectionReason } = {}) {
  const photos = await loadRealPhotos(rows);
  const disputed = statusIsDisputed(status);
  const updatedPhotos = [];
  try {
    for (const photo of photos) {
      updatedPhotos.push(await updatePhoto(
        photo.id,
        photo.name,
        metaFromPhoto(photo, { has_complaint: true, is_refutado: disputed }),
        getPhotoAggregator(photo),
      ));
    }
    const byId = new Map(updatedPhotos.map((photo) => [photo.id, photo]));
    const resolvedRows = rows.map((row) => ({
      ...row,
      photo: byId.get(row.photo?.id) || row.photo,
    }));
    const history = await setHistoryResolutions(resolvedRows, { status, unrefutableReason, rejectionReason });
    return { history, updatedPhotos };
  } catch (error) {
    await restorePhotos(photos);
    throw error;
  }
}
