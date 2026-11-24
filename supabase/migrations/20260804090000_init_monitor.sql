-- 9Expert Internal Status Monitor — initial schema.
--
-- Design notes:
--  * All writes go through the service role (the checker route). Anon/authenticated
--    roles get SELECT only, which is what Supabase Realtime needs in order to
--    deliver postgres_changes events to the dashboard.
--  * `record_health_check()` does the insert + incident transition + rollup upsert
--    in one statement so a concurrent run can never open two incidents for the
--    same site.

create extension if not exists pgcrypto;

-- Day boundaries for daily_rollups are Bangkok-local, not UTC — this is an
-- internal tool for a Thailand-based team and a "day" on the history bar should
-- match the day people actually worked.
create or replace function public.monitor_today()
returns date
language sql
stable
as $$
  select (now() at time zone 'Asia/Bangkok')::date;
$$;

-- ---------------------------------------------------------------------------
-- monitored_sites — the registry of things we watch.
-- Seeded from config/sites.ts via `npm run seed`; do not edit by hand.
-- ---------------------------------------------------------------------------
create table public.monitored_sites (
  id          uuid primary key default gen_random_uuid(),
  slug        text unique not null,
  name        text not null,
  url         text not null,
  health_url  text not null,
  group_name  text,
  expected_ms int not null default 1500,
  enabled     boolean not null default true,
  sort_order  int not null default 0,
  created_at  timestamptz not null default now(),

  constraint monitored_sites_expected_ms_positive check (expected_ms > 0)
);

create index monitored_sites_enabled_idx
  on public.monitored_sites (enabled, sort_order);

-- ---------------------------------------------------------------------------
-- health_checks — one row per site per run. Raw; pruned after 30 days.
-- ---------------------------------------------------------------------------
create table public.health_checks (
  id          bigserial primary key,
  site_id     uuid not null references public.monitored_sites (id) on delete cascade,
  checked_at  timestamptz not null default now(),
  status      text not null,
  http_status int,
  response_ms int,
  payload     jsonb,
  error       text,

  constraint health_checks_status_valid check (status in ('up', 'degraded', 'down'))
);

create index health_checks_site_checked_idx
  on public.health_checks (site_id, checked_at desc);

-- Supports the prune job, which scans across all sites by age.
create index health_checks_checked_at_idx
  on public.health_checks (checked_at);

-- ---------------------------------------------------------------------------
-- daily_rollups — one row per site per day, powering the 90-day history bar.
--
-- `response_sample_count` is not in the original spec: it is bookkeeping needed
-- to maintain `avg_response_ms` as a true running mean, because `down` checks
-- often record a NULL response_ms and must not drag the average toward zero.
-- ---------------------------------------------------------------------------
create table public.daily_rollups (
  site_id               uuid not null references public.monitored_sites (id) on delete cascade,
  day                   date not null,
  up_count              int not null default 0,
  degraded_count        int not null default 0,
  down_count            int not null default 0,
  avg_response_ms       int,
  response_sample_count int not null default 0,

  primary key (site_id, day)
);

create index daily_rollups_day_idx
  on public.daily_rollups (day desc);

-- ---------------------------------------------------------------------------
-- incidents — opened when a site goes down, closed when it recovers.
-- ---------------------------------------------------------------------------
create table public.incidents (
  id          bigserial primary key,
  site_id     uuid not null references public.monitored_sites (id) on delete cascade,
  started_at  timestamptz not null default now(),
  resolved_at timestamptz,
  last_error  text,
  http_status int
);

create index incidents_site_resolved_idx
  on public.incidents (site_id, resolved_at);

-- At most one open incident per site. This is what makes the transition logic
-- in record_health_check() safe under concurrent runs.
create unique index incidents_one_open_per_site_idx
  on public.incidents (site_id)
  where resolved_at is null;

-- ---------------------------------------------------------------------------
-- record_health_check — the checker's single write per site.
-- ---------------------------------------------------------------------------
create type public.health_check_outcome as (
  check_id                bigint,
  incident_event          text,   -- 'opened' | 'resolved' | null
  incident_id             bigint,
  incident_started_at     timestamptz,
  incident_resolved_at    timestamptz,
  incident_last_error     text,
  incident_http_status    int
);

create or replace function public.record_health_check(
  p_site_id     uuid,
  p_status      text,
  p_http_status int,
  p_response_ms int,
  p_payload     jsonb,
  p_error       text
)
returns public.health_check_outcome
language plpgsql
as $$
declare
  v_out        public.health_check_outcome;
  v_checked_at timestamptz := now();
  v_day        date := public.monitor_today();
  v_open       public.incidents%rowtype;
