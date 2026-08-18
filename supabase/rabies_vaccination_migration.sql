-- Shingo's Palace rabies vaccination status support.
-- Run this in Supabase SQL Editor before deploying the related booking/profile code.

alter table public.dogs
  add column if not exists rabies_vaccination_up_to_date text;

