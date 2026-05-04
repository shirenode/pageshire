-- ============================================================================
-- Pageshire — Database schema (Supabase / PostgreSQL)
--
-- Apply via: Supabase dashboard → SQL editor → paste → Run.
--
-- This file sets up:
--   1. operations table     — Stores a log of every merge/convert/edit operation
--                             performed by authenticated users (for the account
--                             "Recent activity" section).
--   2. log_operation() RPC  — Server calls this after each operation to insert
--                             a row. Runs as SECURITY DEFINER so it can insert
--                             into the table even though the user only has
--                             SELECT via RLS.
--   3. list_my_operations() — Client calls this to fetch the user's own
--                             history (most recent first, capped at 100).
--   4. delete_my_account()  — Lets a signed-in user permanently delete their
--                             auth.users row. ON DELETE CASCADE cleans up
--                             everything else (operations, usage_log, etc.).
--
-- Row-Level Security ensures users can only SELECT their own rows.
-- ============================================================================

-- ---- Table: operations ----
-- Each row represents one completed PDF operation (merge, convert, or edit).
create table if not exists public.operations (
  id uuid primary key default gen_random_uuid(),        -- Unique operation ID
  user_id uuid not null references auth.users(id) on delete cascade,  -- Who performed it
  op_type text not null check (op_type in ('merge','convert','edit')),  -- Operation type
  file_count int not null default 0,    -- Number of input files
  page_count int not null default 0,    -- Total pages in the output PDF
  bytes_in bigint not null default 0,   -- Combined size of uploaded files (bytes)
  bytes_out bigint not null default 0,  -- Size of the output PDF (bytes)
  created_at timestamptz not null default now()  -- When the operation happened
);

-- Index for efficient per-user history queries (newest first).
create index if not exists operations_user_created_idx on public.operations (user_id, created_at desc);

-- Enable Row-Level Security so users can only see their own operations.
alter table public.operations enable row level security;

drop policy if exists "operations_select_own" on public.operations;
create policy "operations_select_own" on public.operations
  for select using (auth.uid() = user_id);

-- ---- RPC: log_operation ----
-- Called by the server after a successful merge/convert/edit.
-- SECURITY DEFINER: runs with the function owner's privileges so it can
-- INSERT into `operations` even though the user's RLS policy only allows SELECT.
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
  uid uuid := auth.uid();   -- The authenticated user's ID (from their JWT)
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
-- Only authenticated users may call this function.
revoke all on function public.log_operation(text,int,int,bigint,bigint) from public, anon;
grant execute on function public.log_operation(text,int,int,bigint,bigint) to authenticated;

-- ---- RPC: list_my_operations ----
-- Returns the caller's most recent operations (up to `limit_count`, max 100).
-- Used by the frontend's "Recent activity" section in the Account modal.
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
  limit greatest(1, least(coalesce(limit_count,20), 100));  -- Clamp between 1 and 100
$$;
revoke all on function public.list_my_operations(int) from public, anon;
grant execute on function public.list_my_operations(int) to authenticated;

-- ---- RPC: delete_my_account ----
-- Lets a signed-in user permanently delete their own auth.users row.
-- ON DELETE CASCADE on the operations.user_id FK will automatically
-- remove all their operation history.
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
