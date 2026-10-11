-- v1.11: read-only totals for the app's two storage buckets. No object paths,
-- signed URLs or contents are returned, and no storage policies are widened.
create or replace function public.foto_storage_usage(
  protected_paths text[] default '{}', eligible_paths text[] default '{}'
) returns jsonb language sql stable security definer set search_path = '' as $$
  with objects as (
    select name, bucket_id,
      case when metadata->>'size' ~ '^[0-9]{1,15}$' then (metadata->>'size')::bigint else null end as bytes,
      case when bucket_id='order-tickets' then 'tickets'
        when name like 'orders/%' then 'orders'
        when name like 'files/%' then 'files' else 'other' end as category
    from storage.objects where bucket_id in ('photos','order-tickets')
  ), groups as (
    select category, count(*) as count, coalesce(sum(bytes),0) as bytes,
      count(*) filter(where bytes is null) as "unknownSizeCount" from objects group by category
  ), selections as (
    select label, count(*) as count, coalesce(sum(bytes),0) as bytes,
      count(*) filter(where bytes is null) as "unknownSizeCount"
    from objects cross join (values ('protected'),('eligible')) labels(label)
    where bucket_id='photos' and category='orders' and
      name=any(case when label='protected' then protected_paths else eligible_paths end)
    group by label
  ) select jsonb_build_object(
    'snapshotAt',now(),
    'total',jsonb_build_object('count',count(*),'bytes',coalesce(sum(bytes),0),'unknownSizeCount',count(*) filter(where bytes is null)),
    'categories',coalesce((select jsonb_object_agg(category,to_jsonb(groups)-'category') from groups),'{}'::jsonb),
    'selections',coalesce((select jsonb_object_agg(label,to_jsonb(selections)-'label') from selections),'{}'::jsonb)
  ) from objects;
$$;
revoke all on function public.foto_storage_usage(text[],text[]) from public;
grant execute on function public.foto_storage_usage(text[],text[]) to anon, authenticated, service_role;
