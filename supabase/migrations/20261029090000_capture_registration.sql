-- Additive: existing clients and records retain their existing identities.
alter table public.photos add column if not exists capture_id uuid;
create unique index if not exists photos_capture_id_unique on public.photos(capture_id) where capture_id is not null;

create or replace function public.register_photo_capture(
  p_capture_id uuid, p_file_path text, p_public_url text, p_name text,
  p_taken_by text, p_aggregator text, p_captured_at timestamptz
) returns public.photos
language plpgsql security definer set search_path = public, pg_temp
as $$
declare saved public.photos%rowtype;
begin
  if p_capture_id is null or p_file_path is distinct from ('orders/mobile/' || p_capture_id::text || '.jpg')
     or nullif(trim(p_taken_by), '') is null or length(p_taken_by) > 120
     or p_captured_at is null or p_captured_at > now() + interval '1 day'
     or nullif(trim(p_name), '') is null or length(p_name) > 64
     or (p_aggregator is not null and p_aggregator not in ('pedidosya','rappi','rappi_turbo','mercadopago')) then
    raise exception 'Invalid capture' using errcode = '22023';
  end if;
  -- Serialize registration of this capture, including retries whose first
  -- response disappeared. Existing manual edits always win over a retry.
  perform pg_advisory_xact_lock(hashtextextended(p_capture_id::text, 0));
  select * into saved from public.photos where capture_id = p_capture_id;
  if found then return saved; end if;
  if not exists(select 1 from storage.objects where bucket_id = 'photos' and name = p_file_path) then
    raise exception 'Evidence is not stored yet' using errcode = 'P0002';
  end if;
  insert into public.photos(id, capture_id, name, file_path, public_url, created_at,
    taken_by, aggregator, has_complaint, is_refutado, notes)
  values(gen_random_uuid(), p_capture_id, p_name, p_file_path, p_public_url,
    p_captured_at, trim(p_taken_by), p_aggregator, false, false, '') returning * into saved;
  return saved;
end;
$$;
revoke all on function public.register_photo_capture(uuid,text,text,text,text,text,timestamptz) from public, anon, authenticated;
grant execute on function public.register_photo_capture(uuid,text,text,text,text,text,timestamptz) to service_role;
