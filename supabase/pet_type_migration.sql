-- Shingo's Palace pet type support for dog and cat bookings.
-- Run this in Supabase SQL Editor after the existing launch migrations.

alter table public.dogs
  add column if not exists pet_type text not null default 'dog';

alter table public.bookings
  add column if not exists pet_type text not null default 'dog';

alter table public.dogs
  drop constraint if exists dogs_pet_type_check,
  add constraint dogs_pet_type_check check (pet_type in ('dog', 'cat'));

alter table public.bookings
  drop constraint if exists bookings_pet_type_check,
  add constraint bookings_pet_type_check check (pet_type in ('dog', 'cat'));

create index if not exists dogs_pet_type_idx on public.dogs (pet_type);
create index if not exists bookings_pet_type_idx on public.bookings (pet_type);
