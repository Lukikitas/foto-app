import { useState } from 'react';
import { supabase } from '../lib/supabase';

export default function PhotoThumbnail({ photo, alt = '', className }) {
  const [failed, setFailed] = useState('');
  if (!photo.public_url) return null;
  const thumbnail = photo.thumbnail_path ? supabase.storage.from('photos').getPublicUrl(photo.thumbnail_path).data.publicUrl : '';
  const source = thumbnail && failed !== thumbnail ? thumbnail : photo.public_url;
  return <img src={source} alt={alt} className={className} loading="lazy" decoding="async" width="480" height="360"
    onError={() => { if (source === thumbnail) setFailed(thumbnail); }} />;
}
