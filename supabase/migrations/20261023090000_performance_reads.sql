-- Additive, read-only endpoints. Existing clients and atomic document writes remain valid.
alter table public.photos add column if not exists thumbnail_path text;
-- Separate insertion time from the employee's capture time for stable paging.
alter table public.photos add column if not exists registered_at timestamptz not null default now();
create index if not exists photos_created_id_idx on public.photos(created_at desc, id desc);
create index if not exists photos_aggregator_created_id_idx on public.photos(aggregator, created_at desc, id desc);

create or replace function public.foto_document_read_if_changed(document_key text, known_revision bigint default null)
returns jsonb language sql stable security definer set search_path = '' as $$
  select case when revision=known_revision then jsonb_build_object('unchanged',true,'revision',revision)
    else to_jsonb(d) end from public.foto_app_documents d where key=document_key and key in ('history','metrics');
$$;
create or replace function public.foto_draft_read_if_changed(known_id uuid default null, known_revision bigint default null)
returns jsonb language sql stable security definer set search_path = '' as $$
  select case when id=known_id and revision=known_revision then jsonb_build_object('unchanged',true)
    else to_jsonb(d) end from public.complaint_drafts d where state='pending';
$$;

create or replace function public.foto_compact(value text) returns text
language sql immutable set search_path = '' as $$
  select regexp_replace(translate(upper(coalesce(value,'')), 'ÁÉÍÓÚÜÑ', 'AEIOUUN'), '[^A-Z0-9]', '', 'g');
$$;
create or replace function public.foto_detect_aggregator(value text) returns text
language sql immutable set search_path = '' as $$
  select case when public.foto_compact(value) like 'RAPPITURBO%' then 'rappi_turbo'
    when public.foto_compact(value) like 'RAPPI%' then 'rappi'
    when public.foto_compact(value) like 'PEYA%' then 'pedidosya'
    when public.foto_compact(value) like 'MP%' then 'mercadopago' end;
$$;
create or replace function public.foto_is_order(path text, name text) returns boolean
language sql immutable set search_path = '' as $$
  select case when path like 'files/%' then false when path like 'orders/%' then true
    else coalesce(name ~ '^(\d{4,12}|\d{1,4}-\d{4,}|(PEYA|RAPPI(TURBO)?|MPD?)[A-Z0-9-]{1,28})$',false) end;
$$;

create or replace function public.foto_gallery_page(filters jsonb default '{}', page integer default 1, page_size integer default 30, as_of timestamptz default now())
returns jsonb language sql stable security invoker set search_path = '' as $$
 with matching as materialized (
   select p.* from public.photos p where p.registered_at<=as_of
   and (coalesce(filters->>'kind','')='' or public.foto_is_order(p.file_path,p.name)=(filters->>'kind'='orders'))
   and (coalesce(filters->>'search','')='' or strpos(lower(coalesce(p.name,'')),lower(filters->>'search'))>0)
   and (coalesce(filters->>'takenBy','')='' or strpos(lower(coalesce(p.taken_by,'')),lower(filters->>'takenBy'))>0)
   and (coalesce(filters->>'notes','')='' or strpos(lower(coalesce(p.notes,'')),lower(filters->>'notes'))>0)
   and (coalesce(filters->>'aggregator','')='' or p.aggregator=filters->>'aggregator')
   and (not coalesce((filters->>'codeNotFound')::boolean,false) or (public.foto_is_order(p.file_path,p.name) and p.name='Código no encontrado'))
   and (not coalesce((filters->>'hasComplaint')::boolean,false) or p.has_complaint)
   and (not coalesce((filters->>'isRefutado')::boolean,false) or p.is_refutado)
   and (nullif(filters->>'dateFrom','') is null or p.created_at >= (((filters->>'dateFrom')::date + coalesce(nullif(filters->>'timeFrom','')::time,time '00:00')) at time zone 'America/Argentina/Buenos_Aires'))
   and (nullif(filters->>'dateTo','') is null or p.created_at < (((filters->>'dateTo')::date + coalesce(nullif(filters->>'timeTo','')::time,time '23:59') + interval '1 minute') at time zone 'America/Argentina/Buenos_Aires'))
   and (case when nullif(filters->>'timeFrom','') is not null and nullif(filters->>'timeTo','') is not null and filters->>'timeFrom'>filters->>'timeTo'
     then to_char(p.created_at at time zone 'America/Argentina/Buenos_Aires','HH24:MI') >= filters->>'timeFrom' or to_char(p.created_at at time zone 'America/Argentina/Buenos_Aires','HH24:MI') <= filters->>'timeTo'
     else (nullif(filters->>'timeFrom','') is null or to_char(p.created_at at time zone 'America/Argentina/Buenos_Aires','HH24:MI') >= filters->>'timeFrom')
       and (nullif(filters->>'timeTo','') is null or to_char(p.created_at at time zone 'America/Argentina/Buenos_Aires','HH24:MI') <= filters->>'timeTo') end)
 ), totals as (select count(*) n from matching), bounds as (
   select greatest(1,least(greatest(1,page),ceil(n::numeric/greatest(1,least(page_size,100)))::int)) p, greatest(1,least(page_size,100)) size from totals
 ), rows as (select m.* from matching m order by created_at desc,id desc limit (select size from bounds) offset (select (p-1)*size from bounds))
 select jsonb_build_object('items',coalesce((select jsonb_agg(to_jsonb(r) order by created_at desc,id desc) from rows r),'[]'::jsonb),
 'total',(select n from totals),'page',(select p from bounds),'asOf',as_of);
