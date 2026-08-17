-- Shingo's Palace remaining balance payment fields
-- Run this once in Supabase SQL Editor before enabling remaining balance payments.

alter table public.bookings
  add column if not exists balance_payment_status text not null default 'not_started',
  add column if not exists stripe_balance_checkout_session_id text,
  add column if not exists stripe_balance_payment_intent_id text,
  add column if not exists balance_paid_amount text,
  add column if not exists balance_paid_at timestamptz,
  add column if not exists balance_reminder_sent_at timestamptz;

create index if not exists bookings_stripe_balance_checkout_session_id_idx
  on public.bookings (stripe_balance_checkout_session_id);

create index if not exists bookings_balance_reminder_due_idx
  on public.bookings (dropoff_date, balance_payment_status, balance_reminder_sent_at);
