-- Hosted projects can grant function execution to anon/authenticated through
-- default privileges. Revoke those direct grants as well as PUBLIC's grant.
revoke all on function public.foto_track_thumbnail(), public.foto_claim_thumbnail(), public.foto_finish_thumbnail(text,uuid,text,text)
 from public, anon, authenticated;
grant execute on function public.foto_claim_thumbnail(), public.foto_finish_thumbnail(text,uuid,text,text) to service_role;
