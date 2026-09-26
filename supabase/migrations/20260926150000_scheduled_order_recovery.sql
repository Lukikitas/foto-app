-- Shared settings and durable work for the server-side "Sin código" review.
alter table public.photos add column if not exists aggregator text;
alter table public.order_ocr_results add column if not exists aggregator text;
alter table public.order_ocr_results add column if not exists status text not null default 'done';
alter table public.order_ocr_results add column if not exists lease_until timestamptz;

update public.photos
set aggregator = case
  when file_path like 'orders/pedidosya/%' then 'pedidosya'
  when file_path like 'orders/rappi_turbo/%' then 'rappi_turbo'
  when file_path like 'orders/rappi/%' then 'rappi'
  when file_path like 'orders/mercadopago/%' then 'mercadopago'
  when file_path like 'orders/sin_agregador/%' and upper(regexp_replace(name, '[^A-Za-z0-9]', '', 'g')) like 'RAPPITURBO%' then 'rappi_turbo'
  when file_path like 'orders/sin_agregador/%' and upper(regexp_replace(name, '[^A-Za-z0-9]', '', 'g')) like 'RAPPI%' then 'rappi'
  when file_path like 'orders/sin_agregador/%' and upper(regexp_replace(name, '[^A-Za-z0-9]', '', 'g')) like 'PEYA%' then 'pedidosya'
  when file_path like 'orders/sin_agregador/%' and upper(regexp_replace(name, '[^A-Za-z0-9]', '', 'g')) like 'MP%' then 'mercadopago'
  when file_path like 'orders/no_code/%' and upper(regexp_replace(name, '[^A-Za-z0-9]', '', 'g')) like 'RAPPITURBO%' then 'rappi_turbo'
  when file_path like 'orders/no_code/%' and upper(regexp_replace(name, '[^A-Za-z0-9]', '', 'g')) like 'RAPPI%' then 'rappi'
  when file_path like 'orders/no_code/%' and upper(regexp_replace(name, '[^A-Za-z0-9]', '', 'g')) like 'PEYA%' then 'pedidosya'
  when file_path like 'orders/no_code/%' and upper(regexp_replace(name, '[^A-Za-z0-9]', '', 'g')) like 'MP%' then 'mercadopago'
  else null
end
where aggregator is null and file_path like 'orders/%';

create table if not exists public.order_recovery_settings (
  id boolean primary key default true check (id),
  enabled boolean not null default false,
  start_time time without time zone not null default time '03:00',
  mode text not null default 'propose' check (mode in ('propose', 'auto_high')),
  updated_at timestamptz not null default now()
);
insert into public.order_recovery_settings(id) values (true) on conflict do nothing;
alter table public.order_recovery_settings enable row level security;
grant select, update on public.order_recovery_settings to anon, authenticated;
create policy "Everyone can read recovery settings" on public.order_recovery_settings
  for select to anon, authenticated using (true);
create policy "Everyone can change recovery settings" on public.order_recovery_settings
  for update to anon, authenticated using (true) with check (id = true);

create table if not exists public.order_recovery_runs (
  day date primary key,
  status text not null default 'running' check (status in ('running', 'complete', 'quota_exhausted', 'paused')),
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  analyzed integer not null default 0,
  proposed integer not null default 0,
  confirmed integer not null default 0,
  no_code integer not null default 0,
  failed integer not null default 0,
  last_error text
);
create table if not exists public.order_recovery_items (
  photo_id text primary key,
  status text not null default 'pending' check (status in ('pending', 'processing', 'proposed', 'confirmed', 'no_code', 'error', 'manual_override')),
  run_day date,
  lease_until timestamptz,
  next_attempt_at timestamptz,
  attempts integer not null default 0,
  code text,
  aggregator text,
  source text,
  reliable boolean not null default false,
  analyzed_at timestamptz,
  updated_at timestamptz not null default now()
);
create index if not exists order_recovery_items_ready_idx
  on public.order_recovery_items(status, next_attempt_at, lease_until);
create index if not exists photos_unresolved_recovery_idx
  on public.photos(created_at, id) where name = 'Código no encontrado' and file_path like 'orders/%';

