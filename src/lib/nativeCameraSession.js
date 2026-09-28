import { supabase } from './supabase.js';

export const NATIVE_PROTOCOL_VERSION = 1;
export const NATIVE_PACKAGE_NAME = 'ar.com.starapp.fotoappcamera';
export const NATIVE_SCHEME = 'fotoapp';
export const NATIVE_FALLBACK_URL = 'https://delivery.star-app.com.ar/instalar-camara';
export const NATIVE_RETURN_URL_PREFIX = 'https://delivery.star-app.com.ar/camera-return';
export const STORAGE_SESSION_KEY = 'foto_app_native_camera_session';
export const STORAGE_SESSIONS_KEY = 'foto_app_native_camera_sessions';
export const NATIVE_SESSIONS_CHANGED_EVENT = 'foto-app-native-sessions-changed';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isNativeCameraFeatureEnabled() {
  if (typeof window !== 'undefined') {
    const preference = localStorage.getItem('foto_app_native_camera_enabled');
    if (preference === 'false') return false;
    if (preference === 'true') return true;
  }
  if (typeof import.meta !== 'undefined') {
    const envVal = import.meta.env?.VITE_NATIVE_CAMERA_ENABLED;
    if (envVal === 'false' || envVal === false) return false;
  }
  return true;
}

export function isValidSessionId(value) {
  return typeof value === 'string' && UUID_REGEX.test(value.trim());
}

export function isValidSessionToken(value) {
  return typeof value === 'string' && /^[0-9a-fA-F]{64}$/.test(value.trim());
}

