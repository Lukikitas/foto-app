begin;

do $$
declare
  v_legacy public.native_capture_sessions;
  v_new jsonb;
begin
  select * into v_legacy from public.native_capture_sessions
  where id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  if v_legacy.expires_at < now() + interval '6 days'
     or v_legacy.upload_expires_at < now() + interval '6 days'
     or v_legacy.recovery_expires_at < now() + interval '6 days' then
    raise exception 'A legacy session was not extended for recovery';
  end if;

  if exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'create_native_capture_session'
      and p.pronargs = 6
  ) then
    raise exception 'Ambiguous six-argument session overload remains';
  end if;

  v_new := public.create_native_capture_session(
    'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    'New fixture', 1, 60
  );
  if (v_new->>'expiresAt')::timestamptz < now() + interval '6 days'
     or (v_new->>'recoveryExpiresAt')::timestamptz < now() + interval '6 days' then
    raise exception 'A new session still expires after the requested 60 minutes';
  end if;
end $$;

rollback;
