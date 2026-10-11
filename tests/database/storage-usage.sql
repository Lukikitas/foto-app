-- Isolated database only.
insert into storage.objects(bucket_id,name,metadata)
select 'photos','orders/pedidosya/'||n,jsonb_build_object('size',n) from generate_series(1,1205) n;
insert into storage.objects(bucket_id,name,metadata) values
('photos','files/a','{"size":20}'),('order-tickets','t','{"size":30}'),('photos','misc','{"size":"?"}'),
('photos','orders/pedidosya/unknown','{}'),('outside','secret','{"size":999999}');
do $$
declare result jsonb;
begin
 result:=public.foto_storage_usage(array['orders/pedidosya/1','orders/pedidosya/1'],array['orders/pedidosya/2','orders/pedidosya/unknown','missing']);
 if (result#>>'{total,count}')::int<>1209 then raise exception 'wrong total: %',result;end if;
 if (result#>>'{total,bytes}')::bigint<>726665 then raise exception 'wrong bytes: %',result;end if;
 if (result#>>'{total,unknownSizeCount}')::int<>2 then raise exception 'unknown sizes';end if;
 if (result#>>'{selections,protected,count}')::int<>1 then raise exception 'duplicate paths';end if;
 if (result#>>'{selections,eligible,count}')::int<>2 then raise exception 'candidates';end if;
 if (result#>>'{selections,eligible,unknownSizeCount}')::int<>1 then raise exception 'candidate unknown size';end if;
 if not has_function_privilege('anon','public.foto_storage_usage(text[],text[])','EXECUTE') then raise exception 'anon denied';end if;
 if not has_function_privilege('authenticated','public.foto_storage_usage(text[],text[])','EXECUTE') then raise exception 'authenticated denied';end if;
end $$;
set role anon;
select public.foto_storage_usage();
reset role;
create role unrelated;
do $$begin if has_function_privilege('unrelated','public.foto_storage_usage(text[],text[])','EXECUTE') then raise exception 'public grant';end if;end$$;
-- The stable RPC must not expose another bucket or mutate storage.
do $$begin if (select count(*) from storage.objects)<>1210 then raise exception 'storage mutation';end if;end$$;
