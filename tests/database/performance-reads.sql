-- Only the isolated test database. Large first pages must stay bounded.
begin;
delete from public.photos;
insert into public.photos(id,name,file_path,public_url,created_at,aggregator,registered_at)
select gen_random_uuid(),'PEYA'||n,'orders/pedidosya/'||n,'https://test/'||n,'2026-10-01T12:00:00Z'::timestamptz + n*interval '1 second','pedidosya','2026-10-01' from generate_series(1,50000) n;
insert into public.photos(id,name,file_path,public_url,created_at,registered_at) values(gen_random_uuid(),'invoice','files/invoice','test','2026-10-02','2026-10-02');
do $$declare r jsonb; first_id text; begin
 r:=public.foto_gallery_page('{"kind":"orders"}',1,30,'2026-10-23');
 if jsonb_array_length(r->'items')<>30 or (r->>'total')::int<>50000 then raise exception 'unbounded gallery %',r;end if;
 first_id:=r#>>'{items,0,id}';
 r:=public.foto_gallery_page('{"kind":"orders"}',2,30,'2026-10-23');
 if exists(select 1 from jsonb_array_elements(r->'items') x where x->>'id'=first_id) then raise exception 'overlap';end if;
 r:=public.foto_gallery_page('{"kind":"files"}',1,30,'2026-10-23');
 if (r->>'total')::int<>1 then raise exception 'kind before limit';end if;
 r:=public.foto_gallery_page('{"kind":"orders","search":"PEYA50000"}',1,30,'2026-10-23');
 if (r->>'total')::int<>1 then raise exception 'older search';end if;
 r:=public.foto_gallery_page('{"kind":"orders","timeFrom":"23:00","timeTo":"09:00"}',1,30,'2026-10-23');
 if (r->>'total')::int=50000 then raise exception 'time filter missing';end if;
 insert into public.photos(id,name,file_path,public_url,created_at,registered_at) values
 (gen_random_uuid(),'PEYATIME1','orders/t1.jpg','url','2026-10-02T20:59:59Z','2026-10-02'),
 (gen_random_uuid(),'PEYATIME2','orders/t2.jpg','url','2026-10-02T21:00:30Z','2026-10-02'),
 (gen_random_uuid(),'PEYATIME3','orders/t3.jpg','url','2026-10-02T21:01:00Z','2026-10-02'),
 (gen_random_uuid(),'PEYALATE','orders/late.jpg','url','2026-10-01T15:00:00Z','2026-10-24');
 r:=public.foto_gallery_page('{"search":"TIME","dateFrom":"2026-10-02","dateTo":"2026-10-02","timeFrom":"17:59","timeTo":"18:00"}',1,30,'2026-10-23');
 if (r->>'total')::int<>2 then raise exception 'inclusive time minute: %',r;end if;
 r:=public.foto_gallery_page('{"search":"PEYALATE"}',1,30,'2026-10-23');
 if (r->>'total')::int<>0 then raise exception 'late offline upload shifted snapshot';end if;
end$$;
insert into public.foto_app_documents(key,revision,data) values('history',999,
 jsonb_build_object('version',2,'items',(select jsonb_object_agg(n::text,jsonb_build_object('id',n::text,'orderCode','PEYA'||n,'day','2026-10-01','aggregator','pedidosya','status','queja','amount',10,'photoId',null)) from generate_series(1,10000) n)))
 on conflict(key) do update set revision=999,data=excluded.data;
do $$declare r jsonb; begin
 r:=public.foto_document_read_if_changed('history',999);
 if r->>'unchanged'<>'true' or r ? 'data' then raise exception 'full unchanged document';end if;
 r:=public.foto_history_page('{"status":"all"}',1,30);
 if jsonb_array_length(r->'items')<>30 or (r->>'total')::int<>10000 or (r->>'amount')::numeric<>100000 then raise exception 'history page/totals';end if;
 r:=public.foto_history_page('{"search":"PEYA9999"}',1,30);
 if (r->>'total')::int<>1 then raise exception 'history search';end if;
 if has_function_privilege('unrelated','public.foto_history_page(jsonb,integer,integer)','EXECUTE') then raise exception 'public access';end if;
end$$;
set role anon;
select public.foto_gallery_page('{"kind":"files"}',1,30);
select public.foto_history_page('{"search":"missing"}',1,30);
reset role;
explain analyze select public.foto_gallery_page('{"kind":"orders"}',1,30,'2026-10-23');
rollback;
