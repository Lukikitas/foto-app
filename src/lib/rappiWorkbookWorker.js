import { read } from '../vendor/xlsx.mjs';
import { parseRappiWorkbook, RAPPI_SHEET } from './rappiWorkbook.js';
self.onmessage = ({ data }) => {
  try {
    const book = read(data.buffer, { type: 'array', sheets: [RAPPI_SHEET], cellDates: false, cellStyles: false, cellFormula: true });
    self.postMessage({ report: parseRappiWorkbook(book, data.aggregator) });
  } catch (error) { self.postMessage({ error: error.message || 'No se pudo leer el Excel.' }); }
};
