-- Retención automática de fotos de pedidos sin queja (v1.11).
-- La card «Liberación de fotos» de Ajustes la edita con anon; la función edge
-- cleanup-photo-retention la lee en cada corrida y anota el resultado.
-- Cambiar el plazo no elimina archivos inmediatamente.
create table if not exists public.photo_cleanup_settings (
  id boolean primary key default true check (id),
  enabled boolean not null default true,
  retention_days integer not null default 30 check (retention_days between 7 and 365),
  updated_at timestamptz not null default now(),
  last_run_at timestamptz,
  last_removed integer not null default 0
);
insert into public.photo_cleanup_settings(id) values (true) on conflict do nothing;
alter table public.photo_cleanup_settings enable row level security;
grant select, update on public.photo_cleanup_settings to anon, authenticated;
drop policy if exists "Everyone can read photo cleanup settings" on public.photo_cleanup_settings;
create policy "Everyone can read photo cleanup settings" on public.photo_cleanup_settings
  for select to anon, authenticated using (true);
drop policy if exists "Everyone can change photo cleanup settings" on public.photo_cleanup_settings;
create policy "Everyone can change photo cleanup settings" on public.photo_cleanup_settings
  for update to anon, authenticated using (true) with check (id = true);
