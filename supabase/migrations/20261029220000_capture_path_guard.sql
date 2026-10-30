-- Older service workers do not send capture_id. Serialize inserts by their
-- already-persisted file path so a mixed-version retry cannot duplicate them.
create index if not exists photos_capture_path_lookup on public.photos(file_path) where file_path is not null;

create or replace function public.guard_capture_storage_path()
returns trigger language plpgsql security definer set search_path = public, pg_temp
as $$
declare matches bigint;
begin
  if nullif(new.file_path, '') is null then return new; end if;
  perform pg_advisory_xact_lock(hashtextextended('capture-path:' || new.file_path, 0));
  select count(*) into matches from public.photos
    where file_path = new.file_path and id is distinct from new.id;
  if matches = 1 then
    raise exception 'Capture path already registered' using errcode = '23505';
  end if;
  -- Leave pre-existing ambiguous legacy paths alone. An old client's
  -- reconciliation expects one row; forcing an error for an already ambiguous
  -- path could make that old client remove the shared storage object.
  return new;
end;
$$;
revoke all on function public.guard_capture_storage_path() from public, anon, authenticated;
create or replace trigger foto_capture_path_guard before insert on public.photos
for each row execute function public.guard_capture_storage_path();
