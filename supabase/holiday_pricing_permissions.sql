begin;

grant usage on schema public to service_role;
grant select on table public.holiday_pricing to service_role;

commit;
