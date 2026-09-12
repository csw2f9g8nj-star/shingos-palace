-- Shingo's Palace payment-method and manual Zelle confirmation fields.
-- Run once in Supabase SQL Editor before deploying the Zelle payment flow.

alter table public.bookings
  add column if not exists deposit_payment_method text,
  add column if not exists balance_payment_method text,
  add column if not exists zelle_deposit_confirmed_at timestamptz,
  add column if not exists zelle_deposit_reference text,
  add column if not exists zelle_deposit_note text,
  add column if not exists zelle_balance_confirmed_at timestamptz,
  add column if not exists zelle_balance_reference text,
  add column if not exists zelle_balance_note text;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'bookings_deposit_payment_method_check'
      and conrelid = 'public.bookings'::regclass
  ) then
    alter table public.bookings
      add constraint bookings_deposit_payment_method_check
      check (deposit_payment_method is null or deposit_payment_method in ('stripe', 'zelle'));
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'bookings_balance_payment_method_check'
      and conrelid = 'public.bookings'::regclass
  ) then
    alter table public.bookings
      add constraint bookings_balance_payment_method_check
      check (balance_payment_method is null or balance_payment_method in ('stripe', 'zelle'));
  end if;
end
$$;

create index if not exists bookings_manual_zelle_deposit_idx
  on public.bookings (payment_status, deposit_payment_method)
  where deposit_payment_method = 'zelle';

create index if not exists bookings_manual_zelle_balance_idx
  on public.bookings (balance_payment_status, balance_payment_method)
  where balance_payment_method = 'zelle';
