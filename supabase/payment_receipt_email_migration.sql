alter table public.bookings
  add column if not exists deposit_confirmation_sent_at timestamptz,
  add column if not exists balance_receipt_sent_at timestamptz;
