-- ============================================================
-- Phase 1 — real labor cost, pulled from Toast's Labor API
-- ------------------------------------------------------------
-- One row per real Toast time entry (an actual clocked shift, not a
-- planned/scheduled one — that's a different concept the existing
-- mock /scheduling page deals with, untouched by this table).
-- Wage is resolved once at sync time (employee wage override for
-- that job, falling back to the job's default wage) and stored on
-- the row — same point-in-time-cost philosophy as
-- ingredient_cost_history, not a live join against a current rate.
-- No separate employees/jobs tables: those are fetched fresh each
-- sync run purely to resolve wage_cents/names, not persisted as
-- their own entities.
-- ============================================================
create table if not exists labor_shifts (
  id                    uuid primary key default gen_random_uuid(),
  restaurant_id         uuid not null references restaurants(id) on delete cascade,
  location_id           uuid not null references locations(id) on delete cascade,
  business_date         date not null,
  toast_time_entry_ref  text not null,           -- idempotency key, Toast's timeEntry.guid
  employee_ref          text not null,
  employee_name         text not null,           -- denormalized, same as pmix_sales.name
  job_ref               text,
  job_title             text,
  in_at                 timestamptz not null,
  out_at                timestamptz,             -- null while still clocked in
  regular_hours         numeric not null default 0,
  overtime_hours        numeric not null default 0,
  wage_cents            bigint not null,         -- resolved at sync time, see above
  labor_cost_cents      bigint not null,         -- regular_hours*wage + overtime_hours*wage*1.5, precomputed
  updated_at            timestamptz not null default now(),
  unique (location_id, toast_time_entry_ref)
);

create index if not exists labor_shifts_restaurant_date_idx
  on labor_shifts(restaurant_id, business_date);

alter table labor_shifts enable row level security;

drop policy if exists tenant_isolation on labor_shifts;
create policy tenant_isolation on labor_shifts
  using      (restaurant_id in (select my_restaurants()))
  with check (restaurant_id in (select my_restaurants()));
