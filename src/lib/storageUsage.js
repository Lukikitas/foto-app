import { supabase } from './supabase.js';
import { withRequestTimeout } from './requestTimeout.js';
export { storageSelection, formatBytes } from './storageAccounting.js';

export async function loadStorageUsage() {
  const {data,error}=await withRequestTimeout(signal=>supabase.rpc('foto_storage_summary').abortSignal(signal));
  if(error)throw new Error(/PGRST202|42P01/.test(error.code||'')?'Falta activar la migración de almacenamiento de v1.11.':error.message);
  if(!data?.total)throw new Error('No se recibió el uso de almacenamiento.');
  return data;
}
