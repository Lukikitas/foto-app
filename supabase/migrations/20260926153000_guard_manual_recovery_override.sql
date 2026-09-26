-- A manual correction wins if a scheduled OCR result is still in flight.
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
  if p_kind = 'automatic' and exists (
    select 1 from public.order_recovery_items
    where photo_id = p_photo_id and status = 'manual_override'
  ) then return false; end if;
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