$$;

create or replace function public.foto_history_day(item jsonb) returns text
language plpgsql immutable set search_path = '' as $$
begin
 if item->>'day' ~ '^\d{4}-\d{2}-\d{2}$' then return (item->>'day')::date::text;end if;
 if nullif(item->>'orderAtIso','') is not null then return ((item->>'orderAtIso')::timestamptz at time zone 'America/Argentina/Buenos_Aires')::date::text; end if;
 return case when item->>'day' ~ '^\d{4}-\d{2}-\d{2}$' then item->>'day' else '' end;
exception when others then return ''; end;
$$;
create or replace function public.foto_history_amount(value text) returns numeric
language plpgsql immutable set search_path = '' as $$
declare amount numeric;
begin
 if nullif(trim(value),'') is null or trim(value)!~ '^[+]?[0-9]+([.][0-9]*)?([eE][+-]?[0-9]+)?$' then return null;end if;
 amount:=value::numeric;
 perform value::double precision;
 return round(amount,2);
exception when others then return null;end;
$$;
create or replace function public.foto_history_page(filters jsonb default '{}', page integer default 1, page_size integer default 30)
returns jsonb language sql stable security definer set search_path = '' as $$
 with settings as (select coalesce(data->'refutadoDays','{}') days from public.foto_app_documents where key='metrics'),
 source as materialized (
   select value || jsonb_build_object('id',coalesce(nullif(value->>'id',''),public.foto_compact(value->>'orderCode')||'|'||coalesce(nullif(public.foto_history_day(case when nullif(value->>'orderAtIso','') is not null then value-'day' else value end),''),'nodate')),'day',public.foto_history_day(value),
     'amount',public.foto_history_amount(value->>'amount'), 'fields',case when jsonb_typeof(value->'fields')='object' then value->'fields' else '{}'::jsonb end,
     'aggregator',case when value ? 'aggregator' then value->>'aggregator' else public.foto_detect_aggregator(value->>'orderCode') end,
     'status',case when value->>'status' in ('queja','refutado','refutado_aceptado','refutado_rechazado','no_refutable') then value->>'status' else case when value->>'refutado'='true' and value->>'accepted'='true' then 'refutado_aceptado' when value->>'refutado'='true' then 'refutado' when value->>'accepted'='true' then 'refutado_rechazado' else 'queja' end end) item
   from public.foto_app_documents d cross join lateral jsonb_each(coalesce(data->'items','{}')) e where d.key='history' and jsonb_typeof(value)='object' and public.foto_compact(value->>'orderCode')<>''
 ), base as materialized (
   select item,
    case when item->>'status'='queja' and nullif(item->>'day','') is not null and
      coalesce((select coalesce(days->>coalesce(item->>'aggregator','default'),days->>'default','7')::int from settings),7)>0 and
      (item->>'day')::date + coalesce((select coalesce(days->>coalesce(item->>'aggregator','default'),days->>'default','7')::int from settings),7) < (now() at time zone 'America/Argentina/Buenos_Aires')::date
      then 'queja_vencida' else item->>'status' end display_status,
    case when nullif(item->>'photoId','') is not null or nullif(item->>'photoUrl','') is not null then 'con_foto' else 'sin_foto' end photo_status
   from source where
    (coalesce(filters->>'aggregator','all') in ('','all') or item->>'aggregator'=filters->>'aggregator')
    and (nullif(filters->>'from','') is null or item->>'day'>=filters->>'from')
    and (nullif(filters->>'to','') is null or item->>'day'<=filters->>'to')
    and (coalesce((filters->>'undated')::boolean,false)=false or item->>'day'='')
    and (coalesce(filters->>'search','')='' or
      (public.foto_compact(filters->>'search')<>'' and strpos(public.foto_compact(item->>'orderCode'),public.foto_compact(filters->>'search'))>0) or
      strpos(lower(concat_ws(' ',item->>'orderCode',item->>'reason',item->>'comment',item->>'combo',(select string_agg(value,' ') from jsonb_each_text(coalesce(item->'fields','{}'))))),lower(filters->>'search'))>0)
 ), matching as materialized (
    select * from base where coalesce(filters->>'status','all') in ('','all') or display_status=filters->>'status' or photo_status=filters->>'status'
 ), totals as (select count(*) n from matching), bounds as (
   select greatest(1,least(greatest(1,page),ceil(n::numeric/greatest(1,least(page_size,100)))::int)) p,greatest(1,least(page_size,100)) size from totals
 ), rows as (
   select * from matching order by
    case when filters->>'sort'='amount_desc' then nullif(item->>'amount','')::numeric end desc nulls last,
    case when filters->>'sort'='amount_asc' then nullif(item->>'amount','')::numeric end asc nulls first,
    case when filters->>'sort'='code_asc' then item->>'orderCode' end asc,
    case when filters->>'sort'='date_asc' then coalesce(nullif(item->>'orderAtIso',''),item->>'day','') end asc,
    case when coalesce(filters->>'sort','date_desc')='date_desc' then coalesce(nullif(item->>'orderAtIso',''),item->>'day','') end desc,
    item->>'id' asc limit (select size from bounds) offset (select (p-1)*size from bounds)
 ), counts as (select display_status k,count(*) n from base group by display_status union all select photo_status,count(*) from base group by photo_status)
 select jsonb_build_object('items',coalesce((select jsonb_agg(item) from rows),'[]'::jsonb),'total',(select n from totals),'page',(select p from bounds),
  'revision',(select revision from public.foto_app_documents where key='history'),
  'historyCount',(select count(*) from source), 'amount',(select coalesce(sum(nullif(item->>'amount','')::numeric),0) from base),
  'stats',coalesce((select jsonb_object_agg(k,n) from counts),'{}')||jsonb_build_object('all',(select count(*) from base)));
