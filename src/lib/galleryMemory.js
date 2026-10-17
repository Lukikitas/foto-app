export function mergeGalleryPhoto(items,photo,{limit=1000,selectedIds=new Set()}={}) {
  const next=items.filter(item=>item.id!==photo.id);next.push(photo);
  next.sort((a,b)=>String(b.created_at).localeCompare(String(a.created_at)));
  if(next.length<=limit)return next;
  const selected=next.filter(item=>selectedIds.has(item.id));
  const retained=new Set(selected.map(item=>item.id));
  const result=[...selected];
  for(const item of next){if(result.length>=Math.max(limit,selected.length))break;if(!retained.has(item.id)){result.push(item);retained.add(item.id);}}
  return result.sort((a,b)=>String(b.created_at).localeCompare(String(a.created_at)));
}
