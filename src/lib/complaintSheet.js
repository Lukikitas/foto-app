import { detectOrderCode } from './orderCode.js';
import { toDateInputValue } from './date.js';

const CODE_HEADERS = [
  'codigo',
  'codigo_pedido',
  'codigo_de_pedido',
  'codigo_del_pedido',
  'nro_pedido',
  'n_pedido',
  'numero_pedido',
  'numero_de_pedido',
  'id_pedido',
  'pedido',
  'orden',
  'order',
  'order_id',
  'order_code',
];

const DATETIME_HEADERS = [
  'fecha_hora',
  'fecha_y_hora',
  'fechahora',
  'datetime',
  'timestamp',
  'hora_pedido',
  'fecha_pedido',
];

const DATE_HEADERS = ['fecha', 'date', 'dia', 'fecha_del_pedido', 'fecha_de_pedido'];
const TIME_HEADERS = ['hora', 'horario', 'time', 'hora_del_pedido', 'hs'];
const REASON_HEADERS = [
  'motivo',
  'motivo_reclamo',
  'motivo_del_reclamo',
  'motivo_de_la_queja',
  'reason',
  'tipo',
  'tipo_reclamo',
  'queja',
  'reclamo',
];
const COMMENT_HEADERS = [
  'comentario',
  'comentarios',
  'comment',
  'observaciones',
  'detalle',
  'detalles',
  'notas',
  'descripcion',
  'descripcion_reclamo',
];
const AMOUNT_HEADERS = [
  'monto',
  'importe',
  'reembolso',
  'reintegro',
  'devolucion',
  'valor',
  'total',
  'amount',
  'refund',
  'pesos',
  'ars',
  'precio',
  'costo',
  'monto_reembolsado',
  'monto_devuelto',
  'importe_reembolso',
];
const COMBO_HEADERS = [
  'combo',
  'producto',
  'item',
  'articulo',
  'plato',
  'sku',
  'menu',
  'producto_reclamado',
  'combo_reclamado',
];

const DATE_DMY =
  /^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})(?:[ T,]+(\d{1,2})[.:](\d{2})(?::(\d{2}))?)?(?:\s*(HS|HRS|HS\.))?$/i;
const DATE_YMD =
  /^(\d{4})-(\d{2})-(\d{2})(?:[ T]+(\d{1,2})[.:](\d{2})(?::(\d{2}))?)?$/;
const TIME_ONLY =
  /^(\d{1,2})[.:](\d{2})(?::(\d{2}))?\s*(HS|HRS|HS\.|AM|PM|A\.?\s*M\.?|P\.?\s*M\.?)?$/i;

function normalizeHeader(value = '') {
  return String(value)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '');
}

function pad2(value) {
  return String(value).padStart(2, '0');
}

function fullYear(yearToken) {
  const year = Number(yearToken);
  if (yearToken.length === 2) return year >= 70 ? 1900 + year : 2000 + year;
  return year;
}

function withMeridiem(hour, meridiem) {
  const flag = String(meridiem || '').replace(/\./g, '').replace(/\s+/g, '').toUpperCase();
  if (flag === 'PM' || flag === 'P M' || flag === 'PM') {
    return hour % 12 + 12;
  }
  if (flag === 'AM' || flag === 'A M' || flag === 'AM') {
    return hour % 12;
  }
  return hour;
}

function toIsoLocal(year, month, day, hour = 0, minute = 0, second = 0) {
  const date = new Date(year, month - 1, day, hour, minute, second);
  if (Number.isNaN(date.getTime())) return null;
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) {
    return null;
  }
  return date.toISOString();
}

