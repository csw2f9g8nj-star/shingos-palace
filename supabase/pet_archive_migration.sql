begin;

alter table public.dogs
  add column if not exists archived_at timestamptz,
  add column if not exists archived_by text;

create index if not exists dogs_archived_at_idx
  on public.dogs (archived_at);

create or replace function public.deactivate_archived_dog_club_membership()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.archived_at is null and new.archived_at is not null then
    update public.club_memberships
    set
      is_active = false,
      deactivated_at = now(),
      updated_at = now(),
      updated_by = coalesce(new.archived_by, updated_by)
    where dog_id = new.id
      and is_active = true;
  end if;

  return new;
end;
$$;

drop trigger if exists dogs_deactivate_club_when_archived on public.dogs;
create trigger dogs_deactivate_club_when_archived
after update of archived_at on public.dogs
for each row
execute function public.deactivate_archived_dog_club_membership();

revoke all on function public.deactivate_archived_dog_club_membership() from public, anon, authenticated;

create or replace function public.validate_club_membership()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  referenced_pet_type text;
  referenced_archived_at timestamptz;
begin
  select pet_type, archived_at
  into referenced_pet_type, referenced_archived_at
  from public.dogs
  where id = new.dog_id;

  if referenced_pet_type is distinct from 'dog' then
    raise exception 'Club memberships may only reference dog profiles.';
  end if;

  if new.is_active and referenced_archived_at is not null then
    raise exception 'Archived dog profiles cannot be active Club members.';
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

revoke all on function public.validate_club_membership() from public, anon, authenticated;

alter table public.bookings drop constraint if exists bookings_dog_id_fkey;
alter table public.bookings
  add constraint bookings_dog_id_fkey
  foreign key (dog_id) references public.dogs(id) on delete restrict;

alter table public.booking_pets drop constraint if exists booking_pets_dog_id_fkey;
alter table public.booking_pets
  add constraint booking_pets_dog_id_fkey
  foreign key (dog_id) references public.dogs(id) on delete restrict;

alter table public.vaccination_records drop constraint if exists vaccination_records_dog_id_fkey;
alter table public.vaccination_records
  add constraint vaccination_records_dog_id_fkey
  foreign key (dog_id) references public.dogs(id) on delete restrict;

alter table public.dog_notes drop constraint if exists dog_notes_dog_id_fkey;
alter table public.dog_notes
  add constraint dog_notes_dog_id_fkey
  foreign key (dog_id) references public.dogs(id) on delete restrict;

alter table public.dog_notes drop constraint if exists dog_notes_related_dog_id_fkey;
alter table public.dog_notes
  add constraint dog_notes_related_dog_id_fkey
  foreign key (related_dog_id) references public.dogs(id) on delete restrict;

alter table public.dog_compatibility drop constraint if exists dog_compatibility_dog_one_id_fkey;
alter table public.dog_compatibility
  add constraint dog_compatibility_dog_one_id_fkey
  foreign key (dog_one_id) references public.dogs(id) on delete restrict;

alter table public.dog_compatibility drop constraint if exists dog_compatibility_dog_two_id_fkey;
alter table public.dog_compatibility
  add constraint dog_compatibility_dog_two_id_fkey
  foreign key (dog_two_id) references public.dogs(id) on delete restrict;

alter table public.reviews drop constraint if exists reviews_pet_id_fkey;
alter table public.reviews
  add constraint reviews_pet_id_fkey
  foreign key (pet_id) references public.dogs(id) on delete restrict;

commit;
