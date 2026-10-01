alter table public.reviews
  alter column owner_id drop not null,
  alter column booking_id drop not null;

alter table public.reviews
  add column if not exists source text not null default 'booking',
  add column if not exists reviewer_name text,
  add column if not exists reviewer_email text,
  add column if not exists pet_name text,
  add column if not exists service_used text,
  add column if not exists verified_customer boolean not null default false,
  add column if not exists verified_at timestamptz,
  add column if not exists verified_by uuid references auth.users(id) on delete set null,
  add column if not exists archived_at timestamptz,
  add column if not exists client_submission_id uuid;

update public.reviews
set
  source = 'booking',
  verified_customer = true,
  verified_at = coalesce(verified_at, created_at)
where booking_id is not null;

alter table public.reviews
  drop constraint if exists reviews_status_check;

alter table public.reviews
  add constraint reviews_status_check
  check (status in ('pending', 'approved', 'rejected', 'archived'));

alter table public.reviews
  drop constraint if exists reviews_source_check;

alter table public.reviews
  add constraint reviews_source_check
  check (source in ('rover', 'direct', 'booking'));

alter table public.reviews
  drop constraint if exists reviews_source_relationship_check;

alter table public.reviews
  add constraint reviews_source_relationship_check
  check (
    (source = 'booking' and owner_id is not null and booking_id is not null)
    or
    (
      source = 'direct'
      and owner_id is null
      and booking_id is null
      and nullif(btrim(reviewer_name), '') is not null
      and nullif(btrim(reviewer_email), '') is not null
      and nullif(btrim(pet_name), '') is not null
      and nullif(btrim(service_used), '') is not null
      and client_submission_id is not null
    )
    or source = 'rover'
  );

create unique index if not exists reviews_client_submission_id_unique_idx
  on public.reviews(client_submission_id)
  where client_submission_id is not null;

create index if not exists reviews_source_status_created_at_idx
  on public.reviews(source, status, created_at desc);

create index if not exists reviews_reviewer_email_idx
  on public.reviews(lower(reviewer_email))
  where reviewer_email is not null;

grant select, insert, update, delete on table public.reviews to service_role;

alter table public.reviews enable row level security;

drop policy if exists "No direct client access to reviews" on public.reviews;
create policy "No direct client access to reviews"
  on public.reviews
  for all
  using (false)
  with check (false);
