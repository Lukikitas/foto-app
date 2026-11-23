export async function readPeyaFile(file) {
  if (!/\.xlsx$/i.test(file.name)) throw new Error('Seleccioná un archivo .xlsx de PedidosYa.');
  const data = await file.arrayBuffer();
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./peyaWorkbookWorker.js', import.meta.url), { type: 'module' });
    worker.onmessage = ({ data: result }) => {
      worker.terminate();
      if (result.error) reject(new Error(result.error));
      else resolve(result.report);
    };
    worker.onerror = () => { worker.terminate(); reject(new Error('No se pudo procesar el Excel. Volvé a seleccionar el archivo.')); };
    worker.postMessage(data, [data]);
  });
}
