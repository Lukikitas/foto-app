begin;
insert into public.photos(id,name,has_complaint,is_refutado,notes)
values('11111111-1111-1111-1111-111111111111','test',false,true,'Keep this note');
set local role anon;
do $$
declare h jsonb; m jsonb; d jsonb; saved jsonb; conflict boolean; draft_key uuid;
begin
  h := public.foto_document_read('history','{"items":{}}');
  m := public.foto_document_read('metrics','{"days":{}}');
  if public.foto_legacy_document_writable('photos','complaints/history.json') then raise exception 'Old clients must not write obsolete history'; end if;
  if not public.foto_legacy_document_writable('photos','orders/test.jpg') then raise exception 'Photo storage must remain writable'; end if;
  d := public.foto_draft_action('create',payload=>' {"complaints":[{"orderCode":"test"}]}');
  draft_key := (d->>'id')::uuid;
  conflict := false;
  begin perform public.foto_draft_action('create',payload=>'{"complaints":[]}'); exception when others then conflict:=true; end;
  if not conflict then raise exception 'Two active drafts were allowed'; end if;
  d := public.foto_draft_action('update',draft_key,1,'{"complaints":[]}');
  conflict := false;
  begin perform public.foto_draft_action('update',draft_key,1,'{"complaints":[]}'); exception when others then conflict:=sqlerrm like '%REVISION_CONFLICT%'; end;
  if not conflict then raise exception 'Stale draft edit was accepted'; end if;
  conflict := false;
  begin
    perform public.foto_documents_commit('[{"key":"history","revision":1,"data":{"items":{"failed":true}}},{"key":"metrics","revision":999,"data":{}}]',draft_key,2);
  exception when others then conflict:=sqlerrm like '%REVISION_CONFLICT%'; end;
  if not conflict then raise exception 'Stale metrics revision was accepted'; end if;
  if public.foto_document_read('history')->'data'->'items' <> '{}'::jsonb then raise exception 'Partial write escaped rollback'; end if;
  if public.foto_draft_action('read')->>'state' <> 'pending' then raise exception 'Failed draft was cleared'; end if;
  saved := public.foto_documents_commit('[{"key":"history","revision":1,"data":{"items":{"saved":true}}},{"key":"metrics","revision":1,"data":{"days":{"count":10}}}]',draft_key,2,'["11111111-1111-1111-1111-111111111111"]','{"added":1}');
  if public.foto_draft_action('read') is not null then raise exception 'Successful draft was not cleared'; end if;
  saved := public.foto_documents_commit('[]',draft_key,2);
  if saved->>'alreadySaved' <> 'true' then raise exception 'Retry was not idempotent'; end if;
  conflict := false;
  begin perform public.foto_documents_commit('[{"key":"history","revision":1,"data":{}}]'); exception when others then conflict:=sqlerrm like '%REVISION_CONFLICT%'; end;
  if not conflict then raise exception 'A second device overwrote a newer document'; end if;
  d := public.foto_draft_action('create',payload=>'{"complaints":[]}');
  perform public.foto_draft_action('discard',(d->>'id')::uuid,1);
  if public.foto_document_read('history')->'data'->'items'->>'saved' <> 'true' then raise exception 'Discard changed history'; end if;
end $$;
reset role;
do $$ begin
  if not exists(select 1 from public.photos where id='11111111-1111-1111-1111-111111111111' and has_complaint and is_refutado and notes='Keep this note') then
    raise exception 'Photo flags were not preserved';
  end if;
end $$;
rollback;
