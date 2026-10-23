begin;
delete from public.photos;
delete from public.complaint_drafts;
update public.photo_cleanup_settings set retention_days=30;
insert into public.photos(id,name,file_path,public_url,created_at,has_complaint,is_refutado)
select ('00000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
 case when n=4 then 'Código no encontrado' else 'PEYA'||(10000+n) end,
 'orders/summary-'||case when n=6 then 5 else n end||'.jpg',case when n=7 then null else 'url' end,
 now()-case when n=6 then interval '1 day' else interval '40 days' end,n=2,false from generate_series(1,8) n;
insert into public.foto_app_documents(key,data) values('history','{"items":{"c":{"photoId":"00000000-0000-4000-8000-000000000003","orderCode":"PEYA10003"}}}') on conflict(key) do update set data=excluded.data;
insert into public.complaint_drafts(state,data) values('pending','{"pickedPhotoIds":{"c":"00000000-0000-4000-8000-000000000008"},"complaints":[]}');
insert into storage.objects(bucket_id,name,metadata) select 'photos','orders/summary-'||n||'.jpg','{"size":100}' from generate_series(1,8) n;
do $$declare r jsonb;begin
 r:=public.foto_storage_summary();
 if (r#>>'{selections,eligible,count}')::int<>1 or (r#>>'{selections,protected,count}')::int<>4 then raise exception 'protection mismatch: %',r;end if;
 if (r->>'recordsWithoutImage')::int<>1 or (r->>'retainedRecords')::int<>7 then raise exception 'record counts';end if;
end$$;
rollback;
