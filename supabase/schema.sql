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

-- Communities: a shared diary can now be split into multiple communities.
-- One diary entry can be shared into several communities at once (see
-- entry_communities below); a comment belongs to exactly one.
-- This section mirrors what was already set up directly in the Supabase SQL
-- editor for this project; re-running it should be a no-op there.
create table if not exists communities (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  invite_code text not null unique,
  created_by uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

create table if not exists community_members (
  community_id uuid not null references communities(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  joined_at timestamptz not null default now(),
  primary key (community_id, user_id)
);

create table if not exists entry_communities (
  entry_id uuid not null references diary_entries(id) on delete cascade,
  community_id uuid not null references communities(id) on delete cascade,
  primary key (entry_id, community_id)
);

alter table comments add column if not exists community_id uuid references communities(id);
-- Once every existing row has been backfilled with a community_id, tighten this:
-- alter table comments alter column community_id set not null;

alter table diary_entries enable row level security;
alter table comments enable row level security;
alter table communities enable row level security;
alter table community_members enable row level security;
alter table entry_communities enable row level security;

-- Policies are dropped and recreated so this script can be run more than
-- once without erroring if you already ran it partially before.
drop policy if exists "read all entries" on diary_entries;
drop policy if exists "read own community entries" on diary_entries;
create policy "read own community entries" on diary_entries
  for select using (
    exists (
      select 1
      from entry_communities ec
      join community_members m on m.community_id = ec.community_id
      where ec.entry_id = diary_entries.id and m.user_id = auth.uid()
    )
  );

drop policy if exists "insert own entries" on diary_entries;
create policy "insert own entries" on diary_entries
  for insert with check (auth.uid() = author_id);

drop policy if exists "update own entries" on diary_entries;
create policy "update own entries" on diary_entries
  for update using (auth.uid() = author_id) with check (auth.uid() = author_id);

drop policy if exists "read all comments" on comments;
drop policy if exists "read own community comments" on comments;
create policy "read own community comments" on comments
  for select using (
    exists (
      select 1 from community_members m
      where m.community_id = comments.community_id and m.user_id = auth.uid()
    )
  );

drop policy if exists "insert own comments" on comments;
create policy "insert own comments" on comments
  for insert with check (
    auth.uid() = author_id
    and exists (
      select 1 from entry_communities ec
      where ec.entry_id = comments.entry_id and ec.community_id = comments.community_id
    )
  );

drop policy if exists "update own comments" on comments;
create policy "update own comments" on comments
  for update using (auth.uid() = author_id) with check (auth.uid() = author_id);

drop policy if exists "read own communities" on communities;
create policy "read own communities" on communities
  for select using (
    exists (
      select 1 from community_members m
      where m.community_id = communities.id and m.user_id = auth.uid()
    )
  );

drop policy if exists "read own memberships" on community_members;
create policy "read own memberships" on community_members
  for select using (
    exists (
      select 1 from community_members m2
      where m2.community_id = community_members.community_id and m2.user_id = auth.uid()
    )
  );

drop policy if exists "read own entry_communities" on entry_communities;
create policy "read own entry_communities" on entry_communities
  for select using (
    exists (
      select 1 from community_members m
      where m.community_id = entry_communities.community_id and m.user_id = auth.uid()
    )
  );

drop policy if exists "insert entry_communities for own entries" on entry_communities;
create policy "insert entry_communities for own entries" on entry_communities
  for insert with check (
    exists (
      select 1 from diary_entries e
      where e.id = entry_communities.entry_id and e.author_id = auth.uid()
    )
    and exists (
      select 1 from community_members m
      where m.community_id = entry_communities.community_id and m.user_id = auth.uid()
    )
  );

-- Joins the caller into the community identified by an invite code.
-- Returns the community's id; raises if the code doesn't match any community.
create or replace function join_community_by_code(code text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  target_id uuid;
begin
  select id into target_id from communities where invite_code = code;
  if target_id is null then
    raise exception 'invalid invite code';
  end if;
  insert into community_members (community_id, user_id)
  values (target_id, auth.uid())
  on conflict (community_id, user_id) do nothing;
  return target_id;
end;
$$;

-- Creates a new community, generates its invite code, and joins the caller
-- (creator) to it. Returns the new community's id and invite_code.
create or replace function create_community(community_name text)
returns table (id uuid, invite_code text)
language plpgsql
security definer
set search_path = public
as $$
declare
  new_id uuid := gen_random_uuid();
  new_code text := substr(md5(random()::text || clock_timestamp()::text), 1, 8);
begin
  insert into communities (id, name, invite_code, created_by)
  values (new_id, community_name, new_code, auth.uid());
  insert into community_members (community_id, user_id)
  values (new_id, auth.uid());
  return query select new_id, new_code;
end;
$$;

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

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and tablename = 'entry_communities'
  ) then
    alter publication supabase_realtime add table entry_communities;
  end if;
end $$;
