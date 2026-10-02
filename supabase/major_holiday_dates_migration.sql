begin;

-- Derive exact major-holiday dates from the years already configured in
-- holiday_pricing so this table remains the single source of truth.
create temporary table _major_holiday_dates (
  holiday_date date primary key,
  holiday_name text not null
) on commit drop;

insert into _major_holiday_dates (holiday_date, holiday_name)
with active_periods as (
  select
    start_date,
    concat_ws(' ', name, calendar_label) as search_text,
    extract(year from start_date)::integer as start_year
  from public.holiday_pricing
  where active = true
), exact_dates as (
  select
    (
      make_date(start_year, 11, 1)
      + ((4 - extract(dow from make_date(start_year, 11, 1))::integer + 7) % 7)
      + 21
    )::date as holiday_date,
    'Thanksgiving'::text as holiday_name
  from active_periods
  where search_text ilike '%thanksgiving%'

  union all

  select make_date(start_year, 12, 24), 'Christmas Eve'
  from active_periods
  where search_text ilike '%christmas%'

  union all

  select make_date(start_year, 12, 25), 'Christmas Day'
  from active_periods
  where search_text ilike '%christmas%'

  union all

  select
    make_date(
      case when extract(month from start_date) = 1 then start_year - 1 else start_year end,
      12,
      31
    ),
    'New Year''s Eve'
  from active_periods
  where search_text ilike '%new year%'

  union all

  select
    make_date(
      case when extract(month from start_date) = 1 then start_year else start_year + 1 end,
      1,
      1
    ),
    'New Year''s Day'
  from active_periods
  where search_text ilike '%new year%'
)
select distinct holiday_date, holiday_name
from exact_dates;

do $$
declare
  missing_holidays text;
begin
  select string_agg(required.holiday_name, ', ' order by required.holiday_name)
  into missing_holidays
  from (
    values
      ('Thanksgiving'),
      ('Christmas Eve'),
      ('Christmas Day'),
      ('New Year''s Eve'),
      ('New Year''s Day')
  ) as required(holiday_name)
  where not exists (
    select 1
    from _major_holiday_dates as configured
    where configured.holiday_name = required.holiday_name
  );

  if missing_holidays is not null then
    raise exception 'Cannot replace holiday pricing because these configured periods were not found: %', missing_holidays;
  end if;
end;
$$;

-- Preserve every previous pricing period as inactive history. Only the five
-- exact dates staged above will remain active; Memorial Day and all surrounding
-- holiday windows intentionally have no active replacement.
update public.holiday_pricing
set active = false
where active = true;

-- Reuse canonical rows if this migration is run more than once.
update public.holiday_pricing as pricing
set
  start_date = dates.holiday_date,
  end_date = dates.holiday_date,
  tier = 'peak',
  boarding_surcharge = 15,
  daycare_surcharge = 0,
  walking_surcharge = 0,
  calendar_label = dates.holiday_name,
  active = true
from _major_holiday_dates as dates
where pricing.name = concat(
  'Major Holiday: ',
  dates.holiday_name,
  ' ',
  extract(year from dates.holiday_date)::integer
);

insert into public.holiday_pricing (
  name,
  start_date,
  end_date,
  tier,
  boarding_surcharge,
  daycare_surcharge,
  walking_surcharge,
  calendar_label,
  active
)
select
  concat(
    'Major Holiday: ',
    dates.holiday_name,
    ' ',
    extract(year from dates.holiday_date)::integer
  ),
  dates.holiday_date,
  dates.holiday_date,
  'peak',
  15,
  0,
  0,
  dates.holiday_name,
  true
from _major_holiday_dates as dates
where not exists (
  select 1
  from public.holiday_pricing as existing
  where existing.name = concat(
    'Major Holiday: ',
    dates.holiday_name,
    ' ',
    extract(year from dates.holiday_date)::integer
  )
);

commit;
