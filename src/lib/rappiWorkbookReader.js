import { assertRappiAccount } from './rappiWorkbook.js';
export async function readRappiFile(file, aggregator) {
  assertRappiAccount(aggregator);
  if (!/\.xlsx$/i.test(file.name)) throw new Error('Seleccioná un archivo .xlsx de Rappi.');
  const buffer = await file.arrayBuffer();
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./rappiWorkbookWorker.js', import.meta.url), { type: 'module' });
    worker.onmessage = ({ data }) => { worker.terminate(); if (data.error) reject(new Error(data.error)); else resolve(data.report); };
    worker.onerror = () => { worker.terminate(); reject(new Error('No se pudo procesar el Excel. Volvé a seleccionar el archivo.')); };
    worker.postMessage({ buffer, aggregator }, [buffer]);
  });
}
