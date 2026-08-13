-- Shingo's Palace Stripe deposit fields
-- Run this once in Supabase SQL Editor before enabling Stripe payments.

alter table public.bookings
  add column if not exists payment_status text not null default 'not_started',
  add column if not exists stripe_checkout_session_id text,
  add column if not exists stripe_payment_intent_id text,
  add column if not exists deposit_paid_amount text,
  add column if not exists deposit_paid_at timestamptz;

create index if not exists bookings_stripe_checkout_session_id_idx
  on public.bookings (stripe_checkout_session_id);