begin
  if p_status not in ('up', 'degraded', 'down') then
    raise exception 'record_health_check: invalid status %', p_status;
  end if;

  insert into public.health_checks
    (site_id, checked_at, status, http_status, response_ms, payload, error)
  values
    (p_site_id, v_checked_at, p_status, p_http_status, p_response_ms, p_payload, p_error)
  returning id into v_out.check_id;

  -- Lock the site's open incident (if any) so two overlapping runs serialise here.
  select * into v_open
  from public.incidents
  where site_id = p_site_id and resolved_at is null
  for update;

  if p_status = 'down' and v_open.id is null then
    -- `on conflict do nothing` against the partial unique index: if a run that
    -- started at the same moment won the race, this is a no-op and no second
    -- incident (or second notification) happens.
    insert into public.incidents (site_id, started_at, last_error, http_status)
    values (p_site_id, v_checked_at, p_error, p_http_status)
    on conflict (site_id) where resolved_at is null do nothing
    returning id, started_at, resolved_at, last_error, http_status
    into v_out.incident_id, v_out.incident_started_at, v_out.incident_resolved_at,
         v_out.incident_last_error, v_out.incident_http_status;

    if v_out.incident_id is not null then
      v_out.incident_event := 'opened';
    end if;

  elsif p_status = 'down' then
    -- Still down. Keep the freshest error on the open incident so the detail
    -- page shows why it is *currently* failing, not why it first failed.
    update public.incidents
    set last_error = p_error, http_status = p_http_status
    where id = v_open.id;

  elsif v_open.id is not null then
    update public.incidents
    set resolved_at = v_checked_at
    where id = v_open.id
    returning id, started_at, resolved_at, last_error, http_status
    into v_out.incident_id, v_out.incident_started_at, v_out.incident_resolved_at,
         v_out.incident_last_error, v_out.incident_http_status;
    v_out.incident_event := 'resolved';
  end if;

  insert into public.daily_rollups as r
    (site_id, day, up_count, degraded_count, down_count, avg_response_ms, response_sample_count)
  values (
    p_site_id,
    v_day,
    case when p_status = 'up' then 1 else 0 end,
    case when p_status = 'degraded' then 1 else 0 end,
    case when p_status = 'down' then 1 else 0 end,
    p_response_ms,
    case when p_response_ms is null then 0 else 1 end
  )
  on conflict (site_id, day) do update set
    up_count       = r.up_count + excluded.up_count,
    degraded_count = r.degraded_count + excluded.degraded_count,
    down_count     = r.down_count + excluded.down_count,
    avg_response_ms = case
      when excluded.avg_response_ms is null then r.avg_response_ms
      when r.response_sample_count = 0 then excluded.avg_response_ms
      else round(
        ((r.avg_response_ms::numeric * r.response_sample_count) + excluded.avg_response_ms)
        / (r.response_sample_count + 1)
      )::int
    end,
    response_sample_count = r.response_sample_count + excluded.response_sample_count;

  return v_out;
end;
$$;

-- ---------------------------------------------------------------------------
-- prune_health_checks — batched so a long-neglected table cannot blow the
-- statement timeout in one shot.
-- ---------------------------------------------------------------------------
create or replace function public.prune_health_checks(
  p_retain_days integer default 30,
  p_batch_size  integer default 5000,
  p_max_batches integer default 50
)
returns integer
language plpgsql
as $$
declare
  v_cutoff  timestamptz := now() - make_interval(days => p_retain_days);
  v_deleted integer := 0;
  v_batch   integer;
begin
  for i in 1..p_max_batches loop
    with doomed as (
      select id
      from public.health_checks
      where checked_at < v_cutoff
      limit p_batch_size
    )
    delete from public.health_checks h
    using doomed
    where h.id = doomed.id;

    get diagnostics v_batch = row_count;
    v_deleted := v_deleted + v_batch;
    exit when v_batch < p_batch_size;
  end loop;

  return v_deleted;
end;
$$;

-- ---------------------------------------------------------------------------
-- Read-side helpers for the dashboard.
--
-- `security_invoker` keeps RLS evaluated as the querying role rather than the
-- view owner, so these are not a way around the policies below.
-- ---------------------------------------------------------------------------

-- The newest check per site. Postgres has DISTINCT ON; PostgREST does not,
-- so this has to live in the database.
create view public.latest_health_checks
with (security_invoker = on) as
select distinct on (site_id)
  id, site_id, checked_at, status, http_status, response_ms, payload, error
