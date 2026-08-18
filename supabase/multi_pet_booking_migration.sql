create table if not exists public.booking_pets (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references public.bookings(id) on delete cascade,
  dog_id uuid not null references public.dogs(id) on delete cascade,
  owner_id uuid not null references public.owners(id) on delete cascade,
  pet_type text not null default 'dog' check (pet_type in ('dog', 'cat')),
  role text not null default 'guest',
  nightly_rate numeric(10,2),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint booking_pets_unique unique (booking_id, dog_id)
);

create index if not exists booking_pets_booking_id_idx on public.booking_pets(booking_id);
create index if not exists booking_pets_dog_id_idx on public.booking_pets(dog_id);
create index if not exists booking_pets_owner_id_idx on public.booking_pets(owner_id);

alter table public.booking_pets enable row level security;

drop policy if exists "No direct client access to booking pets" on public.booking_pets;
create policy "No direct client access to booking pets"
on public.booking_pets
for all
using (false)
with check (false);

alter table public.bookings
add column if not exists pet_count integer not null default 1,
add column if not exists booking_pet_summary text,
add column if not exists pricing_breakdown jsonb not null default '[]'::jsonb;

insert into public.booking_pets (booking_id, dog_id, owner_id, pet_type, role)
select
  bookings.id,
  bookings.dog_id,
  bookings.owner_id,
  coalesce(bookings.pet_type, dogs.pet_type, 'dog'),
  'primary'
from public.bookings
left join public.dogs on dogs.id = bookings.dog_id
where bookings.dog_id is not null
on conflict (booking_id, dog_id) do nothing;

update public.bookings
set
  pet_count = greatest(
    1,
    1 + coalesce(additional_dogs, 0) + coalesce(additional_cats, 0)
  ),
  booking_pet_summary = coalesce(
    booking_pet_summary,
    case
      when coalesce(pet_type, 'dog') = 'cat' and greatest(1, 1 + coalesce(additional_cats, 0)) = 1 then '1 cat'
      when coalesce(pet_type, 'dog') = 'cat' then greatest(1, 1 + coalesce(additional_cats, 0))::text || ' cats'
      when greatest(1, 1 + coalesce(additional_dogs, 0)) = 1 then '1 dog'
      else greatest(1, 1 + coalesce(additional_dogs, 0))::text || ' dogs'
    end
  )
where booking_pet_summary is null or pet_count is null;
