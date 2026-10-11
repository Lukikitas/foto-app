import { supabase } from './supabase.js';
import { fetchPhotos, PHOTO_GALLERY_KINDS } from './photos.js';
import { loadCleanupRefs } from './photoCleanupStore.js';
import { storageSelection } from './storageAccounting.js';
import { loadPhotoCleanupSettings } from './photoCleanupSettings.js';
export { storageSelection, formatBytes } from './storageAccounting.js';

export async function loadStorageUsage() {
  const [photos,refs,retention]=await Promise.all([fetchPhotos({kind:PHOTO_GALLERY_KINDS.orders,columns:'id,name,file_path,public_url,created_at,has_complaint,is_refutado'}),loadCleanupRefs(),loadPhotoCleanupSettings()]);
  const selected=storageSelection(photos,refs,retention.retention_days);
  const {data,error}=await supabase.rpc('foto_storage_usage',{protected_paths:selected.protectedPaths,eligible_paths:selected.eligiblePaths});
  if(error)throw new Error(/PGRST202|42P01/.test(error.code||'')?'Falta activar la migración de almacenamiento de v1.11.':error.message);
  if(!data?.total)throw new Error('No se recibió el uso de almacenamiento.');
  return {...data,...selected,retention};
}
