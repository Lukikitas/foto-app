begin;
set local role anon;

do $$
declare
  v_session_id uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  v_token_hash text := 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';
  v_wrong_hash text := 'ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff';
  v_session jsonb;
  v_activated jsonb;
  v_pair1 jsonb;
  v_pair2 jsonb;
  v_listed jsonb;
  v_finished jsonb;
  v_imported jsonb;
  v_error_caught boolean;
begin
  -- 1. Create native capture session
  v_session := public.create_native_capture_session(v_session_id, v_token_hash, 'Lucas Fotógrafo', 1, 60);
  if v_session->>'state' <> 'created' or v_session->>'takenBy' <> 'Lucas Fotógrafo' then
    raise exception 'Sesión no se creó con estado inicial correcto';
  end if;

  -- 2. Reject activation with wrong token hash
  v_error_caught := false;
  begin
    perform public.activate_native_capture_session(v_session_id, v_wrong_hash, '1.0.0', 'POCO X6 Pro');
  exception when others then
    v_error_caught := true;
  end;
  if not v_error_caught then
    raise exception 'Se permitió activación con token hash incorrecto';
  end if;

  -- 3. Activate session with valid credentials
  v_activated := public.activate_native_capture_session(v_session_id, v_token_hash, '1.0.0', 'POCO X6 Pro');
  if v_activated->>'state' <> 'active' then
    raise exception 'Sesión no se activó correctamente';
  end if;

  -- 4. Reject pair with path outside session folder
  v_error_caught := false;
  begin
    perform public.register_native_capture_pair(
      v_session_id,
      v_token_hash,
      1,
      'malicious-folder/ticket.jpg',
      v_session_id || '/1/evidence.jpg'
    );
  exception when others then
    v_error_caught := true;
  end;
  if not v_error_caught then
    raise exception 'Se permitió registrar archivo fuera de la carpeta de la sesión';
  end if;

  -- 5. Register pair 1
  v_pair1 := public.register_native_capture_pair(
    v_session_id,
    v_token_hash,
    1,
    v_session_id || '/1/ticket.jpg',
    v_session_id || '/1/evidence.jpg',
    'hash-ticket-1',
    'hash-evidence-1',
    'wide',
    '{"device":"POCO X6 Pro"}'::jsonb
  );
  if v_pair1->>'pairNumber' <> '1' or v_pair1->>'state' <> 'uploaded' then
    raise exception 'Par 1 no registrado con estado correcto';
  end if;

  -- 6. Register pair 2
  v_pair2 := public.register_native_capture_pair(
    v_session_id,
    v_token_hash,
    2,
    v_session_id || '/2/ticket.jpg',
    v_session_id || '/2/evidence.jpg',
    'hash-ticket-2',
    'hash-evidence-2',
    'normal',
    '{"device":"POCO X6 Pro"}'::jsonb
  );
  if v_pair2->>'pairNumber' <> '2' then
    raise exception 'Par 2 no registrado correctamente';
  end if;

  -- 7. Registering pair 1 again is idempotent
  v_pair1 := public.register_native_capture_pair(
    v_session_id,
    v_token_hash,
    1,
    v_session_id || '/1/ticket.jpg',
    v_session_id || '/1/evidence.jpg',
    'hash-ticket-1',
    'hash-evidence-1',
    'wide',
    '{"device":"POCO X6 Pro"}'::jsonb
  );

  -- 8. List pairs for PWA
  v_listed := public.get_native_session_pairs(v_session_id, v_token_hash);
  if jsonb_array_length(v_listed->'pairs') <> 2 then
    raise exception 'Cantidad de pares listados no coincide (% en vez de 2)', jsonb_array_length(v_listed->'pairs');
  end if;

  -- 9. Finish session
  v_finished := public.finish_native_capture_session(v_session_id, v_token_hash);
  if v_finished->>'state' <> 'finishing' then
    raise exception 'Estado de finalización incorrecto (%)', v_finished->>'state';
  end if;

  -- 10. Mark pair 1 and 2 as imported
  v_imported := public.mark_native_pairs_imported(
    v_session_id,
    v_token_hash,
    array[(v_pair1->>'pairId')::uuid, (v_pair2->>'pairId')::uuid]
  );
  if (v_imported->>'markedCount')::int <> 2 or (v_imported->>'remainingPending')::int <> 0 then
    raise exception 'Importación de pares incorrecta: %', v_imported;
  end if;

  -- Session should now transition to completed
  v_listed := public.get_native_session_pairs(v_session_id, v_token_hash);
  if v_listed->>'state' <> 'completed' then
    raise exception 'Sesión no pasó a estado completed después de importar todos los pares (%)', v_listed->>'state';
  end if;

end $$;

rollback;
