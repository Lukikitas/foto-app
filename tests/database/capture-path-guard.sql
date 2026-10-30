begin;
insert into public.photos(id,file_path,name) values('33333333-3333-4333-8333-333333333333','orders/no_code/guard-test.jpg','Código no encontrado');
do $$
begin
  begin
    insert into public.photos(id,file_path,name) values('44444444-4444-4444-8444-444444444444','orders/no_code/guard-test.jpg','Código no encontrado');
    raise exception 'A client without capture_id duplicated an already registered capture';
  exception when unique_violation then null;
  end;
  if (select count(*) from public.photos where file_path='orders/no_code/guard-test.jpg') <> 1 then raise exception 'Duplicate path'; end if;
end $$;
-- Historical ambiguous references must not trigger an old client's destructive
-- "failed insert" cleanup. Do not rewrite or delete those historical rows.
alter table public.photos disable trigger foto_capture_path_guard;
insert into public.photos(id,file_path,name) values
 ('66666666-6666-4666-8666-666666666666','orders/no_code/legacy-shared-test.jpg','Legacy A'),
 ('77777777-7777-4777-8777-777777777777','orders/no_code/legacy-shared-test.jpg','Legacy B');
alter table public.photos enable trigger foto_capture_path_guard;
insert into public.photos(id,file_path,name) values('88888888-8888-4888-8888-888888888888','orders/no_code/legacy-shared-test.jpg','Legacy retry');
do $$ begin
  if (select count(*) from public.photos where file_path='orders/no_code/legacy-shared-test.jpg') <> 3 then raise exception 'Historical compatibility changed'; end if;
end $$;
-- Revoke EXECUTE must not disable trigger execution for the existing client.
grant insert on public.photos to anon;
set local role anon;
insert into public.photos(id,file_path,name) values('55555555-5555-4555-8555-555555555555','orders/no_code/another-guard-test.jpg','Código no encontrado');
reset role;
rollback;
