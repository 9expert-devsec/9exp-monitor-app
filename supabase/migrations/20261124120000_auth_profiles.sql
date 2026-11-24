-- ===========================================================================
-- Auth: profiles, login lockout, and signed-in-only monitoring data.
--
--  * Accounts live in Supabase Auth (email + password). There is no public
--    sign-up: an admin creates every account through the service role.
--  * `profiles` holds the app's view of an account (name, role, disabled,
--    must_change_password). A signed-in user may read only their own row;
--    every write goes through the service role.
--  * `login_failures` backs the 5-attempt / 15-minute lockout. Service role
--    only — the browser never sees it.
--  * Monitoring tables stop being readable by `anon`. The dashboard's server
--    reads use the service role, and Realtime now runs on the signed-in user's
--    session (`authenticated`).
--
-- Safe to run more than once.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- profiles
-- ---------------------------------------------------------------------------
create table if not exists public.profiles (
  id                    uuid primary key references auth.users (id) on delete cascade,
  full_name             text not null,
  role                  text not null default 'viewer' check (role in ('admin', 'viewer')),
  disabled              boolean not null default false,
  must_change_password  boolean not null default true,
  created_at            timestamptz not null default now(),
  -- `on delete set null` so deleting an admin's auth user is not blocked by
  -- the accounts they created.
  created_by            uuid references auth.users (id) on delete set null
);

alter table public.profiles enable row level security;

-- Supabase's default privileges grant new public tables to anon/authenticated;
-- start from nothing and add back exactly what is needed.
revoke all on public.profiles from anon, authenticated;
grant select on public.profiles to authenticated;
grant select, insert, update, delete on public.profiles to service_role;

drop policy if exists "profiles: read own row" on public.profiles;
create policy "profiles: read own row"
  on public.profiles for select to authenticated
  using (id = (select auth.uid()));
-- No insert/update/delete policy: writes are service role only.

-- ---------------------------------------------------------------------------
-- login_failures
-- ---------------------------------------------------------------------------
create table if not exists public.login_failures (
  email         text primary key,
  failed_count  int not null default 0,
  locked_until  timestamptz,
  updated_at    timestamptz not null default now()
);

alter table public.login_failures enable row level security;
-- RLS on with no policies, and no grants: only the service role can touch it.
revoke all on public.login_failures from anon, authenticated;
grant select, insert, update, delete on public.login_failures to service_role;

-- ---------------------------------------------------------------------------
-- Monitoring data: signed-in users only.
--
-- The original policies were `to anon, authenticated`. Replace each with an
-- `authenticated`-only policy, then take the anon grants away.
-- ---------------------------------------------------------------------------
drop policy if exists "monitored_sites are readable" on public.monitored_sites;
drop policy if exists "monitored_sites: signed-in read" on public.monitored_sites;
create policy "monitored_sites: signed-in read"
  on public.monitored_sites for select to authenticated using (true);

drop policy if exists "health_checks are readable" on public.health_checks;
drop policy if exists "health_checks: signed-in read" on public.health_checks;
create policy "health_checks: signed-in read"
  on public.health_checks for select to authenticated using (true);

drop policy if exists "daily_rollups are readable" on public.daily_rollups;
drop policy if exists "daily_rollups: signed-in read" on public.daily_rollups;
create policy "daily_rollups: signed-in read"
  on public.daily_rollups for select to authenticated using (true);

drop policy if exists "incidents are readable" on public.incidents;
drop policy if exists "incidents: signed-in read" on public.incidents;
create policy "incidents: signed-in read"
  on public.incidents for select to authenticated using (true);

revoke all on public.monitored_sites      from anon;
revoke all on public.health_checks        from anon;
revoke all on public.daily_rollups        from anon;
revoke all on public.incidents            from anon;
revoke all on public.latest_health_checks from anon;
revoke all on public.site_24h_stats       from anon;

grant select on public.monitored_sites      to authenticated;
grant select on public.health_checks        to authenticated;
grant select on public.daily_rollups        to authenticated;
grant select on public.incidents            to authenticated;
grant select on public.latest_health_checks to authenticated;
grant select on public.site_24h_stats       to authenticated;

-- The chart RPC is security invoker, so anon would already be refused by the
-- revokes above; take its EXECUTE away too so the intent is explicit.
revoke execute on function public.site_response_series(uuid, timestamptz, integer) from public, anon;
grant execute on function public.site_response_series(uuid, timestamptz, integer) to authenticated, service_role;

notify pgrst, 'reload schema';
