-- Only for the isolated CI database, never production.
create role anon;
create role authenticated;
create role service_role;
create schema storage;
create table storage.buckets(id text primary key, name text, public boolean default false);
create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text);
alter table storage.objects enable row level security;
create policy legacy_access on storage.objects to anon using(true) with check(true);
grant usage on schema storage to anon;
grant all on storage.objects to anon;
create table public.photos(id uuid primary key,name text,has_complaint boolean,is_refutado boolean,notes text);
