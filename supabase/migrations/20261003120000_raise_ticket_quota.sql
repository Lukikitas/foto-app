-- Amplía el cupo de tickets sin resolver de 250 MB a 1 GB.
-- Desde v1.7.7.3 el ticket se conserva para TODOS los pedidos durante 72 h
-- (antes: solo los que seguían sin código, ~20/72 h; ahora: ~1.100/72 h ×
-- ~400 KB comprimidos ≈ 450 MB por ventana). La limpieza horaria mantiene
-- el uso real en lo subido durante las últimas 72 horas.
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
  if used_bytes + ticket_bytes > 1000000000 then return false; end if;
  insert into public.unresolved_ticket_refs(photo_id, storage_path, bytes, expires_at)
  values (ticket_photo_id, ticket_path, ticket_bytes, now() + interval '72 hours');
  return true;
end;
$$;

revoke execute on function public.reserve_order_ticket(text, text, integer) from public, anon, authenticated;
grant execute on function public.reserve_order_ticket(text, text, integer) to service_role;
