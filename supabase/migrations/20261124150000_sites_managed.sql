-- ===========================================================================
-- Sites become DB-managed, with page-first checks.
--
--  * `monitored_sites` is now edited by admins on the Sites page (service role
--    via Server Actions); config/sites.ts and `npm run seed` are gone.
--  * Every site gets a page check (`GET url`). `health_url` becomes optional,
--    for in-house projects that implement the /api/health contract.
--  * `health_checks.http_status` / `response_ms` now describe the PAGE. The
--    health call's own status and timing go in two new nullable columns.
--  * `record_health_check()` gains two trailing optional parameters.
--
-- Existing rows are left alone (sample rows are deleted through the UI).
-- Safe to run more than once.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- monitored_sites
-- ---------------------------------------------------------------------------
alter table public.monitored_sites alter column health_url drop not null;

alter table public.monitored_sites
  add column if not exists alert_enabled boolean not null default true,
  add column if not exists updated_at    timestamptz not null default now(),
  add column if not exists created_by    uuid references auth.users (id) on delete set null;

-- One site per page URL, case-insensitively. The app maps a violation to the
-- "URL already in use" field error.
create unique index if not exists monitored_sites_url_lower_key
  on public.monitored_sites (lower(url));

-- https only, for the page and (when set) the health endpoint.
-- NOTE: fails if an existing row has a non-https url / health_url — fix or
-- delete that row first, then re-run.
alter table public.monitored_sites drop constraint if exists monitored_sites_https_only;
alter table public.monitored_sites
  add constraint monitored_sites_https_only check (
    url ~ '^https://'
    and (health_url is null or health_url ~ '^https://')
  );

-- `slug` keeps its existing unique constraint from the initial migration.

-- Writes stay service-role only: no insert/update/delete policy for any
-- client role. (Select stays `authenticated` from 20261124120000.)

-- ---------------------------------------------------------------------------
-- health_checks: the health endpoint's own result, when one ran.
-- ---------------------------------------------------------------------------
alter table public.health_checks
  add column if not exists health_http_status int,
  add column if not exists health_ms          int;

-- ---------------------------------------------------------------------------
-- record_health_check — same behaviour, two more optional inputs.
--
-- The signature changes, so the 6-argument version is dropped first; exactly
-- one version exists afterwards. Old callers that pass six named arguments
-- still resolve to this one through the defaults.
-- ---------------------------------------------------------------------------
drop function if exists public.record_health_check(uuid, text, int, int, jsonb, text);

create or replace function public.record_health_check(
  p_site_id            uuid,
  p_status             text,
  p_http_status        int,
  p_response_ms        int,
  p_payload            jsonb,
  p_error              text,
  p_health_http_status int default null,
  p_health_ms          int default null
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
    (site_id, checked_at, status, http_status, response_ms, payload, error,
     health_http_status, health_ms)
  values
    (p_site_id, v_checked_at, p_status, p_http_status, p_response_ms, p_payload, p_error,
     p_health_http_status, p_health_ms)
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

-- Same grants as before: service role only.
revoke execute on function public.record_health_check(uuid, text, int, int, jsonb, text, int, int)
  from public, anon, authenticated;
grant execute on function public.record_health_check(uuid, text, int, int, jsonb, text, int, int)
  to service_role;

notify pgrst, 'reload schema';
