begin;
insert into storage.objects(bucket_id,name) values('photos','orders/mobile/11111111-1111-4111-8111-111111111111.jpg');
do $$
declare first public.photos%rowtype; second public.photos%rowtype;
begin
  first := public.register_photo_capture('11111111-1111-4111-8111-111111111111',
    'orders/mobile/11111111-1111-4111-8111-111111111111.jpg','https://example.test/photo',
    'Código no encontrado','Equipo',null,'2026-10-29T12:00:00Z');
  update public.photos set name='PEYA1234567890',taken_by='Corregido' where id=first.id;
  second := public.register_photo_capture('11111111-1111-4111-8111-111111111111',
    'orders/mobile/11111111-1111-4111-8111-111111111111.jpg','https://example.test/photo',
    'Código no encontrado','Equipo',null,'2026-10-29T12:00:00Z');
  if first.id <> second.id or second.name <> 'PEYA1234567890' or second.taken_by <> 'Corregido' then
    raise exception 'Retry duplicated capture or overwrote manual correction';
  end if;
  if (select count(*) from public.photos where capture_id=first.capture_id) <> 1 then raise exception 'Duplicate'; end if;
  begin
    perform public.register_photo_capture('22222222-2222-4222-8222-222222222222',
      'orders/mobile/22222222-2222-4222-8222-222222222222.jpg','https://example.test/photo',
      'Código no encontrado','Equipo',null,'2026-10-29T12:00:00Z');
    raise exception 'Missing evidence accepted';
  exception when no_data_found then null;
  end;
  if has_function_privilege('anon','public.register_photo_capture(uuid,text,text,text,text,text,timestamptz)','execute') then
    raise exception 'Anonymous bypasses capture endpoint';
  end if;
end $$;
rollback;