export function generateCryptoToken(byteLength = 32) {
  if (typeof crypto === 'undefined' || !crypto.getRandomValues) {
    throw new Error('La API criptográfica no está disponible en este entorno.');
  }
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

export async function hashTokenSha256(token) {
  if (typeof crypto === 'undefined' || !crypto.subtle?.digest) {
    throw new Error('SubtleCrypto no está disponible en este entorno.');
  }
  const encoder = new TextEncoder();
  const data = encoder.encode(token.trim());
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function buildNativeCameraIntentUri({
  sessionId,
  sessionToken,
  protocolVersion = NATIVE_PROTOCOL_VERSION,
  fallbackUrl = NATIVE_FALLBACK_URL,
}) {
  if (!isValidSessionId(sessionId)) {
    throw new Error('Identificador de sesión inválido para crear el Intent.');
  }
  if (!isValidSessionToken(sessionToken)) {
    throw new Error('Token secreto de sesión inválido para crear el Intent.');
  }

  const encodedFallback = encodeURIComponent(fallbackUrl);
  return `intent://capture/${sessionId}#Intent;scheme=${NATIVE_SCHEME};package=${NATIVE_PACKAGE_NAME};S.sessionToken=${sessionToken};i.protocolVersion=${protocolVersion};S.browser_fallback_url=${encodedFallback};end`;
}

export function parseReturnSessionFromUrl(url = window.location.href) {
  try {
    const parsed = new URL(url);
    const sessionId = parsed.searchParams.get('session');
    if (sessionId && isValidSessionId(sessionId)) {
      return sessionId;
    }
  } catch {
    // Ignore URL parse error
  }
  return null;
}

function validStoredSession(session) {
  return session && isValidSessionId(session.sessionId) && isValidSessionToken(session.sessionToken);
}

export function getStoredNativeSessions() {
  if (typeof localStorage === 'undefined') return [];
  let stored = [];
  let legacy = null;
  try { stored = JSON.parse(localStorage.getItem(STORAGE_SESSIONS_KEY) || '[]'); } catch { /* Ignore corrupt list. */ }
  try { legacy = JSON.parse(localStorage.getItem(STORAGE_SESSION_KEY) || 'null'); } catch { /* Ignore corrupt legacy record. */ }
  const byId = new Map();
  for (const session of Array.isArray(stored) ? stored : []) {
    if (validStoredSession(session)) byId.set(session.sessionId, session);
  }
  if (validStoredSession(legacy)) byId.set(legacy.sessionId, legacy);
  return [...byId.values()].sort((left, right) => (left.createdAt || 0) - (right.createdAt || 0));
}

export function getStoredNativeSession() {
  return getStoredNativeSessions().at(-1) || null;
}

export function saveStoredNativeSession(session) {
  if (!session) return clearStoredNativeSession();
  if (!validStoredSession(session)) throw new Error('Sesión Android inválida.');
  if (typeof localStorage === 'undefined') throw new Error('El navegador no permite guardar la sesión de la cámara.');
  const sessions = getStoredNativeSessions().filter((entry) => entry.sessionId !== session.sessionId);
  sessions.push(session);
  localStorage.setItem(STORAGE_SESSIONS_KEY, JSON.stringify(sessions));
  localStorage.setItem(STORAGE_SESSION_KEY, JSON.stringify(session));
  notifyNativeSessionsChanged();
}

function notifyNativeSessionsChanged() {
  if (typeof window !== 'undefined' && typeof Event === 'function') {
    window.dispatchEvent(new Event(NATIVE_SESSIONS_CHANGED_EVENT));
  }
}

export function clearStoredNativeSession(sessionId = null) {
  if (typeof localStorage === 'undefined') return;
  if (!sessionId) {
    localStorage.removeItem(STORAGE_SESSIONS_KEY);
    localStorage.removeItem(STORAGE_SESSION_KEY);
    return;
  }
  const sessions = getStoredNativeSessions().filter((entry) => entry.sessionId !== sessionId);
  if (sessions.length) {
    localStorage.setItem(STORAGE_SESSIONS_KEY, JSON.stringify(sessions));
    localStorage.setItem(STORAGE_SESSION_KEY, JSON.stringify(sessions.at(-1)));
  } else {
    clearStoredNativeSession();
  }
}

export function getReusableNativeSession(takenBy, now = Date.now()) {
  const author = (takenBy || '').trim().toLocaleLowerCase();
  const session = getStoredNativeSessions().findLast((entry) =>
    entry.takenBy?.trim().toLocaleLowerCase() === author
    && Number.isFinite(Date.parse(entry.expiresAt))
    && Date.parse(entry.expiresAt) > now);
  return session ? {
    ...session,
    intentUri: buildNativeCameraIntentUri(session),
  } : null;
}

export async function createNativeSession(takenBy, options = {}) {
  const author = (takenBy || '').trim();
  if (!author) {
    throw new Error('Poné quién está sacando la foto antes de abrir la cámara.');
  }

  const sessionId = crypto.randomUUID();
  const sessionToken = generateCryptoToken(32);
  const tokenHash = await hashTokenSha256(sessionToken);
  const protocolVersion = options.protocolVersion || NATIVE_PROTOCOL_VERSION;

  const { data, error } = await supabase.rpc('create_native_capture_session', {
    p_session_id: sessionId,
    p_token_hash: tokenHash,
    p_taken_by: author,
    p_protocol_version: protocolVersion,
    p_expires_in_minutes: options.expiresInMinutes || 120,
  });

  if (error) {
    throw new Error(error.message || 'No se pudo crear la sesión para la cámara nativa.');
  }

  const sessionRecord = {
    sessionId,
    sessionToken,
    tokenHash,
    takenBy: author,
    protocolVersion,
    createdAt: Date.now(),
    expiresAt: data.expiresAt,
  };

  saveStoredNativeSession(sessionRecord);

  const intentUri = buildNativeCameraIntentUri({
    sessionId,
    sessionToken,
    protocolVersion,
    fallbackUrl: options.fallbackUrl || NATIVE_FALLBACK_URL,
  });

  return {
    ...sessionRecord,
    intentUri,
  };
}

export async function fetchNativeSessionPairs(sessionId, sessionToken) {
  if (!isValidSessionId(sessionId) || !isValidSessionToken(sessionToken)) {
    throw new Error('Parámetros de sesión inválidos.');
  }
  const tokenHash = await hashTokenSha256(sessionToken);

  const { data, error } = await supabase.rpc('get_native_session_pairs', {
    p_session_id: sessionId,
    p_token_hash: tokenHash,
  });

  if (error) {
    throw new Error(error.message || 'No se pudo consultar el estado de la sesión en la cámara.');
  }

  return data;
}

export async function markNativePairsAsImported(sessionId, sessionToken, pairIds) {
  if (!isValidSessionId(sessionId) || !isValidSessionToken(sessionToken)) {
    throw new Error('Parámetros de sesión inválidos.');
  }
  if (!Array.isArray(pairIds) || pairIds.length === 0) {
    return { markedCount: 0, remainingPending: 0 };
  }

  const tokenHash = await hashTokenSha256(sessionToken);

  const { data, error } = await supabase.rpc('mark_native_pairs_imported', {
    p_session_id: sessionId,
    p_token_hash: tokenHash,
    p_pair_ids: pairIds,
  });

  if (error) {
    throw new Error(error.message || 'No se pudieron marcar los pares como importados.');
  }

  return data;
}
