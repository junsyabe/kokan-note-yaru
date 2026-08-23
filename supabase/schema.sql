-- Run this once in your Supabase project's SQL Editor.

create extension if not exists "pgcrypto";

-- Diary entries
create table if not exists diary_entries (
  id uuid primary key default gen_random_uuid(),
  author_id uuid not null references auth.users(id) on delete cascade,
  author_name text not null,
  entry_date date not null,
  title text,
  content text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
-- Safe to re-run on a database that was set up before title existed.
alter table diary_entries add column if not exists title text;

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
  display_name text,
  joined_at timestamptz not null default now(),
  primary key (community_id, user_id)
);
-- Safe to re-run on a database that was set up before display_name existed.
alter table community_members add column if not exists display_name text;

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

-- security definer so the membership check bypasses RLS internally.
-- community_members' own SELECT policy needs this: a plain EXISTS subquery
-- against community_members from within community_members' own policy
-- causes Postgres to re-evaluate that same policy for the subquery's rows,
-- and so on forever ("infinite recursion detected in policy for relation
-- community_members"). Routing the check through this function breaks the
-- loop, since the function's internal query isn't subject to RLS. Every
-- policy below that needs a "is auth.uid() a member of this community"
-- check uses this function instead of an inline EXISTS against
-- community_members, for the same reason.
create or replace function is_community_member(target_community_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from community_members
    where community_id = target_community_id and user_id = auth.uid()
  );
$$;

-- Same reasoning, for entry_communities' INSERT policy: checking entry
-- ownership via a plain EXISTS against diary_entries would trigger
-- diary_entries' own SELECT policy, which itself queries entry_communities
-- (to check community linkage) — a cross-table cycle that Postgres also
-- reports as infinite recursion, just spanning two tables instead of one.
create or replace function is_entry_author(target_entry_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from diary_entries
    where id = target_entry_id and author_id = auth.uid()
  );
$$;

-- Policies are dropped and recreated so this script can be run more than
-- once without erroring if you already ran it partially before.
drop policy if exists "read all entries" on diary_entries;
drop policy if exists "read own community entries" on diary_entries;
create policy "read own community entries" on diary_entries
  for select using (
    exists (
      select 1 from entry_communities ec
      where ec.entry_id = diary_entries.id and is_community_member(ec.community_id)
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
  for select using ( is_community_member(comments.community_id) );

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
  for select using ( is_community_member(communities.id) );

drop policy if exists "read own memberships" on community_members;
create policy "read own memberships" on community_members
  for select using ( is_community_member(community_id) );

-- Lets a member update their own display_name (used by the rename-yourself
-- profile feature); does not allow touching anyone else's row.
drop policy if exists "update own membership" on community_members;
create policy "update own membership" on community_members
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "read own entry_communities" on entry_communities;
create policy "read own entry_communities" on entry_communities
  for select using ( is_community_member(entry_communities.community_id) );

drop policy if exists "insert entry_communities for own entries" on entry_communities;
create policy "insert entry_communities for own entries" on entry_communities
  for insert with check (
    is_entry_author(entry_communities.entry_id)
    and is_community_member(entry_communities.community_id)
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
  caller_name text;
begin
  select id into target_id from communities where invite_code = code;
  if target_id is null then
    raise exception 'invalid invite code';
  end if;
  select coalesce(raw_user_meta_data->>'display_name', email) into caller_name
  from auth.users where id = auth.uid();
  insert into community_members (community_id, user_id, display_name)
  values (target_id, auth.uid(), caller_name)
  on conflict (community_id, user_id) do update set display_name = excluded.display_name;
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
  caller_name text;
begin
  select coalesce(raw_user_meta_data->>'display_name', email) into caller_name
  from auth.users where id = auth.uid();
  insert into communities (id, name, invite_code, created_by)
  values (new_id, community_name, new_code, auth.uid());
  insert into community_members (community_id, user_id, display_name)
  values (new_id, auth.uid(), caller_name);
  return query select new_id, new_code;
end;
$$;

-- Web push subscriptions, one row per device/browser a user enabled
-- notifications on. The sending side is a separately-deployed Supabase Edge
-- Function ("send-notification", not part of this repo) invoked by the
-- triggers below.
create table if not exists push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth_key text not null,
  created_at timestamptz not null default now()
);

alter table push_subscriptions enable row level security;

drop policy if exists "read own push subscriptions" on push_subscriptions;
create policy "read own push subscriptions" on push_subscriptions
  for select using (auth.uid() = user_id);

drop policy if exists "insert own push subscriptions" on push_subscriptions;
create policy "insert own push subscriptions" on push_subscriptions
  for insert with check (auth.uid() = user_id);

drop policy if exists "update own push subscriptions" on push_subscriptions;
create policy "update own push subscriptions" on push_subscriptions
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Fires the send-notification Edge Function on new entries/comments via
-- pg_net (this project's Studio has no Database Webhooks UI, so the
-- webhook is wired up as plain triggers instead). The Edge Function must
-- have "Verify JWT with legacy secret" disabled, since net.http_post here
-- carries no JWT.
create extension if not exists pg_net with schema extensions;

create or replace function notify_diary_entries()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform net.http_post(
    url := 'https://htmekgvedrabadaglqjx.supabase.co/functions/v1/send-notification',
    headers := jsonb_build_object('Content-Type', 'application/json'),
    body := jsonb_build_object('table', 'diary_entries', 'record', row_to_json(new))
  );
  return new;
end;
$$;

drop trigger if exists trg_notify_diary_entries on diary_entries;
create trigger trg_notify_diary_entries
after insert on diary_entries
for each row execute function notify_diary_entries();

create or replace function notify_comments()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform net.http_post(
    url := 'https://htmekgvedrabadaglqjx.supabase.co/functions/v1/send-notification',
    headers := jsonb_build_object('Content-Type', 'application/json'),
    body := jsonb_build_object('table', 'comments', 'record', row_to_json(new))
  );
  return new;
end;
$$;

drop trigger if exists trg_notify_comments on comments;
create trigger trg_notify_comments
after insert on comments
for each row execute function notify_comments();

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
