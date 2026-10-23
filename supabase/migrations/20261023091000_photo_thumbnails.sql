-- Durable background jobs; originals and capture uploads never wait for a thumbnail.
create table if not exists public.foto_thumbnail_jobs (
 photo_id text primary key, source_path text not null, status text not null default 'pending',
 attempts integer not null default 0, lease_token uuid, lease_until timestamptz, last_error text,
 updated_at timestamptz not null default now()
);
create table if not exists public.foto_thumbnail_gc(path text primary key check(path like 'thumbnails/%'));
alter table public.foto_thumbnail_jobs enable row level security;
alter table public.foto_thumbnail_gc enable row level security;
revoke all on public.foto_thumbnail_jobs,public.foto_thumbnail_gc from public,anon,authenticated;
grant all on public.foto_thumbnail_jobs,public.foto_thumbnail_gc to service_role;
create index if not exists foto_thumbnail_ready_idx on public.foto_thumbnail_jobs(status,updated_at);

create or replace function public.foto_track_thumbnail() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
 if TG_OP='DELETE' then
   if OLD.thumbnail_path like 'thumbnails/%' then insert into public.foto_thumbnail_gc values(OLD.thumbnail_path) on conflict do nothing;end if;
   delete from public.foto_thumbnail_jobs where photo_id=OLD.id::text;
   return OLD;
 end if;
 if TG_OP='UPDATE' and (NEW.file_path is distinct from OLD.file_path or nullif(NEW.public_url,'') is null) then
   if OLD.thumbnail_path like 'thumbnails/%' then insert into public.foto_thumbnail_gc values(OLD.thumbnail_path) on conflict do nothing;end if;
   NEW.thumbnail_path:=null;
 end if;
 if nullif(NEW.public_url,'') is null then
   delete from public.foto_thumbnail_jobs where photo_id=NEW.id::text;
 elsif NEW.thumbnail_path is null and NEW.file_path ~* '\.(jpe?g|png|webp|avif)$' then
   insert into public.foto_thumbnail_jobs(photo_id,source_path) values(NEW.id::text,NEW.file_path)
    on conflict(photo_id) do update set source_path=excluded.source_path,status='pending',attempts=0,lease_token=null,lease_until=null,updated_at=now()
     where public.foto_thumbnail_jobs.source_path is distinct from excluded.source_path;
 end if;
 return NEW;
end;
$$;
drop trigger if exists foto_thumbnail_track on public.photos;
create trigger foto_thumbnail_track before insert or update of file_path,public_url or delete on public.photos
 for each row execute function public.foto_track_thumbnail();

insert into public.foto_thumbnail_jobs(photo_id,source_path)
select id::text,file_path from public.photos where thumbnail_path is null and nullif(public_url,'') is not null and file_path ~* '\.(jpe?g|png|webp|avif)$'
on conflict do nothing;

create or replace function public.foto_claim_thumbnail() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare job public.foto_thumbnail_jobs;
begin
 select * into job from public.foto_thumbnail_jobs where attempts<5 and
   (status='pending' or (status='working' and lease_until<now())) order by updated_at for update skip locked limit 1;
 if not found then return null;end if;
 update public.foto_thumbnail_jobs set status='working',attempts=attempts+1,lease_token=gen_random_uuid(),lease_until=now()+interval '2 minutes',updated_at=now()
  where photo_id=job.photo_id returning * into job;
 return to_jsonb(job);
end;
$$;
create or replace function public.foto_finish_thumbnail(photo_id text, token uuid, thumbnail text default null, failure text default null) returns boolean
language plpgsql security definer set search_path = '' as $$
declare job public.foto_thumbnail_jobs;
begin
 select * into job from public.foto_thumbnail_jobs j where j.photo_id=foto_finish_thumbnail.photo_id and j.lease_token=token for update;
 if not found then return false;end if;
 if failure is not null then
   update public.foto_thumbnail_jobs j set status=case when attempts>=5 then 'failed' else 'pending' end,last_error=left(failure,300),updated_at=now(),lease_until=null
    where j.photo_id=job.photo_id;
   return false;
 end if;
 if thumbnail is distinct from 'thumbnails/'||job.photo_id||'/'||token||'.jpg' then raise exception 'Ruta de miniatura inválida';end if;
 update public.photos set thumbnail_path=thumbnail where id::text=job.photo_id and file_path=job.source_path and nullif(public_url,'') is not null;
 if not found then return false;end if;
 update public.foto_thumbnail_jobs j set status='done',lease_until=null,last_error=null,updated_at=now() where j.photo_id=job.photo_id;
 return true;
end;
$$;
revoke all on function public.foto_track_thumbnail(),public.foto_claim_thumbnail(),public.foto_finish_thumbnail(text,uuid,text,text) from public;
grant execute on function public.foto_claim_thumbnail(),public.foto_finish_thumbnail(text,uuid,text,text) to service_role;
