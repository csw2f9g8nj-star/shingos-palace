alter table public.owners
  add column if not exists auth_user_id uuid;

create unique index if not exists owners_auth_user_id_unique_idx
  on public.owners (auth_user_id)
  where auth_user_id is not null;

create index if not exists owners_email_lower_idx
  on public.owners (lower(email));