create table if not exists public.order_recovery_events (
  id bigint generated always as identity primary key,
  photo_id text not null,
  run_day date,
  kind text not null,
  source text,
  old_code text,
  new_code text,
  old_aggregator text,
  new_aggregator text,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists order_recovery_events_photo_idx
  on public.order_recovery_events(photo_id, created_at desc);
alter table public.order_recovery_runs enable row level security;
alter table public.order_recovery_items enable row level security;
alter table public.order_recovery_events enable row level security;
grant select on public.order_recovery_runs, public.order_recovery_items, public.order_recovery_events to anon, authenticated;
create policy "Everyone can read recovery runs" on public.order_recovery_runs for select to anon, authenticated using (true);
create policy "Everyone can read recovery items" on public.order_recovery_items for select to anon, authenticated using (true);
create policy "Everyone can read recovery events" on public.order_recovery_events for select to anon, authenticated using (true);

create or replace function public.claim_order_recovery_batch(p_day date, p_limit integer default 10)
returns table(photo_id text)
language plpgsql security definer set search_path = public
as $$
begin
  if p_limit < 1 or p_limit > 20 then raise exception 'Invalid batch size'; end if;
  insert into public.order_recovery_items(photo_id)
    select p.id::text from public.photos p
    left join public.unresolved_ticket_refs t on t.photo_id = p.id::text and t.expires_at > now()
    where p.name = 'Código no encontrado' and p.file_path like 'orders/%'
      and not exists (select 1 from public.order_recovery_items i where i.photo_id = p.id::text)
    order by t.expires_at asc nulls last, p.created_at asc, p.id asc limit 200
    on conflict do nothing;
  return query
  with chosen as (
    select i.photo_id from public.order_recovery_items i
    join public.photos p on p.id::text = i.photo_id
    left join public.unresolved_ticket_refs t on t.photo_id = i.photo_id and t.expires_at > now()
    where p.name = 'Código no encontrado' and p.file_path like 'orders/%'
      and (
        i.status = 'pending'
        or (i.status = 'processing' and i.lease_until < now())
        or (i.status in ('no_code', 'error') and i.next_attempt_at <= now())
      )
    order by t.expires_at asc nulls last, p.created_at asc, i.photo_id asc
    for update of i skip locked limit p_limit
  )
  update public.order_recovery_items i
    set status = 'processing', run_day = p_day, lease_until = now() + interval '10 minutes',
        attempts = i.attempts + 1, updated_at = now()
  from chosen
  where i.photo_id = chosen.photo_id
  returning i.photo_id;
end;
$$;
revoke execute on function public.claim_order_recovery_batch(date, integer) from public, anon, authenticated;
grant execute on function public.claim_order_recovery_batch(date, integer) to service_role;

create or replace function public.apply_recovered_order_code(
  p_photo_id text, p_expected_code text, p_code text, p_aggregator text,
  p_kind text, p_source text default null, p_run_day date default null
) returns boolean
language plpgsql security definer set search_path = public
as $$
declare previous public.photos%rowtype;
begin
  if p_kind is null or p_kind not in ('automatic', 'manual', 'correction') then raise exception 'Invalid action'; end if;
  if p_code is not null and (length(trim(p_code)) < 4 or p_aggregator is null or
      p_aggregator not in ('pedidosya','rappi','rappi_turbo','mercadopago')) then
    raise exception 'Invalid code or aggregator';
  end if;
  if p_code is null and p_kind <> 'correction' then raise exception 'Only a correction can clear a code'; end if;
  select * into previous from public.photos where id::text = p_photo_id for update;
  if not found or previous.name is distinct from p_expected_code or previous.file_path not like 'orders/%' then return false; end if;
  perform set_config('foto_app.recovery_action', p_kind, true);
  update public.photos set name = coalesce(trim(p_code), 'Código no encontrado'), aggregator = p_aggregator
    where id = previous.id;
  insert into public.order_recovery_events
    (photo_id, run_day, kind, source, old_code, new_code, old_aggregator, new_aggregator)
    values (p_photo_id, p_run_day, p_kind, p_source, previous.name, p_code, previous.aggregator, p_aggregator);
  insert into public.order_recovery_items(photo_id, status, code, aggregator, source, reliable, analyzed_at, updated_at)
    values (p_photo_id, case when p_kind = 'correction' then 'manual_override' else 'confirmed' end,
            p_code, p_aggregator, p_source, p_kind = 'automatic', now(), now())
  on conflict (photo_id) do update
    set status = excluded.status, code = excluded.code, aggregator = excluded.aggregator,
        source = excluded.source, reliable = excluded.reliable,
        analyzed_at = excluded.analyzed_at, lease_until = null,
        next_attempt_at = null, updated_at = now();
  return true;
end;
$$;
revoke execute on function public.apply_recovered_order_code(text,text,text,text,text,text,date) from public, anon, authenticated;
grant execute on function public.apply_recovered_order_code(text,text,text,text,text,text,date) to service_role;

create or replace function public.reserve_scheduled_order_ocr_unit()
returns boolean language plpgsql security definer set search_path = public
as $$
declare reserved integer;
begin
  insert into public.order_ocr_usage(month, used)
  values (to_char(now() at time zone 'UTC', 'YYYY-MM'), 1)
  on conflict (month) do update
    set used = public.order_ocr_usage.used + 1, updated_at = now()
    where public.order_ocr_usage.used < 5500
  returning used into reserved;
  return reserved is not null;
end;
$$;
revoke execute on function public.reserve_scheduled_order_ocr_unit() from public, anon, authenticated;
grant execute on function public.reserve_scheduled_order_ocr_unit() to service_role;

create or replace function public.claim_order_ocr_analysis(p_photo_id text)
returns boolean language plpgsql security definer set search_path = public
as $$
declare claimed text;
begin
  insert into public.order_ocr_results(photo_id, status, lease_until, created_at)
  values (p_photo_id, 'processing', now() + interval '10 minutes', now())
  on conflict (photo_id) do update
    set status = 'processing', lease_until = now() + interval '10 minutes',
        created_at = now()
    where (public.order_ocr_results.status = 'processing' and public.order_ocr_results.lease_until < now())
       or public.order_ocr_results.status = 'error'
       or (public.order_ocr_results.status = 'done'
           and public.order_ocr_results.code is null
           and public.order_ocr_results.created_at < now() - interval '7 days')
  returning photo_id into claimed;
  return claimed is not null;
end;
$$;
revoke execute on function public.claim_order_ocr_analysis(text) from public, anon, authenticated;
grant execute on function public.claim_order_ocr_analysis(text) to service_role;

create or replace function public.increment_order_recovery_run(p_day date, p_status text)
returns void language plpgsql security definer set search_path = public
as $$
begin
  update public.order_recovery_runs set
    analyzed = analyzed + case when p_status = 'error' then 0 else 1 end,
    proposed = proposed + case when p_status = 'proposed' then 1 else 0 end,
    confirmed = confirmed + case when p_status = 'confirmed' then 1 else 0 end,
    no_code = no_code + case when p_status = 'no_code' then 1 else 0 end,
    failed = failed + case when p_status = 'error' then 1 else 0 end
  where day = p_day;
end;
$$;
revoke execute on function public.increment_order_recovery_run(date,text) from public, anon, authenticated;
grant execute on function public.increment_order_recovery_run(date,text) to service_role;

create or replace function public.current_order_ocr_usage()
returns integer language sql stable security definer set search_path = public
as $$
  select coalesce((
    select used from public.order_ocr_usage
    where month = to_char(now() at time zone 'UTC', 'YYYY-MM')
  ), 0);
$$;
revoke execute on function public.current_order_ocr_usage() from public;
grant execute on function public.current_order_ocr_usage() to anon, authenticated, service_role;

create or replace function public.list_unidentified_photos_page(
  p_as_of timestamptz, p_cursor_created_at timestamptz default null,
  p_cursor_id text default null, p_limit integer default 20
) returns setof public.photos
language sql stable security invoker set search_path = public
as $$
  select p.* from public.photos p
  where p.name = 'Código no encontrado' and p.file_path like 'orders/%'
    and p.created_at <= p_as_of
    and (
      p_cursor_created_at is null or
      (p.created_at, p.id::text) < (p_cursor_created_at, p_cursor_id)
    )
  order by p.created_at desc, p.id::text desc
  limit least(greatest(p_limit, 1), 50);
$$;
revoke execute on function public.list_unidentified_photos_page(timestamptz,timestamptz,text,integer) from public;
grant execute on function public.list_unidentified_photos_page(timestamptz,timestamptz,text,integer) to anon, authenticated;

create or replace function public.audit_direct_order_code_change()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  if new.file_path not like 'orders/%' or
     (new.name is not distinct from old.name and new.aggregator is not distinct from old.aggregator) or
     coalesce(current_setting('foto_app.recovery_action', true), '') <> '' then
    return new;
  end if;
  insert into public.order_recovery_events
    (photo_id, kind, old_code, new_code, old_aggregator, new_aggregator)
  values (new.id::text, 'manual_edit', old.name, new.name, old.aggregator, new.aggregator);
  insert into public.order_recovery_items(photo_id, status, code, aggregator, updated_at)
  values (new.id::text, 'manual_override',
    case when new.name = 'Código no encontrado' then null else new.name end,
    new.aggregator, now())
  on conflict (photo_id) do update
    set status = 'manual_override', code = excluded.code, aggregator = excluded.aggregator,
        lease_until = null, next_attempt_at = null, updated_at = now();
  return new;
end;
$$;
drop trigger if exists audit_direct_order_code_change on public.photos;
create trigger audit_direct_order_code_change
after update of name, aggregator on public.photos
for each row execute function public.audit_direct_order_code_change();
