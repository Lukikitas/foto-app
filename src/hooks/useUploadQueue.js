import { useEffect, useState } from 'react';
import { subscribe } from '../lib/uploadQueue';

export function useUploadQueue() {
  const [items, setItems] = useState([]);

  useEffect(() => subscribe(setItems), []);

  return items;
}
