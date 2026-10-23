import { useState } from 'react';
import { isPhoneViewport } from '../lib/viewport';
export function useListPage(items, key, pageSize = isPhoneViewport() ? 30 : 100) {
  const [position,setPosition]=useState({key,page:1});
  const pageCount=Math.max(1,Math.ceil(items.length/pageSize));
  const page=position.key===key ? Math.max(1,Math.min(position.page,pageCount)) : 1;
  return {page,pageSize,pageCount,total:items.length,items:items.slice((page-1)*pageSize,page*pageSize),setPage:next=>setPosition({key,page:next})};
}
