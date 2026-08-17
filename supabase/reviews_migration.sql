create table if not exists public.reviews (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.owners(id) on delete cascade,
  booking_id uuid not null references public.bookings(id) on delete cascade,
  pet_id uuid references public.dogs(id) on delete set null,
  rating integer not null,
  review_text text not null,
  status text not null default 'pending',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint reviews_rating_range check (rating between 1 and 5),
  constraint reviews_status_check check (status in ('pending', 'approved', 'rejected')),
  constraint reviews_unique_booking unique (booking_id)
);

create index if not exists reviews_status_created_at_idx on public.reviews(status, created_at desc);
create index if not exists reviews_owner_id_idx on public.reviews(owner_id);
create index if not exists reviews_pet_id_idx on public.reviews(pet_id);

alter table public.reviews enable row level security;

drop policy if exists "No direct client access to reviews" on public.reviews;
create policy "No direct client access to reviews"
  on public.reviews
  for all
  using (false)
  with check (false);