$$;

revoke all on function public.foto_document_read_if_changed(text,bigint), public.foto_draft_read_if_changed(uuid,bigint), public.foto_gallery_page(jsonb,integer,integer,timestamptz), public.foto_history_page(jsonb,integer,integer) from public;
grant execute on function public.foto_document_read_if_changed(text,bigint), public.foto_draft_read_if_changed(uuid,bigint), public.foto_gallery_page(jsonb,integer,integer,timestamptz), public.foto_history_page(jsonb,integer,integer) to anon, authenticated, service_role;

create or replace function public.foto_metrics_header() returns jsonb
language sql stable security definer set search_path = '' as $$
 select jsonb_build_object('data',data-'days','revision',revision,'availableLastDay',
   (select max(day.key) from jsonb_each(coalesce(data->'days','{}')) day where day.key ~ '^\d{4}-\d{2}-\d{2}$' and day.key<=(now() at time zone 'America/Argentina/Buenos_Aires')::date::text
    and exists(select 1 from jsonb_each(day.value) agg where agg.key in ('pedidosya','rappi','rappi_turbo','mercadopago') and jsonb_typeof(agg.value)='object'
      and (agg.value#>>'{reported,orders}' is distinct from 'false' or agg.value#>>'{reported,complaints}' is distinct from 'false' or
        (agg.key='pedidosya' and agg.value#>>'{reported,awt}' is distinct from 'false')))))
 from public.foto_app_documents where key='metrics';
$$;
-- Hash joins keep large protected-path lists within PostgREST's read timeout.
-- Preserve the existing RPC's response and permissions for older clients.
create or replace function public.foto_storage_usage(protected_paths text[] default '{}', eligible_paths text[] default '{}')
returns jsonb language sql stable security definer set search_path = '' as $$
 with objects as materialized (
   select name,bucket_id,
     case when metadata->>'size' ~ '^[0-9]{1,15}$' then (metadata->>'size')::bigint else null end bytes,
     case when bucket_id='order-tickets' then 'tickets' when name like 'orders/%' then 'orders'
       when name like 'files/%' then 'files' else 'other' end category
   from storage.objects where bucket_id in ('photos','order-tickets')
 ), groups as (
   select category,count(*) count,coalesce(sum(bytes),0) bytes,count(*) filter(where bytes is null) "unknownSizeCount"
   from objects group by category
 ), paths as materialized (
   select distinct 'protected' label,unnest(protected_paths) name
   union select distinct 'eligible',unnest(eligible_paths)
 ), selections as (
   select p.label,count(*) count,coalesce(sum(o.bytes),0) bytes,count(*) filter(where o.bytes is null) "unknownSizeCount"
   from objects o join paths p on p.name=o.name where o.bucket_id='photos' and o.category='orders' group by p.label
 )
 select jsonb_build_object('snapshotAt',now(),
   'total',jsonb_build_object('count',count(*),'bytes',coalesce(sum(bytes),0),'unknownSizeCount',count(*) filter(where bytes is null)),
   'categories',coalesce((select jsonb_object_agg(category,to_jsonb(groups)-'category') from groups),'{}'::jsonb),
   'selections',coalesce((select jsonb_object_agg(label,to_jsonb(selections)-'label') from selections),'{}'::jsonb)) from objects;
$$;

create or replace function public.foto_storage_summary() returns jsonb
language sql stable security definer set search_path = '' as $$
 with history as (select value item from public.foto_app_documents d cross join lateral jsonb_each(coalesce(data->'items','{}')) where d.key='history'),
 drafts as (select data from public.complaint_drafts where state='pending'),
 refs as materialized (
   select item->>'photoId' id,public.foto_compact(coalesce(nullif(item->>'compact',''),item->>'orderCode')) code from history
   union select null,public.foto_compact(item->>'photoName') from history
   union select value,null from drafts cross join lateral jsonb_each_text(coalesce(data->'pickedPhotoIds','{}'))
   union select null,public.foto_compact(value->>'orderCode') from drafts cross join lateral jsonb_array_elements(coalesce(data->'complaints','[]'))
 ), ref_ids as materialized (select distinct id from refs where nullif(id,'') is not null),
 ref_codes as materialized (select distinct code from refs where nullif(code,'') is not null),
 classified as materialized (
   select p.*, (coalesce(p.has_complaint,false) or coalesce(p.is_refutado,false) or coalesce(p.name='Código no encontrado',false) or
     ri.id is not null or rc.code is not null) protected
   from public.photos p left join ref_ids ri on ri.id=p.id::text left join ref_codes rc on rc.code=public.foto_compact(p.name)
   where p.file_path like 'orders/%'
 ), blocked as (select distinct file_path from classified where public_url is not null and
    (protected or created_at>=now()-make_interval(days=>(select retention_days from public.photo_cleanup_settings where id=true)))),
 selections as (select
   coalesce(array_agg(distinct file_path) filter(where public_url is not null and protected),'{}') protected_paths,
   coalesce(array_agg(distinct file_path) filter(where public_url is not null and not protected and
     created_at<now()-make_interval(days=>(select retention_days from public.photo_cleanup_settings where id=true)) and not exists(select 1 from blocked b where b.file_path=classified.file_path)),'{}') eligible_paths,
   count(*) filter(where public_url is null) missing,count(*) filter(where public_url is not null) retained from classified)
 select public.foto_storage_usage(protected_paths,eligible_paths)||jsonb_build_object('recordsWithoutImage',missing,'retainedRecords',retained,
   'retention',(select to_jsonb(s)-'id' from public.photo_cleanup_settings s where id=true)) from selections;
$$;
revoke all on function public.foto_metrics_header(),public.foto_storage_summary() from public;
grant execute on function public.foto_metrics_header(),public.foto_storage_summary() to anon,authenticated,service_role;
