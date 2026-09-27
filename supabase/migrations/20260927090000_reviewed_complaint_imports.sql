-- v1.5: versioned shared documents and one review queue.
-- Existing JSON files remain as read-only migration backups.
create table if not exists public.foto_app_documents (
  key text primary key check (key in ('history', 'metrics')),
  revision bigint not null default 1,
  data jsonb not null,
  updated_at timestamptz not null default now()
);
create table if not exists public.complaint_drafts (
  id uuid primary key default gen_random_uuid(),
  revision bigint not null default 1,
  state text not null default 'pending' check (state in ('pending','saved','discarded')),
  data jsonb not null,
  result jsonb,
  updated_at timestamptz not null default now()
);
create unique index if not exists complaint_drafts_one_pending on public.complaint_drafts ((state)) where state = 'pending';
alter table public.foto_app_documents enable row level security;
alter table public.complaint_drafts enable row level security;
revoke all on public.foto_app_documents, public.complaint_drafts from anon, authenticated;

create or replace function public.foto_document_read(document_key text, initial_data jsonb default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare doc public.foto_app_documents;
begin
  if document_key not in ('history','metrics') then raise exception 'Documento inválido'; end if;
  if initial_data is not null then
    insert into public.foto_app_documents(key,data) values(document_key, initial_data) on conflict do nothing;
  end if;
  select * into doc from public.foto_app_documents where key=document_key;
  if not found then return null; end if;
  return to_jsonb(doc);
end;
$$;
create or replace function public.foto_documents_commit(changes jsonb, draft_id uuid default null, draft_revision bigint default null, photo_ids jsonb default '[]', commit_result jsonb default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare change jsonb; doc public.foto_app_documents; draft public.complaint_drafts; result jsonb := '[]';
begin
  -- Consistent lock order serializes commits and makes the whole import atomic.
  perform pg_advisory_xact_lock(hashtext('foto-app-documents'));
  if draft_id is not null then
    select * into draft from public.complaint_drafts where id=draft_id for update;
    if not found then raise exception 'Lista no encontrada'; end if;
    if draft.state='saved' then return jsonb_build_object('alreadySaved',true,'result',draft.result); end if;
    if draft.state <> 'pending' or draft.revision <> draft_revision then
      raise exception 'REVISION_CONFLICT: La lista cambió en otro dispositivo.';
    end if;
  end if;
  if jsonb_typeof(changes) <> 'array' then raise exception 'Cambios inválidos'; end if;
  for change in select value from jsonb_array_elements(changes) loop
    select * into doc from public.foto_app_documents where key=change->>'key' for update;
    if not found or doc.revision <> (change->>'revision')::bigint then
      raise exception 'REVISION_CONFLICT: Los datos cambiaron. Volvé a intentar.';
    end if;
    if jsonb_typeof(change->'data') <> 'object' then raise exception 'Documento inválido'; end if;
    update public.foto_app_documents set data=change->'data',revision=revision+1,updated_at=now()
      where key=doc.key returning * into doc;
    result := result || jsonb_build_array(to_jsonb(doc));
  end loop;
  if draft_id is not null then
    -- Preserve the latest dispute status and all other photo metadata.
    update public.photos set has_complaint=true
      where id::text in (select jsonb_array_elements_text(photo_ids));
    update public.complaint_drafts set state='saved',revision=revision+1,result=commit_result,updated_at=now() where id=draft_id;
  end if;
  return jsonb_build_object('documents',result,'result',commit_result);
end;
$$;
create or replace function public.foto_draft_action(action text, draft_id uuid default null, expected_revision bigint default null, payload jsonb default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare draft public.complaint_drafts;
begin
  perform pg_advisory_xact_lock(hashtext('foto-app-documents'));
  if action='read' then
    select * into draft from public.complaint_drafts where state='pending';
    if not found then return null; end if;
  elsif action='create' then
    if exists(select 1 from public.complaint_drafts where state='pending') then raise exception 'Ya hay una lista pendiente. Guardala o descartala primero.'; end if;
    if jsonb_typeof(payload->'complaints') <> 'array' then raise exception 'Lista inválida'; end if;
    insert into public.complaint_drafts(data) values(payload) returning * into draft;
  elsif action in ('update','discard') then
    select * into draft from public.complaint_drafts where id=draft_id for update;
    if not found or draft.state <> 'pending' or draft.revision <> expected_revision then
      raise exception 'REVISION_CONFLICT: La lista cambió en otro dispositivo.';
    end if;
    if action='update' then
      if jsonb_typeof(payload->'complaints') <> 'array' then raise exception 'Lista inválida'; end if;
      update public.complaint_drafts set data=payload,revision=revision+1,updated_at=now() where id=draft_id returning * into draft;
    else
      update public.complaint_drafts set state='discarded',revision=revision+1,updated_at=now() where id=draft_id returning * into draft;
    end if;
  else raise exception 'Acción inválida';
  end if;
  return to_jsonb(draft);
end;
$$;
revoke all on function public.foto_document_read(text,jsonb), public.foto_documents_commit(jsonb,uuid,bigint,jsonb,jsonb), public.foto_draft_action(text,uuid,bigint,jsonb) from public;
-- This app already permits shared operations to its anonymous client. Do not
-- expose service-role keys; future authentication can narrow these grants.
grant execute on function public.foto_document_read(text,jsonb), public.foto_documents_commit(jsonb,uuid,bigint,jsonb,jsonb), public.foto_draft_action(text,uuid,bigint,jsonb) to anon, service_role;

-- Once a document is migrated, an old open v1.4 client must not keep writing
-- to its obsolete JSON copy. Reads and unrelated storage objects are unchanged.
create or replace function public.foto_legacy_document_writable(object_bucket text, object_name text)
returns boolean language sql stable security definer set search_path = public as $$
  select not exists (
    select 1 from public.foto_app_documents where object_bucket='photos' and
      ((key='history' and object_name='complaints/history.json') or
       (key='metrics' and object_name='metrics/dashboard.json'))
  );
$$;
revoke all on function public.foto_legacy_document_writable(text,text) from public;
grant execute on function public.foto_legacy_document_writable(text,text) to anon;
do $$ begin
  if not exists(select 1 from pg_policies where schemaname='storage' and policyname='foto_v15_legacy_insert') then
    create policy foto_v15_legacy_insert on storage.objects as restrictive for insert to anon
      with check (public.foto_legacy_document_writable(bucket_id,name));
    create policy foto_v15_legacy_update on storage.objects as restrictive for update to anon
      using (public.foto_legacy_document_writable(bucket_id,name))
      with check (public.foto_legacy_document_writable(bucket_id,name));
    create policy foto_v15_legacy_delete on storage.objects as restrictive for delete to anon
      using (public.foto_legacy_document_writable(bucket_id,name));
  end if;
end $$;