export function parseSheetDateTime(value) {
  if (value == null || String(value).trim() === '') {
    return { orderAtIso: null, timeOfDay: null, dateAssumed: false };
  }

  const numeric = Number(String(value).trim().replace(',', '.'));
  if (Number.isFinite(numeric) && numeric > 20000 && numeric < 80000) {
    const utc = new Date(Math.round((numeric - 25569) * 86400 * 1000));
    if (!Number.isNaN(utc.getTime())) {
      return {
        orderAtIso: utc.toISOString(),
        timeOfDay: `${pad2(utc.getHours())}:${pad2(utc.getMinutes())}`,
        dateAssumed: false,
      };
    }
  }

  const text = String(value).trim();

  const ymd = text.match(DATE_YMD);
  if (ymd) {
    const hour = ymd[4] == null ? 0 : Number(ymd[4]);
    const minute = ymd[5] == null ? 0 : Number(ymd[5]);
    const second = ymd[6] == null ? 0 : Number(ymd[6]);
    const iso = toIsoLocal(Number(ymd[1]), Number(ymd[2]), Number(ymd[3]), hour, minute, second);
    return {
      orderAtIso: iso,
      timeOfDay: ymd[4] == null ? null : `${pad2(hour)}:${pad2(minute)}`,
      dateAssumed: false,
    };
  }

  const dmy = text.match(DATE_DMY);
  if (dmy) {
    const hour = dmy[4] == null ? 0 : Number(dmy[4]);
    const minute = dmy[5] == null ? 0 : Number(dmy[5]);
    const second = dmy[6] == null ? 0 : Number(dmy[6]);
    const iso = toIsoLocal(
      fullYear(dmy[3]),
      Number(dmy[2]),
      Number(dmy[1]),
      hour,
      minute,
      second,
    );
    return {
      orderAtIso: iso,
      timeOfDay: dmy[4] == null ? null : `${pad2(hour)}:${pad2(minute)}`,
      dateAssumed: false,
    };
  }

  const time = text.match(TIME_ONLY);
  if (time) {
    const hour = withMeridiem(Number(time[1]), time[3]);
    const minute = Number(time[2]);
    if (hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59) {
      return {
        orderAtIso: null,
        timeOfDay: `${pad2(hour)}:${pad2(minute)}`,
        dateAssumed: true,
      };
    }
  }

  return { orderAtIso: null, timeOfDay: null, dateAssumed: false };
}

export function parseMoneyAmount(value) {
  if (value == null || value === '') return null;
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || value < 0) return null;
    return Math.round(value * 100) / 100;
  }

  const text = String(value).trim();
  if (!text || /[/-]/.test(text)) return null;

  let cleaned = text.replace(/\s/g, '');
  if (/[a-z]/i.test(cleaned) && !/(ars|usd|pesos)/i.test(cleaned)) return null;
  cleaned = cleaned
    .replace(/^(ars|usd|pesos)/i, '')
    .replace(/(ars|usd|pesos)$/i, '')
    .replace(/^[$€]/, '')
    .replace(/[$€]$/, '');
  if (!cleaned || !/^\d{1,3}([.,]\d{3})*([.,]\d{1,2})?$|^\d+([.,]\d{1,2})?$/.test(cleaned)) {
    return null;
  }

  const hasDot = cleaned.includes('.');
  const hasComma = cleaned.includes(',');
  if (hasDot && hasComma) {
    cleaned =
      cleaned.lastIndexOf(',') > cleaned.lastIndexOf('.')
        ? cleaned.replace(/\./g, '').replace(',', '.')
        : cleaned.replace(/,/g, '');
  } else if (hasComma) {
    const parts = cleaned.split(',');
    cleaned =
      parts.length === 2 && parts[1].length <= 2
        ? `${parts[0]}.${parts[1]}`
        : cleaned.replace(/,/g, '');
  } else if (hasDot) {
    const parts = cleaned.split('.');
    if (parts.length > 2 || (parts.length === 2 && parts[1].length === 3)) {
      cleaned = cleaned.replace(/\./g, '');
    }
  }

  const number = Number(cleaned);
  if (!Number.isFinite(number) || number < 0) return null;
  return Math.round(number * 100) / 100;
}

function looksLikeMoneyCell(value) {
  const text = String(value || '').trim();
  if (!text) return false;
  if (/[$€]|ars|pesos/i.test(text)) return parseMoneyAmount(text) != null;
  if (/[.,]\d{1,2}$/.test(text.replace(/\s/g, ''))) return parseMoneyAmount(text) != null;
  const amount = parseMoneyAmount(text);
  if (amount == null || amount === 0) return false;
  const asDate = parseSheetDateTime(text);
  if (asDate.orderAtIso) return false;
  if (parseComplaintOrderCode(text) && !/[.,]/.test(text)) return false;
  return true;
}

