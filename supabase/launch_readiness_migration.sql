-- Shingo's Palace launch readiness: authoritative capacity and cancellation consent.
-- Run once in the Supabase SQL Editor before deploying the matching application code.

create table if not exists public.service_capacity (
  service text primary key check (service in ('boarding', 'daycare', 'walking')),
  max_capacity integer not null check (max_capacity > 0),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into public.service_capacity (service, max_capacity)
values
  ('boarding', 6),
  ('daycare', 6),
  ('walking', 6)
on conflict (service) do update
set
  max_capacity = excluded.max_capacity,
  is_active = true,
  updated_at = now();

alter table public.bookings
  add column if not exists cancellation_policy_acknowledged boolean not null default false,
  add column if not exists cancellation_policy_acknowledged_at timestamptz;

create index if not exists bookings_capacity_lookup_idx
  on public.bookings (service, dropoff_date, pickup_date, status);

alter table public.service_capacity enable row level security;
revoke all on table public.service_capacity from public, anon, authenticated;
grant select, insert, update, delete on table public.service_capacity to service_role;

create or replace function public.check_service_availability(
  p_service text,
  p_start_date date,
  p_end_date date,
  p_pet_count integer default 1,
  p_exclude_booking_id uuid default null
)
returns table (
  is_available boolean,
  remaining_capacity integer,
  maximum_capacity integer,
  occupied_capacity integer,
  checked_start_date date,
  checked_end_date date
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_capacity integer;
  v_peak_occupancy integer;
  v_last_consumed_date date;
begin
  if p_service not in ('boarding', 'daycare', 'walking') then
    raise exception using errcode = '22023', message = 'invalid_capacity_service';
  end if;
  if p_start_date is null or p_end_date is null or p_pet_count is null or p_pet_count < 1 then
    raise exception using errcode = '22023', message = 'invalid_capacity_request';
  end if;
  if (p_service = 'boarding' and p_end_date <= p_start_date)
     or (p_service <> 'boarding' and p_end_date < p_start_date) then
    raise exception using errcode = '22023', message = 'invalid_capacity_dates';
  end if;

  select sc.max_capacity
    into v_capacity
  from public.service_capacity sc
  where sc.service = p_service and sc.is_active = true;

  if v_capacity is null then
    raise exception using errcode = 'P0001', message = 'service_capacity_not_configured';
  end if;

  v_last_consumed_date := case
    when p_service = 'boarding' then p_end_date - 1
    else p_end_date
  end;

  with requested_days as (
    select day_value::date as service_day
    from generate_series(p_start_date, v_last_consumed_date, interval '1 day') day_value
  ), daily_occupancy as (
    select
      rd.service_day,
      coalesce(sum(greatest(1, b.pet_count)), 0)::integer as occupied
    from requested_days rd
    left join public.bookings b
      on b.service = p_service
     and (p_exclude_booking_id is null or b.id <> p_exclude_booking_id)
     and lower(coalesce(b.status, '')) not in ('cancelled', 'canceled', 'rejected', 'expired')
     and b.dropoff_date is not null
     and (
       (p_service = 'boarding'
         and b.dropoff_date <= rd.service_day
         and coalesce(b.pickup_date, b.dropoff_date + 1) > rd.service_day)
       or
       (p_service <> 'boarding'
         and b.dropoff_date <= rd.service_day
         and coalesce(b.pickup_date, b.dropoff_date) >= rd.service_day)
     )
    group by rd.service_day
  )
  select coalesce(max(daily_occupancy.occupied), 0)
    into v_peak_occupancy
  from daily_occupancy;

  return query select
    v_peak_occupancy + p_pet_count <= v_capacity,
    greatest(0, v_capacity - v_peak_occupancy - p_pet_count),
    v_capacity,
    v_peak_occupancy,
    p_start_date,
    p_end_date;
end;
$$;

revoke all on function public.check_service_availability(text, date, date, integer, uuid)
  from public, anon, authenticated;
grant execute on function public.check_service_availability(text, date, date, integer, uuid)
  to service_role;

create or replace function public.enforce_booking_capacity()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_result record;
  v_old_consumes boolean;
  v_new_consumes boolean;
begin
  v_new_consumes := lower(coalesce(new.status, '')) not in ('cancelled', 'canceled', 'rejected', 'expired');
  if not v_new_consumes then
    return new;
  end if;

  if tg_op = 'UPDATE' then
    v_old_consumes := lower(coalesce(old.status, '')) not in ('cancelled', 'canceled', 'rejected', 'expired');
    if old.service is not distinct from new.service
       and old.dropoff_date is not distinct from new.dropoff_date
       and old.pickup_date is not distinct from new.pickup_date
       and old.pet_count is not distinct from new.pet_count
       and v_old_consumes = v_new_consumes then
      return new;
    end if;
  end if;

  perform pg_advisory_xact_lock(hashtextextended('shingos-capacity:' || new.service, 0));

  select * into v_result
  from public.check_service_availability(
    new.service,
    new.dropoff_date,
    new.pickup_date,
    greatest(1, new.pet_count),
    case when tg_op = 'UPDATE' then new.id else null end
  );

  if not v_result.is_available then
    raise exception using
      errcode = 'P0001',
      message = 'booking_capacity_exceeded',
      detail = format('No capacity remains for %s between %s and %s.', new.service, new.dropoff_date, new.pickup_date);
  end if;

  return new;
end;
$$;

revoke all on function public.enforce_booking_capacity() from public, anon, authenticated;

drop trigger if exists enforce_booking_capacity_trigger on public.bookings;
create trigger enforce_booking_capacity_trigger
before insert or update of service, dropoff_date, pickup_date, pet_count, status
on public.bookings
for each row execute function public.enforce_booking_capacity();
