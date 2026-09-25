import { read } from '../vendor/xlsx.mjs';
import { parsePeyaRefunds, REFUNDS_SHEET } from './peyaRefunds.js';
self.onmessage = ({ data }) => {
  try {
    const workbook = read(data, { type: 'array', sheets: [REFUNDS_SHEET], cellDates: false, cellFormula: true, cellStyles: false });
    self.postMessage({ report: parsePeyaRefunds(workbook) });
  } catch (error) { self.postMessage({ error: error.message || 'No se pudo leer el archivo de reintegros.' }); }
};