from public.health_checks
order by site_id, checked_at desc;

-- Rolling 24h mean response time, for the "delta vs. 24h average" figure.
create view public.site_24h_stats
with (security_invoker = on) as
select
  site_id,
  round(avg(response_ms))::int as avg_response_ms,
  count(*)::int               as sample_count
from public.health_checks
where checked_at > now() - interval '24 hours'
  and response_ms is not null
group by site_id;

-- Bucketed response-time series for the detail page chart. Bucketing in SQL
-- keeps a 30-day window at a few hundred points instead of ~8,600 rows.
create or replace function public.site_response_series(
  p_site_id         uuid,
  p_since           timestamptz,
  p_bucket_minutes  integer
)
returns table (
  bucket          timestamptz,
  avg_response_ms int,
  max_response_ms int,
  up_count        int,
  degraded_count  int,
  down_count      int
)
language sql
stable
as $$
  select
    to_timestamp(
      floor(extract(epoch from checked_at) / (p_bucket_minutes * 60))
      * (p_bucket_minutes * 60)
    ) as bucket,
    round(avg(response_ms))::int as avg_response_ms,
    max(response_ms)::int        as max_response_ms,
    (count(*) filter (where status = 'up'))::int       as up_count,
    (count(*) filter (where status = 'degraded'))::int as degraded_count,
    (count(*) filter (where status = 'down'))::int     as down_count
  from public.health_checks
  where site_id = p_site_id
    and checked_at >= p_since
  group by 1
  order by 1;
$$;

-- ---------------------------------------------------------------------------
-- Row Level Security.
--
-- Anon/authenticated may read (the dashboard needs SELECT for Supabase Realtime
-- to deliver events at all). No write policy exists for either role, so every
-- INSERT/UPDATE/DELETE from the browser is denied. The service role bypasses RLS
-- and is the only thing that writes.
-- ---------------------------------------------------------------------------
alter table public.monitored_sites enable row level security;
alter table public.health_checks   enable row level security;
alter table public.daily_rollups   enable row level security;
alter table public.incidents       enable row level security;

create policy "monitored_sites are readable"
  on public.monitored_sites for select to anon, authenticated using (true);

create policy "health_checks are readable"
  on public.health_checks for select to anon, authenticated using (true);

create policy "daily_rollups are readable"
  on public.daily_rollups for select to anon, authenticated using (true);

create policy "incidents are readable"
  on public.incidents for select to anon, authenticated using (true);

-- Explicit table grants: RLS narrows what a role may see, it does not grant the
-- privilege in the first place, and BYPASSRLS does not substitute for a GRANT.
-- Supabase's default privileges normally cover service_role, but spelling it
-- out means this migration stands on its own on any Postgres.
grant select on public.monitored_sites to anon, authenticated;
grant select on public.health_checks   to anon, authenticated;
grant select on public.daily_rollups   to anon, authenticated;
grant select on public.incidents       to anon, authenticated;

grant select, insert, update, delete on public.monitored_sites to service_role;
grant select, insert, update, delete on public.health_checks   to service_role;
grant select, insert, update, delete on public.daily_rollups   to service_role;
grant select, insert, update, delete on public.incidents       to service_role;

grant usage, select on sequence public.health_checks_id_seq to service_role;
grant usage, select on sequence public.incidents_id_seq     to service_role;

grant select on public.latest_health_checks to anon, authenticated, service_role;
grant select on public.site_24h_stats to anon, authenticated, service_role;

-- Writing functions must never be reachable from the browser.
revoke execute on function public.record_health_check(uuid, text, int, int, jsonb, text) from public, anon, authenticated;
revoke execute on function public.prune_health_checks(integer, integer, integer) from public, anon, authenticated;
grant execute on function public.record_health_check(uuid, text, int, int, jsonb, text) to service_role;
grant execute on function public.prune_health_checks(integer, integer, integer) to service_role;

-- ---------------------------------------------------------------------------
-- Realtime.
--
-- `replica identity full` on incidents so the UPDATE that sets resolved_at
-- carries site_id in the payload; without it an update only replicates the
-- primary key and the dashboard cannot tell which site recovered.
-- ---------------------------------------------------------------------------
alter table public.incidents replica identity full;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'health_checks'
    ) then
      alter publication supabase_realtime add table public.health_checks;
    end if;

    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'incidents'
    ) then
      alter publication supabase_realtime add table public.incidents;
    end if;
  end if;
end
$$;

-- PostgREST caches the schema; make sure it picks up the new functions/views.
notify pgrst, 'reload schema';
