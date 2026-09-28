insert into public.native_capture_sessions (
  id, token_hash, taken_by, state, created_at, expires_at
) values (
  'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
  'Legacy fixture',
  'active',
  now() - interval '3 hours',
  now() - interval '1 hour'
);
