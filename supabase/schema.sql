-- Shingo's Palace private management schema
-- Run this file in Supabase SQL Editor before using booking uploads or the admin area.

create extension if not exists "pgcrypto";

create table if not exists public.owners (
  id uuid primary key default gen_random_uuid(),
  first_name text,
  last_name text,
  email text not null,
  phone text,
  emergency_contact text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.dogs (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.owners(id) on delete cascade,
  name text not null,
  photo_url text,
  breed text,
  age text,
  weight text,
  size text,
  sex text,
  spayed_neutered text,
  vaccinations_up_to_date text,
  medications text,
  allergies text,
  behavioral_concerns text,
  good_with_cats text,
  good_with_small_dogs text,
  can_swim text,
  veterinary_clinic text,
  veterinarian_name text,
  clinic_phone text,
  clinic_address text,
  favorite_activities text,
  feeding_instructions text,
  sleeping_routine text,
  private_behavioral_notes text,
  private_compatibility_notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.bookings (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.owners(id) on delete cascade,
  dog_id uuid not null references public.dogs(id) on delete cascade,
  service text not null,
  dropoff_date date,
  pickup_date date,
  arrival_time time,
  departure_time time,
  area text,
  units integer not null default 1,
  additional_dogs integer not null default 0,
  additional_cats integer not null default 0,
  after_hours boolean not null default false,
  long_stay boolean not null default false,
  notes text,
  emergency_authorization boolean not null default false,
  estimated_total text,
  deposit_due_today text,
  remaining_balance text,
  status text not null default 'new_request',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.vaccination_records (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.owners(id) on delete cascade,
  dog_id uuid not null references public.dogs(id) on delete cascade,
  booking_id uuid references public.bookings(id) on delete set null,
  storage_bucket text not null default 'vaccination-records',
  storage_path text not null,
  original_filename text,
  mime_type text,
  file_size bigint,
  document_status text not null default 'submitted',
  upload_date timestamptz not null default now(),
  expiration_date date,
  version integer not null default 1,
  uploaded_by text,
  archived_at timestamptz
);

create table if not exists public.meet_greet_requests (
  id uuid primary key default gen_random_uuid(),
  owner_name text not null,
  phone text not null,
  email text not null,
  dog_name text not null,
  preferred_day date,
  preferred_time time,
  message text,
  status text not null default 'new_request',
  created_at timestamptz not null default now()
);

create table if not exists public.dog_notes (
  id uuid primary key default gen_random_uuid(),
  dog_id uuid not null references public.dogs(id) on delete cascade,
  related_dog_id uuid references public.dogs(id) on delete set null,
  note_text text not null,
  category text,
  author text,
  created_at timestamptz not null default now()
);

create table if not exists public.dog_compatibility (
  id uuid primary key default gen_random_uuid(),
  dog_one_id uuid not null references public.dogs(id) on delete cascade,
  dog_two_id uuid not null references public.dogs(id) on delete cascade,
  status text not null,
  notes text,
  author text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint dog_compatibility_unique_pair unique (dog_one_id, dog_two_id),
  constraint dog_compatibility_no_self_pair check (dog_one_id <> dog_two_id)
);

alter table public.owners enable row level security;
alter table public.dogs enable row level security;
alter table public.bookings enable row level security;
alter table public.vaccination_records enable row level security;
alter table public.meet_greet_requests enable row level security;
alter table public.dog_notes enable row level security;
alter table public.dog_compatibility enable row level security;

drop policy if exists "No direct client access to owners" on public.owners;
drop policy if exists "No direct client access to dogs" on public.dogs;
drop policy if exists "No direct client access to bookings" on public.bookings;
drop policy if exists "No direct client access to vaccination records" on public.vaccination_records;
drop policy if exists "No direct client access to meet greet requests" on public.meet_greet_requests;
drop policy if exists "No direct client access to dog notes" on public.dog_notes;
drop policy if exists "No direct client access to dog compatibility" on public.dog_compatibility;

-- Direct browser access is intentionally denied. Vercel API routes validate the admin
-- session and then use the server-only Supabase secret key. The secret key bypasses
-- RLS, while public/anon/authenticated clients cannot read these private tables.
create policy "No direct client access to owners" on public.owners for all using (false) with check (false);
create policy "No direct client access to dogs" on public.dogs for all using (false) with check (false);
create policy "No direct client access to bookings" on public.bookings for all using (false) with check (false);
create policy "No direct client access to vaccination records" on public.vaccination_records for all using (false) with check (false);
create policy "No direct client access to meet greet requests" on public.meet_greet_requests for all using (false) with check (false);
create policy "No direct client access to dog notes" on public.dog_notes for all using (false) with check (false);
create policy "No direct client access to dog compatibility" on public.dog_compatibility for all using (false) with check (false);

-- Storage bucket stays private. The public website uploads through Vercel API routes.
-- Admin previews/downloads use short-lived signed URLs generated by the API.
