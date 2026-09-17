const UNIDENTIFIED_ORDER_NAME = 'Código no encontrado';

function isOrderPhoto(photo) {
  if (photo?.file_path?.startsWith('files/')) return false;
  if (photo?.file_path?.startsWith('orders/')) return true;
  return Boolean(photo?.name);
}

function isUnidentifiedOrder(photo) {
  return isOrderPhoto(photo) && photo?.name === UNIDENTIFIED_ORDER_NAME;
}

const TWO_HOURS = 2 * 60 * 60 * 1000;
const EIGHT_HOURS = 8 * 60 * 60 * 1000;
const TWELVE_HOURS = 12 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

export function compactCode(value = '') {
  return String(value)
    .toUpperCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Z0-9]/g, '');
}

export function digitTail(value = '', length) {
  const digits = String(value).replace(/\D/g, '');
  if (digits.length < length) return '';
  return digits.slice(-length);
}

const AGGREGATOR_PREFIX = /^(RAPPITURBO|PEYA|RAPPI|MPD)/;

function coreCode(value) {
  return compactCode(value).replace(AGGREGATOR_PREFIX, '');
}

/** Order id for partner-portal search: PEYA-2277060160 → 2277060160 */
export function clipboardOrderCode(value = '') {
  const compact = compactCode(value);
  const core = coreCode(value);
  return core || compact;
}

function digitBody(value) {
  return compactCode(value).replace(/\D/g, '');
}

export function codeMatchScore(complaintCode, photoName) {
  const complaint = compactCode(complaintCode);
  const photo = compactCode(photoName);
  if (!complaint || !photo) return 0;
  if (photo === compactCode(UNIDENTIFIED_ORDER_NAME)) return 0;

  if (complaint === photo) return 100;

  const complaintCore = coreCode(complaint);
  const photoCore = coreCode(photo);
  if (complaintCore && complaintCore === photoCore && complaintCore.length >= 4) {
    return 96;
  }

  const complaintDigits = digitBody(complaint);
  const photoDigits = digitBody(photo);
  if (complaintDigits && complaintDigits === photoDigits && complaintDigits.length >= 4) {
    return 92;
  }

  if (complaint.includes(photo) && photo.length >= 5) return 88;
  if (photo.includes(complaint) && complaint.length >= 5) return 88;

  if (complaintDigits.length >= 5 && photoDigits.length >= 5) {
    if (complaintDigits.endsWith(photoDigits) || photoDigits.endsWith(complaintDigits)) {
      return 88;
    }
  }

  if (digitTail(complaint, 6) && digitTail(complaint, 6) === digitTail(photo, 6)) return 75;
  if (digitTail(complaint, 4) && digitTail(complaint, 4) === digitTail(photo, 4)) return 40;

  return 0;
}

function minutesOfDay(date) {
  return date.getHours() * 60 + date.getMinutes();
}

function parseMinutes(timeOfDay) {
  if (!/^\d{2}:\d{2}$/.test(timeOfDay || '')) return null;
  const [hours, minutes] = timeOfDay.split(':').map(Number);
  return hours * 60 + minutes;
}

function circularMinuteDiff(a, b) {
  const diff = Math.abs(a - b);
  return Math.min(diff, 1440 - diff);
}

function timeAcceptable(photo, complaint, score) {
  if (score >= 85) return true;

  const photoAt = new Date(photo.created_at);
  if (Number.isNaN(photoAt.getTime())) return false;

  if (complaint.orderAtIso && !complaint.dateAssumed) {
    const orderAt = new Date(complaint.orderAtIso);
    if (Number.isNaN(orderAt.getTime())) return score >= 70;
    const delta = photoAt.getTime() - orderAt.getTime();
    if (score >= 70) return delta >= -TWELVE_HOURS && delta <= DAY_MS;
    return delta >= -TWO_HOURS && delta <= EIGHT_HOURS;
  }

  if (complaint.timeOfDay) {
    const target = parseMinutes(complaint.timeOfDay);
    if (target == null) return score >= 70;
    const diff = circularMinuteDiff(minutesOfDay(photoAt), target);
    const recentEnough = Date.now() - photoAt.getTime() <= 2 * DAY_MS;
    const assumedOk = !complaint.dateAssumed || recentEnough;
    if (score >= 70) return assumedOk;
    return assumedOk && diff <= 90;
  }

  return score >= 70;
}

function sortRanked(ranked, complaint) {
  return [...ranked].sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    if (!complaint.orderAtIso) return 0;
    const orderAt = new Date(complaint.orderAtIso).getTime();
    const aDelta = Math.abs(new Date(a.photo.created_at).getTime() - orderAt);
    const bDelta = Math.abs(new Date(b.photo.created_at).getTime() - orderAt);
    return aDelta - bDelta;
  });
}

function rankPhotos(complaint, photos) {
  const ranked = photos
    .filter((photo) => isOrderPhoto(photo) && !isUnidentifiedOrder(photo))
    .map((photo) => ({
      photo,
      score: codeMatchScore(complaint.orderCode, photo.name),
    }))
    .filter((item) => item.score > 0);

  const strong = ranked.filter((item) => item.score >= 85);
  if (strong.length > 0) return sortRanked(strong, complaint);

  const timed = ranked.filter((item) => timeAcceptable(item.photo, complaint, item.score));
  if (timed.length > 0) return sortRanked(timed, complaint);

  if (ranked.length === 1) return ranked;
  return [];
}

export function matchComplaintToPhotos(complaint, photos, pickedPhotoId = null) {
  if (pickedPhotoId) {
    const picked = photos.find((photo) => photo.id === pickedPhotoId);
    if (picked) {
      return {
        status: 'matched',
        photo: picked,
        candidates: [picked],
        score: 100,
      };
    }
  }

  const ranked = rankPhotos(complaint, photos);
  if (ranked.length === 0) {
    return { status: 'unmatched', photo: null, candidates: [], score: 0 };
  }

  const best = ranked[0];
  const runnerUp = ranked[1];
  const ambiguous =
    runnerUp &&
    best.score < 92 &&
    runnerUp.score >= 40 &&
    best.score - runnerUp.score < 15;

  if (ambiguous) {
    return {
      status: 'ambiguous',
      photo: null,
      candidates: ranked.slice(0, 4).map((item) => item.photo),
      score: best.score,
    };
  }

  return {
    status: 'matched',
    photo: best.photo,
    candidates: ranked.slice(0, 4).map((item) => item.photo),
    score: best.score,
  };
}

export function matchComplaintsToPhotos(complaints, photos, pickedPhotoIds = {}) {
  return complaints.map((complaint) => {
    const match = matchComplaintToPhotos(complaint, photos, pickedPhotoIds[complaint.id]);
    return { complaint, ...match };
  });
}

export function complaintRowStatus(row) {
  if (row.photo?.is_refutado) return 'refutado';
  if (row.status === 'matched') return 'con_foto';
  if (row.status === 'ambiguous') return 'ambiguo';
  return 'sin_foto';
}

export function mergeComplaintNotes(existing, complaint) {
  const reason = complaint.reason?.trim();
  const comment = complaint.comment?.trim();
  const block = [reason && `Reclamo: ${reason}`, comment].filter(Boolean).join('\n');
  const current = existing?.trim() || '';
  if (!block) return current || null;
  if (current.includes(block)) return current;
  if (reason && current.includes(`Reclamo: ${reason}`)) {
    return comment && !current.includes(comment)
      ? `${current}\n${comment}`.slice(0, 500)
      : current;
  }
  return [current, block].filter(Boolean).join('\n').slice(0, 500) || null;
}
