-- Apply via: Supabase dashboard -> SQL editor -> paste -> Run.
-- Adds operation history for the account page.

-- ---- Table ----
create table if not exists public.operations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  op_type text not null check (op_type in ('merge','convert','edit')),
  file_count int not null default 0,
  page_count int not null default 0,
  bytes_in bigint not null default 0,
  bytes_out bigint not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists operations_user_created_idx on public.operations (user_id, created_at desc);

alter table public.operations enable row level security;

drop policy if exists "operations_select_own" on public.operations;
create policy "operations_select_own" on public.operations
  for select using (auth.uid() = user_id);

-- ---- Log RPC ----
create or replace function public.log_operation(
  op_type text,
  file_count int default 0,
  page_count int default 0,
  bytes_in bigint default 0,
  bytes_out bigint default 0
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  new_id uuid;
begin
  if uid is null then raise exception 'not authenticated'; end if;
  if op_type not in ('merge','convert','edit') then raise exception 'invalid op_type'; end if;
  insert into public.operations (user_id, op_type, file_count, page_count, bytes_in, bytes_out)
  values (uid, op_type, coalesce(file_count,0), coalesce(page_count,0), coalesce(bytes_in,0), coalesce(bytes_out,0))
  returning id into new_id;
  return new_id;
end;
$$;
revoke all on function public.log_operation(text,int,int,bigint,bigint) from public, anon;
grant execute on function public.log_operation(text,int,int,bigint,bigint) to authenticated;

-- ---- History RPC ----
create or replace function public.list_my_operations(limit_count int default 20)
returns table (
  id uuid,
  op_type text,
  file_count int,
  page_count int,
  bytes_in bigint,
  bytes_out bigint,
  created_at timestamptz
)
language sql
security definer
set search_path = public
as $$
  select id, op_type, file_count, page_count, bytes_in, bytes_out, created_at
  from public.operations
  where user_id = auth.uid()
  order by created_at desc
  limit greatest(1, least(coalesce(limit_count,20), 100));
$$;
revoke all on function public.list_my_operations(int) from public, anon;
grant execute on function public.list_my_operations(int) to authenticated;

-- ---- Self-delete RPC ----
-- Lets a signed-in user delete their own auth.users row. Cascades will clean up
-- operations, usage_log, etc.
create or replace function public.delete_my_account()
returns void
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null then raise exception 'not authenticated'; end if;
  delete from auth.users where id = uid;
end;
$$;
revoke all on function public.delete_my_account() from public, anon;
grant execute on function public.delete_my_account() to authenticated;
