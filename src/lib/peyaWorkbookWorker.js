import { read } from '../vendor/xlsx.mjs';
import { parsePeyaWorkbook, PEYA_SHEETS } from './peyaWorkbook.js';
self.onmessage = ({ data }) => {
  try {
    const book = read(data, { type: 'array', sheets: PEYA_SHEETS, cellDates: false, cellStyles: false, cellFormula: true });
    self.postMessage({ report: parsePeyaWorkbook(book) });
  } catch (error) { self.postMessage({ error: error.message || 'No se pudo leer el Excel.' }); }
};
