-- Migration: Native Android Camera Auxiliary Sessions and Pairs
-- Protocol version: 1
-- Description: Idempotent tables and secure RPC functions for native camera sessions.

create table if not exists public.native_capture_sessions (
  id uuid primary key default gen_random_uuid(),
  token_hash text not null,
  taken_by text not null,
  protocol_version integer not null default 1,
  native_app_version text,
  device_model text,
  state text not null default 'created' check (state in ('created', 'active', 'finishing', 'completed', 'cancelled', 'expired')),
  pair_count integer not null default 0 check (pair_count >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  finished_at timestamptz,
  expires_at timestamptz not null
);

create table if not exists public.native_capture_pairs (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.native_capture_sessions(id) on delete cascade,
  pair_number integer not null check (pair_number >= 1),
  ticket_path text not null,
  evidence_path text not null,
  ticket_hash text,
  evidence_hash text,
  selected_lens text,
  state text not null default 'uploaded' check (state in ('local', 'preparing', 'uploading', 'uploaded', 'imported', 'error', 'discarded')),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  uploaded_at timestamptz not null default now(),
  imported_at timestamptz,
  error_message text,
  constraint native_capture_pairs_session_pair_unique unique (session_id, pair_number)
);

create index if not exists idx_native_sessions_state on public.native_capture_sessions(state);
create index if not exists idx_native_pairs_session on public.native_capture_pairs(session_id, state);

alter table public.native_capture_sessions enable row level security;
alter table public.native_capture_pairs enable row level security;

revoke all on public.native_capture_sessions, public.native_capture_pairs from anon, authenticated;

-- Storage bucket for native capture uploads
insert into storage.buckets (id, name, public)
values ('native-captures', 'native-captures', false)
on conflict (id) do nothing;

-- 1. Create session from PWA
create or replace function public.create_native_capture_session(
  p_session_id uuid,
  p_token_hash text,
  p_taken_by text,
  p_protocol_version integer default 1,
  p_expires_in_minutes integer default 120
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_session public.native_capture_sessions;
  v_expires_at timestamptz;
begin
  if p_session_id is null or p_token_hash is null or p_token_hash = '' or p_taken_by is null or p_taken_by = '' then
    raise exception 'Parámetros inválidos para iniciar la sesión nativa.';
  end if;

  v_expires_at := now() + (coalesce(p_expires_in_minutes, 120) || ' minutes')::interval;

  insert into public.native_capture_sessions (
    id,
    token_hash,
    taken_by,
    protocol_version,
    state,
    expires_at
  )
  values (
    p_session_id,
    p_token_hash,
    trim(p_taken_by),
    coalesce(p_protocol_version, 1),
    'created',
    v_expires_at
  )
  on conflict (id) do update
    set token_hash = excluded.token_hash,
        taken_by = excluded.taken_by,
        expires_at = excluded.expires_at,
        updated_at = now()
    where public.native_capture_sessions.state = 'created'
  returning * into v_session;

  return jsonb_build_object(
    'sessionId', v_session.id,
    'takenBy', v_session.taken_by,
    'protocolVersion', v_session.protocol_version,
    'state', v_session.state,
    'expiresAt', v_session.expires_at
  );
end;
$$;

-- 2. Validate session and activate it from Android App
create or replace function public.activate_native_capture_session(
  p_session_id uuid,
  p_token_hash text,
  p_native_app_version text default null,
  p_device_model text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_session public.native_capture_sessions;
begin
  select * into v_session
  from public.native_capture_sessions
  where id = p_session_id and token_hash = p_token_hash
  for update;

  if not found then
    raise exception 'Sesión inválida o no autorizada.';
  end if;

  if v_session.expires_at <= now() then
    update public.native_capture_sessions set state = 'expired', updated_at = now() where id = p_session_id;
    raise exception 'La sesión ha expirado.';
  end if;

  if v_session.state in ('completed', 'cancelled') then
    raise exception 'La sesión ya no está activa (estado: %).', v_session.state;
  end if;

  update public.native_capture_sessions
  set state = 'active',
      native_app_version = coalesce(p_native_app_version, native_app_version),
      device_model = coalesce(p_device_model, device_model),
      updated_at = now()
  where id = p_session_id
  returning * into v_session;

  return jsonb_build_object(
    'sessionId', v_session.id,
    'takenBy', v_session.taken_by,
    'protocolVersion', v_session.protocol_version,
    'state', v_session.state,
    'pairCount', v_session.pair_count,
    'expiresAt', v_session.expires_at
  );
end;
$$;

-- 3. Register uploaded pair from Android App
create or replace function public.register_native_capture_pair(
  p_session_id uuid,
  p_token_hash text,
  p_pair_number integer,
  p_ticket_path text,
  p_evidence_path text,
  p_ticket_hash text default null,
  p_evidence_hash text default null,
  p_selected_lens text default null,
  p_metadata jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_session public.native_capture_sessions;
  v_pair public.native_capture_pairs;
begin
  select * into v_session
  from public.native_capture_sessions
  where id = p_session_id and token_hash = p_token_hash
  for update;

  if not found then
    raise exception 'Sesión no autorizada.';
  end if;

  if v_session.expires_at <= now() then
    raise exception 'La sesión ha expirado.';
  end if;

  if v_session.state not in ('active', 'finishing') then
    raise exception 'La sesión no acepta más fotos (estado: %).', v_session.state;
  end if;

  -- Ensure paths reside strictly within the session folder
  if not (p_ticket_path like p_session_id || '/%') or not (p_evidence_path like p_session_id || '/%') then
    raise exception 'Ruta de archivo no autorizada para esta sesión.';
  end if;

  insert into public.native_capture_pairs (
    session_id,
    pair_number,
    ticket_path,
    evidence_path,
    ticket_hash,
    evidence_hash,
    selected_lens,
    state,
    metadata,
    uploaded_at
  )
  values (
    p_session_id,
    p_pair_number,
    p_ticket_path,
    p_evidence_path,
    p_ticket_hash,
    p_evidence_hash,
    p_selected_lens,
    'uploaded',
    coalesce(p_metadata, '{}'::jsonb),
    now()
  )
  on conflict (session_id, pair_number) do update
    set ticket_path = excluded.ticket_path,
        evidence_path = excluded.evidence_path,
        ticket_hash = coalesce(excluded.ticket_hash, public.native_capture_pairs.ticket_hash),
        evidence_hash = coalesce(excluded.evidence_hash, public.native_capture_pairs.evidence_hash),
        selected_lens = coalesce(excluded.selected_lens, public.native_capture_pairs.selected_lens),
        metadata = coalesce(excluded.metadata, public.native_capture_pairs.metadata),
        state = 'uploaded',
        uploaded_at = now()
  returning * into v_pair;

  update public.native_capture_sessions
  set pair_count = (select count(*) from public.native_capture_pairs where session_id = p_session_id),
      updated_at = now()
  where id = p_session_id;

  return jsonb_build_object(
    'pairId', v_pair.id,
    'sessionId', v_pair.session_id,
    'pairNumber', v_pair.pair_number,
    'state', v_pair.state
  );
end;
$$;

-- 4. Finish session from Android App
create or replace function public.finish_native_capture_session(
  p_session_id uuid,
  p_token_hash text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_session public.native_capture_sessions;
begin
  select * into v_session
  from public.native_capture_sessions
  where id = p_session_id and token_hash = p_token_hash
  for update;

  if not found then
    raise exception 'Sesión inválida.';
  end if;

  update public.native_capture_sessions
  set state = case when state = 'completed' then 'completed' else 'finishing' end,
      finished_at = coalesce(finished_at, now()),
      updated_at = now()
  where id = p_session_id
  returning * into v_session;

  return jsonb_build_object(
    'sessionId', v_session.id,
    'state', v_session.state,
    'pairCount', v_session.pair_count
  );
end;
$$;

-- 5. List uploaded pairs for PWA import (authenticated by session_id and token_hash, or session_id if owned by local PWA token)
create or replace function public.get_native_session_pairs(
  p_session_id uuid,
  p_token_hash text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_session public.native_capture_sessions;
  v_pairs jsonb;
begin
  select * into v_session
  from public.native_capture_sessions
  where id = p_session_id and token_hash = p_token_hash;

  if not found then
    raise exception 'Sesión no encontrada o credenciales no válidas.';
  end if;

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'id', p.id,
      'pairNumber', p.pair_number,
      'ticketPath', p.ticket_path,
      'evidencePath', p.evidence_path,
      'ticketHash', p.ticket_hash,
      'evidenceHash', p.evidence_hash,
      'selectedLens', p.selected_lens,
      'state', p.state,
      'createdAt', p.created_at,
      'uploadedAt', p.uploaded_at,
      'importedAt', p.imported_at,
      'metadata', p.metadata
    ) order by p.pair_number asc
  ), '[]'::jsonb)
  into v_pairs
  from public.native_capture_pairs p
  where p.session_id = p_session_id;

  return jsonb_build_object(
    'sessionId', v_session.id,
    'takenBy', v_session.taken_by,
    'state', v_session.state,
    'pairCount', v_session.pair_count,
    'pairs', v_pairs
  );
end;
$$;

-- 6. Mark pairs as imported after PWA enqueues them durably
create or replace function public.mark_native_pairs_imported(
  p_session_id uuid,
  p_token_hash text,
  p_pair_ids uuid[]
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_session public.native_capture_sessions;
  v_count integer;
  v_pending integer;
begin
  select * into v_session
  from public.native_capture_sessions
  where id = p_session_id and token_hash = p_token_hash
  for update;

  if not found then
    raise exception 'Sesión no autorizada.';
  end if;

  update public.native_capture_pairs
  set state = 'imported',
      imported_at = now()
  where session_id = p_session_id and id = any(p_pair_ids);

  get diagnostics v_count = row_count;

  -- If all pairs are imported and session was finishing, mark session completed
  select count(*) into v_pending
  from public.native_capture_pairs
  where session_id = p_session_id and state <> 'imported';

  if v_pending = 0 and v_session.state = 'finishing' then
    update public.native_capture_sessions set state = 'completed', updated_at = now() where id = p_session_id;
  end if;

  return jsonb_build_object(
    'sessionId', p_session_id,
    'markedCount', v_count,
    'remainingPending', v_pending
  );
end;
$$;

-- Revoke public execution, grant to anon and service_role
revoke all on function public.create_native_capture_session(uuid, text, text, integer, integer) from public;
revoke all on function public.activate_native_capture_session(uuid, text, text, text) from public;
revoke all on function public.register_native_capture_pair(uuid, text, integer, text, text, text, text, text, jsonb) from public;
revoke all on function public.finish_native_capture_session(uuid, text) from public;
revoke all on function public.get_native_session_pairs(uuid, text) from public;
revoke all on function public.mark_native_pairs_imported(uuid, text, uuid[]) from public;

grant execute on function public.create_native_capture_session(uuid, text, text, integer, integer) to anon, service_role;
grant execute on function public.activate_native_capture_session(uuid, text, text, text) to anon, service_role;
grant execute on function public.register_native_capture_pair(uuid, text, integer, text, text, text, text, text, jsonb) to anon, service_role;
grant execute on function public.finish_native_capture_session(uuid, text) to anon, service_role;
grant execute on function public.get_native_session_pairs(uuid, text) to anon, service_role;
grant execute on function public.mark_native_pairs_imported(uuid, text, uuid[]) to anon, service_role;
