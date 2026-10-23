-- Only for the isolated CI database, never production.
create role anon;
create role authenticated;
create role service_role;
-- Mirror hosted Supabase RPC default grants as well as PUBLIC's grant.
alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
create schema storage;
create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text,metadata jsonb);
alter table storage.objects enable row level security;
create policy legacy_access on storage.objects to anon using(true) with check(true);
grant usage on schema storage to anon;
grant all on storage.objects to anon;
create table public.photos(id uuid primary key,name text,has_complaint boolean,is_refutado boolean,notes text,
 file_path text,public_url text,created_at timestamptz default now(),taken_by text,aggregator text);
-- Match the existing shared app's photo read permissions for invoker RPC tests.
grant select on public.photos to anon, authenticated;
