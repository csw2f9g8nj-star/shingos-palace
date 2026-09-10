-- Shingo's Palace Club membership and friendship foundation.
-- Phase 1 only: this migration does not create opportunities or invitations.

create extension if not exists "pgcrypto";

create table if not exists public.club_memberships (
  id uuid primary key default gen_random_uuid(),
  dog_id uuid not null references public.dogs(id) on delete restrict,
  is_active boolean not null default true,
  joined_at timestamptz not null default now(),
  deactivated_at timestamptz,
  created_by text,
  updated_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint club_memberships_unique_dog unique (dog_id)
);

create table if not exists public.club_matches (
  id uuid primary key default gen_random_uuid(),
  dog_one_id uuid not null references public.dogs(id) on delete restrict,
  dog_two_id uuid not null references public.dogs(id) on delete restrict,
  notes text,
  is_active boolean not null default true,
  deactivated_at timestamptz,
  created_by text,
  updated_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint club_matches_no_self_match check (dog_one_id <> dog_two_id),
  constraint club_matches_canonical_order check (dog_one_id::text < dog_two_id::text),
  constraint club_matches_unique_pair unique (dog_one_id, dog_two_id)
);

create index if not exists club_memberships_active_idx
  on public.club_memberships (is_active, joined_at desc);

create index if not exists club_matches_dog_one_active_idx
  on public.club_matches (dog_one_id, is_active);

create index if not exists club_matches_dog_two_active_idx
  on public.club_matches (dog_two_id, is_active);

create or replace function public.validate_club_membership()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if not exists (
    select 1
    from public.dogs
    where id = new.dog_id
      and pet_type = 'dog'
  ) then
    raise exception 'Only an existing dog can have a Club membership.';
  end if;

  new.updated_at = now();

  if new.is_active then
    new.deactivated_at = null;
  elsif tg_op = 'INSERT' then
    new.deactivated_at = now();
  elsif old.is_active = true then
    new.deactivated_at = now();
  end if;

  return new;
end;
$$;

drop trigger if exists validate_club_membership_trigger on public.club_memberships;
create trigger validate_club_membership_trigger
before insert or update
on public.club_memberships
for each row
execute function public.validate_club_membership();

create or replace function public.validate_active_club_match()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.is_active and (
    select count(*)
    from public.club_memberships
    where dog_id in (new.dog_one_id, new.dog_two_id)
      and is_active = true
  ) <> 2 then
    raise exception 'Both dogs must be active Club members before they can be matched.';
  end if;

  new.updated_at = now();

  if new.is_active then
    new.deactivated_at = null;
  elsif tg_op = 'INSERT' then
    new.deactivated_at = now();
  elsif old.is_active = true then
    new.deactivated_at = now();
  end if;

  return new;
end;
$$;

drop trigger if exists validate_active_club_match_trigger on public.club_matches;
create trigger validate_active_club_match_trigger
before insert or update
on public.club_matches
for each row
execute function public.validate_active_club_match();

create or replace function public.deactivate_club_matches_with_membership()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if old.is_active = true and new.is_active = false then
    update public.club_matches
    set
      is_active = false,
      deactivated_at = now(),
      updated_at = now(),
      updated_by = coalesce(new.updated_by, updated_by)
    where is_active = true
      and (dog_one_id = new.dog_id or dog_two_id = new.dog_id);
  end if;

  return new;
end;
$$;

drop trigger if exists deactivate_club_matches_with_membership_trigger on public.club_memberships;
create trigger deactivate_club_matches_with_membership_trigger
after update of is_active
on public.club_memberships
for each row
execute function public.deactivate_club_matches_with_membership();

alter table public.club_memberships enable row level security;
alter table public.club_matches enable row level security;

drop policy if exists "No direct client access to club memberships" on public.club_memberships;
create policy "No direct client access to club memberships"
  on public.club_memberships
  for all
  using (false)
  with check (false);

drop policy if exists "No direct client access to club matches" on public.club_matches;
create policy "No direct client access to club matches"
  on public.club_matches
  for all
  using (false)
  with check (false);

revoke all on table public.club_memberships from anon, authenticated;
revoke all on table public.club_matches from anon, authenticated;
grant select, insert, update, delete on table public.club_memberships to service_role;
grant select, insert, update, delete on table public.club_matches to service_role;
