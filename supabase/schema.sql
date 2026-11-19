-- Private, account-scoped workspace. No anonymous access or service keys.
create table public.entrega_projects (
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  project_id uuid not null,
  payload jsonb not null check (jsonb_typeof(payload) = 'object'),
  version bigint not null default 1 check (version > 0),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  primary key (owner_id, project_id)
);
alter table public.entrega_projects enable row level security;
revoke all on public.entrega_projects from anon, authenticated;
grant select, insert, update on public.entrega_projects to authenticated;
create policy entrega_read on public.entrega_projects for select to authenticated using ((select auth.uid()) = owner_id);
create policy entrega_insert on public.entrega_projects for insert to authenticated with check ((select auth.uid()) = owner_id);
create policy entrega_update on public.entrega_projects for update to authenticated using ((select auth.uid()) = owner_id) with check ((select auth.uid()) = owner_id);

create function public.entrega_touch_version() returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  new.version := old.version + 1;
  new.updated_at := now();
  return new;
end;
$$;
revoke execute on function public.entrega_touch_version() from public, anon, authenticated;
create trigger entrega_version before update on public.entrega_projects for each row execute function public.entrega_touch_version();
alter publication supabase_realtime add table public.entrega_projects;

insert into storage.buckets (id, name, public, file_size_limit) values ('entrega-anexos','entrega-anexos',false,26214400);
create policy entrega_file_read on storage.objects for select to authenticated
  using (bucket_id = 'entrega-anexos' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy entrega_file_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'entrega-anexos' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy entrega_file_delete on storage.objects for delete to authenticated
  using (bucket_id = 'entrega-anexos' and (storage.foldername(name))[1] = (select auth.uid())::text);