export function parseComplaintOrderCode(value) {
  const text = String(value || '').trim();
  if (!text) return '';

  const asDate = parseSheetDateTime(text);
  if (asDate.orderAtIso || (asDate.timeOfDay && !/[A-Z]{3,}/i.test(text))) {
    const detectedOnDate = detectOrderCode(text);
    return detectedOnDate?.displayCode || '';
  }

  const scientific = text.match(/^(\d+(?:[.,]\d+)?)[eE]\+?(\d+)$/);
  if (scientific) {
    const number = Number(text.replace(',', '.'));
    if (Number.isFinite(number) && number >= 1e4 && number < 1e13) {
      return String(Math.round(number));
    }
  }

  const cleaned = text
    .replace(/^(?:pedido|nro|nº|n°|orden|id|#)\s*[:.-]?\s*/i, '')
    .replace(/\.0+$/, '')
    .trim();

  const detected = detectOrderCode(cleaned) || detectOrderCode(text);
  if (detected?.displayCode) return detected.displayCode;

  const compact = cleaned.toUpperCase().replace(/[^A-Z0-9-]/g, '');
  if (/^(?:PEYA|RAPPI(?:TURBO)?|MPD)[A-Z0-9-]{3,28}$/.test(compact)) {
    return compact;
  }

  const digits = cleaned.replace(/\D/g, '');
  if (digits.length >= 4 && digits.length <= 12) return digits;
  return '';
}

function looksLikeHeaderRow(cells) {
  const mapped = cells.map((cell) => classifyHeader(cell)).filter(Boolean);
  return mapped.includes('orderCode') || mapped.length >= 2;
}

function classifyHeader(value) {
  const raw = String(value || '').trim();
  const header = normalizeHeader(value);
  if (/^\$+$/i.test(raw) || raw.toLowerCase() === 'ars') return 'amount';
  if (!header) return null;
  if (CODE_HEADERS.includes(header) || header.includes('codigo')) return 'orderCode';
  if (DATETIME_HEADERS.includes(header)) return 'datetime';
  if (DATE_HEADERS.includes(header) || header.startsWith('fecha')) return 'date';
  if (TIME_HEADERS.includes(header) || header.startsWith('hora')) return 'time';
  if (
    AMOUNT_HEADERS.includes(header) ||
    header.includes('monto') ||
    header.includes('importe') ||
    header.includes('reembolso') ||
    header.includes('reintegro')
  ) {
    return 'amount';
  }
  if (
    COMBO_HEADERS.includes(header) ||
    header.includes('combo') ||
    header.includes('producto') ||
    header.includes('articulo')
  ) {
    return 'combo';
  }
  if (REASON_HEADERS.includes(header) || header.includes('motivo') || header.includes('queja')) {
    return 'reason';
  }
  if (COMMENT_HEADERS.includes(header) || header.includes('coment') || header.includes('observ')) {
    return 'comment';
  }
  return null;
}

function detectDelimiter(text) {
  const firstLine = text.split(/\r?\n/, 1)[0] || '';
  const counts = {
    '\t': (firstLine.match(/\t/g) || []).length,
    ';': (firstLine.match(/;/g) || []).length,
    ',': (firstLine.match(/,/g) || []).length,
  };
  if (counts['\t'] > 0 && counts['\t'] >= counts[';'] && counts['\t'] >= counts[',']) return '\t';
  if (counts[';'] > counts[',']) return ';';
  if (counts[','] > 0) return ',';
  return '\t';
}

export function parseDelimitedText(text, delimiter = detectDelimiter(text)) {
  const rows = [];
  let row = [];
  let cell = '';
  let inQuotes = false;
  const source = String(text || '').replace(/^\uFEFF/, '');

  const pushRow = () => {
    if (row.some((value) => String(value).trim())) {
      rows.push(row);
    }
    row = [];
  };

  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    const next = source[index + 1];

    if (inQuotes) {
      if (char === '"') {
        if (next === '"') {
          cell += '"';
          index += 1;
        } else {
          inQuotes = false;
        }
      } else {
        cell += char;
      }
      continue;
    }

    if (char === '"') {
      inQuotes = true;
      continue;
    }

    if (char === '\r') {
      if (next === '\n') continue;
      row.push(cell);
      cell = '';
      pushRow();
      continue;
    }

    if (char === '\n') {
      row.push(cell);
      cell = '';
      pushRow();
      continue;
    }

    if (char === delimiter) {
      row.push(cell);
      cell = '';
      continue;
    }

    cell += char;
  }

  row.push(cell);
  pushRow();
  return rows;
}

function columnScores(rows, columnCount) {
  const scores = Array.from({ length: columnCount }, () => ({
    code: 0,
    datetime: 0,
    text: 0,
    money: 0,
  }));

  rows.slice(0, 20).forEach((row) => {
    for (let index = 0; index < columnCount; index += 1) {
      const value = String(row[index] || '').trim();
      if (!value) continue;
      if (parseComplaintOrderCode(value)) scores[index].code += 1;
      const parsed = parseSheetDateTime(value);
      if (parsed.orderAtIso || parsed.timeOfDay) scores[index].datetime += 1;
      if (looksLikeMoneyCell(value)) scores[index].money += 1;
      if (value.length >= 8 && !parseComplaintOrderCode(value) && !parsed.orderAtIso && !looksLikeMoneyCell(value)) {
        scores[index].text += 1;
      }
    }
  });

  return scores;
}

function pickBestIndex(scores, key, used) {
  let best = -1;
  let bestScore = 0;
  scores.forEach((score, index) => {
    if (used.has(index)) return;
    if (score[key] > bestScore) {
      best = index;
      bestScore = score[key];
    }
  });
  return bestScore > 0 ? best : -1;
}

function emptyMapping() {
  return {
    orderCode: -1,
    datetime: -1,
    date: -1,
    time: -1,
    reason: -1,
    comment: -1,
    amount: -1,
    combo: -1,
  };
}

function inferMapping(rows, columnCount) {
  const scores = columnScores(rows, columnCount);
  const used = new Set();
  const mapping = emptyMapping();
  mapping.orderCode = pickBestIndex(scores, 'code', used);
  if (mapping.orderCode >= 0) used.add(mapping.orderCode);
  mapping.datetime = pickBestIndex(scores, 'datetime', used);
  if (mapping.datetime >= 0) used.add(mapping.datetime);
  mapping.amount = pickBestIndex(scores, 'money', used);
  if (mapping.amount >= 0) used.add(mapping.amount);

  const leftover = [];
  for (let index = 0; index < columnCount; index += 1) {
    if (used.has(index)) continue;
    const hasValue = rows
      .slice(0, 20)
      .some((row) => String(row[index] || '').trim());
    if (hasValue) leftover.push(index);
  }

  mapping.reason = leftover[0] ?? -1;
  mapping.comment = leftover[1] ?? -1;
  return mapping;
}

function mappingFromHeaders(headers) {
  const mapping = emptyMapping();

  headers.forEach((header, index) => {
    const kind = classifyHeader(header);
    if (!kind || mapping[kind] >= 0) return;
    mapping[kind] = index;
  });

  return mapping;
}

function cell(row, index) {
  if (index == null || index < 0) return '';
  return String(row[index] ?? '').trim();
}

function combineDateTime(dateValue, timeValue) {
  const datePart = parseSheetDateTime(dateValue);
  const timePart = parseSheetDateTime(timeValue);
  if (datePart.orderAtIso && timePart.timeOfDay && !String(dateValue).match(/\d{1,2}[.:]\d{2}/)) {
    const dateOnly = toDateInputValue(new Date(datePart.orderAtIso));
    return parseSheetDateTime(`${dateOnly.split('-').reverse().join('/')} ${timePart.timeOfDay}`);
  }
  if (datePart.orderAtIso) return datePart;
  if (timePart.orderAtIso) return timePart;
  if (timePart.timeOfDay) return timePart;
  return datePart;
}

function complaintId(code, when, reason, index) {
  return [code, when, reason, index].map((part) => String(part || '')).join('|');
}

function mappedIndexes(mapping) {
  return new Set(Object.values(mapping).filter((index) => Number.isInteger(index) && index >= 0));
}

function collectFields(row, headers, mapping) {
  const used = mappedIndexes(mapping);
  const fields = {};
  const count = Math.max(row.length, headers.length);
  for (let index = 0; index < count; index += 1) {
    if (used.has(index)) continue;
    const value = cell(row, index);
    if (!value) continue;
    const key = String(headers[index] || '').trim() || `Columna ${index + 1}`;
    fields[key] = value;
  }
  return fields;
}

function buildComplaint(row, mapping, index, headers = []) {
  const orderCode = parseComplaintOrderCode(cell(row, mapping.orderCode));
  const reason = cell(row, mapping.reason);
  const comment = cell(row, mapping.comment);
  const combo = cell(row, mapping.combo);
  const amount = parseMoneyAmount(cell(row, mapping.amount));
  const when =
    mapping.datetime >= 0
      ? parseSheetDateTime(cell(row, mapping.datetime))
      : combineDateTime(cell(row, mapping.date), cell(row, mapping.time));

  if (!orderCode && !reason && !comment && amount == null && !combo) return null;

  return {
    id: complaintId(orderCode, when.orderAtIso || when.timeOfDay, reason, index),
    orderCode,
    orderAtIso: when.orderAtIso,
    timeOfDay: when.timeOfDay,
    dateAssumed: Boolean(when.dateAssumed && !when.orderAtIso),
    reason,
    comment,
    combo,
    amount,
    fields: collectFields(row, headers, mapping),
  };
}

export function parseComplaintSheet(text) {
  const rows = parseDelimitedText(text);
  if (rows.length === 0) {
    return { complaints: [], skipped: 0, usedHeaders: false };
  }

  const headerRow = rows[0];
  const hasHeaders = looksLikeHeaderRow(headerRow);
  const dataRows = hasHeaders ? rows.slice(1) : rows;
  const headers = hasHeaders ? headerRow : [];
  const columnCount = rows.reduce((max, row) => Math.max(max, row.length), 0);
  const mapping = hasHeaders ? mappingFromHeaders(headerRow) : inferMapping(dataRows, columnCount);

  if (mapping.orderCode < 0 || mapping.amount < 0) {
    const inferred = inferMapping(dataRows, columnCount);
    if (mapping.orderCode < 0) mapping.orderCode = inferred.orderCode;
    if (mapping.datetime < 0 && mapping.date < 0 && mapping.time < 0) {
      mapping.datetime = inferred.datetime;
    }
    if (mapping.reason < 0) mapping.reason = inferred.reason;
    if (mapping.comment < 0) mapping.comment = inferred.comment;
    if (mapping.amount < 0) mapping.amount = inferred.amount;
  }

  const complaints = [];
  let skipped = 0;

  dataRows.forEach((row, index) => {
    const complaint = buildComplaint(row, mapping, index, headers);
    if (!complaint) {
      skipped += 1;
      return;
    }
    if (!complaint.orderCode) {
      skipped += 1;
      return;
    }
    complaints.push(complaint);
  });

  return { complaints, skipped, usedHeaders: hasHeaders };
}

export function parseGoogleSheetRef(input) {
  const text = String(input || '').trim();
  if (!text) return { id: '', publishedId: '', gid: '0' };

  const published = text.match(/spreadsheets\/d\/e\/([a-zA-Z0-9-_]+)/);
  const idMatch = text.match(/spreadsheets\/d\/(?!e\/)([a-zA-Z0-9-_]+)/);
  const gidMatch = text.match(/[?#&]gid=(\d+)/) || text.match(/gid=(\d+)/);

  return {
    id: idMatch ? idMatch[1] : '',
    publishedId: published ? published[1] : '',
    gid: gidMatch ? gidMatch[1] : '0',
  };
}

export function toGoogleCsvUrl(input) {
  const text = String(input || '').trim();
  if (!text) return '';

  const { id, publishedId, gid } = parseGoogleSheetRef(text);
  if (publishedId) {
    return `https://docs.google.com/spreadsheets/d/e/${publishedId}/pub?output=csv&gid=${gid}`;
  }
  if (id) {
    return `https://docs.google.com/spreadsheets/d/${id}/export?format=csv&gid=${gid}`;
  }
  if (/^https?:\/\//i.test(text)) return text;
  return '';
}

export function toGoogleGvizUrl(input, callbackName) {
  const { id, gid } = parseGoogleSheetRef(input);
  if (!id) return '';
  const tqx = callbackName
    ? `out:json;responseHandler:${callbackName}`
    : 'out:json';
  return `https://docs.google.com/spreadsheets/d/${id}/gviz/tq?gid=${encodeURIComponent(gid)}&tqx=${encodeURIComponent(tqx)}`;
}

function cellText(cell) {
  if (!cell) return '';
  if (cell.f != null && String(cell.f).trim() !== '') return String(cell.f);
  const value = cell.v;
  if (value == null) return '';
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    const date = `${String(value.getDate()).padStart(2, '0')}/${String(value.getMonth() + 1).padStart(2, '0')}/${value.getFullYear()}`;
    const time = `${String(value.getHours()).padStart(2, '0')}:${String(value.getMinutes()).padStart(2, '0')}`;
    return value.getHours() || value.getMinutes() ? `${date} ${time}` : date;
  }
  return String(value);
}

export function gvizTableToTsv(table) {
  const cols = table?.cols || [];
  const headers = cols.map((col) => col.label || col.id || '');
  const rows = (table?.rows || []).map((row) => {
    const cells = row?.c || [];
    return cols.map((_, index) => cellText(cells[index])).join('\t');
  });
  return [headers.join('\t'), ...rows].join('\n');
}

async function fetchGoogleSheetViaJsonp(input) {
  if (typeof document === 'undefined') return '';
  const { id } = parseGoogleSheetRef(input);
  if (!id) return '';

  const callbackName = `fotoAppSheet_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const src = toGoogleGvizUrl(input, callbackName);
  const table = await new Promise((resolve, reject) => {
    let settled = false;
    let script;
    let timer;

    function cleanup() {
      window.clearTimeout(timer);
      delete window[callbackName];
      script?.remove();
    }

    window[callbackName] = (payload) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (payload?.status && payload.status !== 'ok') {
        reject(
          new Error(
            'El Sheet no se pudo leer. Compartilo con “Cualquier persona con el enlace”.',
          ),
        );
        return;
      }
      if (!payload?.table) {
        reject(new Error('El Sheet no devolvió una tabla.'));
        return;
      }
      resolve(payload.table);
    };

    timer = window.setTimeout(() => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new Error('Se agotó el tiempo leyendo el Google Sheet.'));
    }, 15000);

    script = document.createElement('script');
    script.src = src;
    script.async = true;
    script.onerror = () => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new Error('No se pudo cargar el Google Sheet.'));
    };
    document.head.appendChild(script);
  });

  return gvizTableToTsv(table);
}

export async function fetchComplaintSheetText(url) {
  const csvUrl = toGoogleCsvUrl(url);
  if (!csvUrl && !parseGoogleSheetRef(url).id) {
    throw new Error('Pegá el link del Google Sheet o cargá el CSV.');
  }

  if (csvUrl) {
    try {
      const response = await fetch(csvUrl);
      if (response.ok) {
        const text = await response.text();
        if (text.trim()) return text;
      }
    } catch {
      // CORS: el navegador bloquea el CSV; pasamos a la API pública de Google.
    }
  }

  const tsv = await fetchGoogleSheetViaJsonp(url);
  if (tsv.trim()) return tsv;

  throw new Error(
    'No se pudo leer el Sheet desde la web. Compartilo con “Cualquier persona con el enlace” o copiá las celdas.',
  );
}
