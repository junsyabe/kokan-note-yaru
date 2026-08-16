-- Run this once in your Supabase project's SQL Editor.

create extension if not exists "pgcrypto";

-- Diary entries
create table if not exists diary_entries (
  id uuid primary key default gen_random_uuid(),
  author_id uuid not null references auth.users(id) on delete cascade,
  author_name text not null,
  entry_date date not null,
  content text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Comments on diary entries
create table if not exists comments (
  id uuid primary key default gen_random_uuid(),
  entry_id uuid not null references diary_entries(id) on delete cascade,
  author_id uuid not null references auth.users(id) on delete cascade,
  author_name text not null,
  content text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Safe to re-run on a database that was set up before updated_at existed.
alter table diary_entries add column if not exists updated_at timestamptz not null default now();
alter table comments add column if not exists updated_at timestamptz not null default now();

alter table diary_entries enable row level security;
alter table comments enable row level security;

-- Policies are dropped and recreated so this script can be run more than
-- once without erroring if you already ran it partially before.
drop policy if exists "read all entries" on diary_entries;
create policy "read all entries" on diary_entries
  for select using (auth.role() = 'authenticated');

drop policy if exists "insert own entries" on diary_entries;
create policy "insert own entries" on diary_entries
  for insert with check (auth.uid() = author_id);

drop policy if exists "update own entries" on diary_entries;
create policy "update own entries" on diary_entries
  for update using (auth.uid() = author_id) with check (auth.uid() = author_id);

drop policy if exists "read all comments" on comments;
create policy "read all comments" on comments
  for select using (auth.role() = 'authenticated');

drop policy if exists "insert own comments" on comments;
create policy "insert own comments" on comments
  for insert with check (auth.uid() = author_id);

drop policy if exists "update own comments" on comments;
create policy "update own comments" on comments
  for update using (auth.uid() = author_id) with check (auth.uid() = author_id);

-- Realtime so everyone sees new entries/comments live, no polling.
-- Only add a table to the publication if it isn't already a member,
-- otherwise re-running this script would error.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and tablename = 'diary_entries'
  ) then
    alter publication supabase_realtime add table diary_entries;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and tablename = 'comments'
  ) then
    alter publication supabase_realtime add table comments;
  end if;
end $$;
