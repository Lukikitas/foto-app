-- Migration: Extend recovery window and separate upload deadline from pair recovery
-- Ensures existing pairs locked after 120 minutes can be safely recovered within 7 days.

alter table public.native_capture_sessions
  add column if not exists upload_expires_at timestamptz,
  add column if not exists recovery_expires_at timestamptz;

-- Existing test sessions retain their original deadline. Only sessions created
-- after this migration receive the new seven-day window.

-- 1. Create native capture session with separate upload and recovery deadlines
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
  v_upload_expires_at timestamptz;
  v_recovery_expires_at timestamptz;
begin
  if p_session_id is null or p_token_hash is null or p_token_hash = '' or p_taken_by is null or p_taken_by = '' then
    raise exception 'Parámetros inválidos para iniciar la sesión nativa.';
  end if;

  v_upload_expires_at := now() + greatest(coalesce(p_expires_in_minutes, 120), 10080) * interval '1 minute';
  v_recovery_expires_at := greatest(v_upload_expires_at, now() + interval '7 days');

  insert into public.native_capture_sessions (
    id,
    token_hash,
    taken_by,
    protocol_version,
    state,
    expires_at,
    upload_expires_at,
    recovery_expires_at
  )
  values (
    p_session_id,
    p_token_hash,
    trim(p_taken_by),
    coalesce(p_protocol_version, 1),
    'created',
    v_upload_expires_at,
    v_upload_expires_at,
    v_recovery_expires_at
  )
  on conflict (id) do update
    set token_hash = excluded.token_hash,
        taken_by = excluded.taken_by,
        expires_at = excluded.expires_at,
        upload_expires_at = excluded.upload_expires_at,
        recovery_expires_at = excluded.recovery_expires_at,
        updated_at = now()
    where public.native_capture_sessions.state = 'created'
  returning * into v_session;

  return jsonb_build_object(
    'sessionId', v_session.id,
    'takenBy', v_session.taken_by,
    'protocolVersion', v_session.protocol_version,
    'state', v_session.state,
    'expiresAt', v_session.expires_at,
    'uploadExpiresAt', v_session.upload_expires_at,
    'recoveryExpiresAt', v_session.recovery_expires_at
  );
end;
$$;

-- 2. Validate and activate session from Android app (checks upload deadline)
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
  v_upload_expires timestamptz;
begin
  select * into v_session
  from public.native_capture_sessions
  where id = p_session_id and token_hash = p_token_hash
  for update;

  if not found then
    raise exception 'Sesión inválida o no autorizada.';
  end if;

  v_upload_expires := coalesce(v_session.upload_expires_at, v_session.expires_at);
  if v_upload_expires <= now() then
    update public.native_capture_sessions set state = 'expired', updated_at = now() where id = p_session_id;
    raise exception 'El plazo para capturar en esta sesión ha expirado.';
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
    'expiresAt', v_session.expires_at,
    'uploadExpiresAt', v_session.upload_expires_at,
    'recoveryExpiresAt', v_session.recovery_expires_at
  );
end;
$$;

-- 3. Register uploaded pair (checks upload deadline)
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
  v_upload_expires timestamptz;
begin
  select * into v_session
  from public.native_capture_sessions
  where id = p_session_id and token_hash = p_token_hash
  for update;

  if not found then
    raise exception 'Sesión no autorizada.';
  end if;

  v_upload_expires := coalesce(v_session.upload_expires_at, v_session.expires_at);
  if v_upload_expires <= now() then
    raise exception 'El plazo para subir nuevas capturas ha expirado.';
  end if;

  if v_session.state not in ('active', 'finishing') then
    raise exception 'La sesión no acepta más fotos (estado: %).', v_session.state;
  end if;

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

-- 4. Get native session pairs: uses recovery_expires_at so existing pairs can be recovered for 7 days
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
  v_recovery_expires timestamptz;
begin
  select * into v_session
  from public.native_capture_sessions
  where id = p_session_id and token_hash = p_token_hash;

  if not found then
    raise exception 'Sesión no encontrada o credenciales no válidas.';
  end if;

  v_recovery_expires := coalesce(v_session.recovery_expires_at, v_session.expires_at);
  if v_recovery_expires <= now() then
    raise exception 'El plazo de recuperación para esta sesión ha expirado.';
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
    'pairs', v_pairs,
    'uploadExpiresAt', v_session.upload_expires_at,
    'recoveryExpiresAt', v_session.recovery_expires_at
  );
end;
$$;

grant execute on function public.create_native_capture_session(uuid, text, text, integer, integer) to anon, service_role;
grant execute on function public.activate_native_capture_session(uuid, text, text, text) to anon, service_role;
grant execute on function public.register_native_capture_pair(uuid, text, integer, text, text, text, text, text, jsonb) to anon, service_role;
grant execute on function public.get_native_session_pairs(uuid, text) to anon, service_role;
