export async function readPeyaRefundsFile(file) {
  if (!/\.xlsx?$/i.test(file.name)) throw new Error('Seleccioná el estado de cuenta de PedidosYa en formato .xls o .xlsx.');
  const data = await file.arrayBuffer();
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./peyaRefundsWorker.js', import.meta.url), { type: 'module' });
    worker.onmessage = ({ data: result }) => { worker.terminate(); if (result.error) reject(new Error(result.error)); else resolve(result.report); };
    worker.onerror = () => { worker.terminate(); reject(new Error('No se pudo procesar el estado de cuenta. Volvé a seleccionar el archivo.')); };
    worker.postMessage(data, [data]);
  });
}
