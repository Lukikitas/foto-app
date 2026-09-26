-- Server-owned OCR state. Client roles cannot spend Vision quota or read private tickets.
create table if not exists public.order_ocr_usage (
  month text primary key,
  used integer not null default 0 check (used >= 0),
  updated_at timestamptz not null default now()
);

create table if not exists public.order_ocr_results (
  photo_id text primary key,
  code text,
  source text,
  reliable boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists public.unresolved_ticket_refs (
  photo_id text primary key,
  storage_path text not null unique,
  bytes integer not null check (bytes > 0),
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

alter table public.order_ocr_usage enable row level security;
alter table public.order_ocr_results enable row level security;
alter table public.unresolved_ticket_refs enable row level security;
revoke all on public.order_ocr_usage, public.order_ocr_results, public.unresolved_ticket_refs from anon, authenticated;

create or replace function public.reserve_order_ocr_unit()
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare reserved integer;
begin
  insert into public.order_ocr_usage(month, used)
  values (to_char(now() at time zone 'UTC', 'YYYY-MM'), 1)
  on conflict (month) do update
    set used = public.order_ocr_usage.used + 1, updated_at = now()
    where public.order_ocr_usage.used < 6000
  returning used into reserved;
  return reserved is not null;
end;
$$;

revoke execute on function public.reserve_order_ocr_unit() from public, anon, authenticated;
grant execute on function public.reserve_order_ocr_unit() to service_role;

create or replace function public.reserve_order_ticket(
  ticket_photo_id text,
  ticket_path text,
  ticket_bytes integer
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare used_bytes bigint;
begin
  if ticket_bytes <= 0 or ticket_bytes > 3000000 then return false; end if;
  perform pg_advisory_xact_lock(hashtext('foto-app-order-tickets'));
  if exists (select 1 from public.unresolved_ticket_refs where photo_id = ticket_photo_id) then
    return true;
  end if;
  select coalesce(sum(bytes), 0) into used_bytes
  from public.unresolved_ticket_refs where expires_at > now();
  if used_bytes + ticket_bytes > 250000000 then return false; end if;
  insert into public.unresolved_ticket_refs(photo_id, storage_path, bytes, expires_at)
  values (ticket_photo_id, ticket_path, ticket_bytes, now() + interval '72 hours');
  return true;
end;
$$;

revoke execute on function public.reserve_order_ticket(text, text, integer) from public, anon, authenticated;
grant execute on function public.reserve_order_ticket(text, text, integer) to service_role;

insert into storage.buckets(id, name, public)
values ('order-tickets', 'order-tickets', false)
on conflict (id) do nothing;
