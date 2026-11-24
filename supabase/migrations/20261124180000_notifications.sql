-- ===========================================================================
-- Notifications: Slack Incoming Webhook, alert rules, quiet hours, delivery log.
--
--  * notification_settings — one row (id = 1). The webhook URL is a secret:
--    signed-in admins may read every OTHER column (column-level grant); the
--    app reads the URL with the service role only and never sends it to the
--    browser.
--  * notification_log      — one row per delivery attempt. Admins can read.
--  * incidents             — gains "was it posted?" stamps, so a down is posted
--    once and its recovery only follows a posted down.
--  * degraded_episodes     — continuous degraded spells, for "degraded for N+ min".
--
-- Exactly-once: every post is preceded by an atomic claim
-- (`update … set <stamp> = now() where <stamp> is null returning`), and
-- notification_log has a unique index on incident_key for sent rows, so two
-- overlapping check runs cannot post the same event twice.
--
-- Safe to run more than once.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- is_admin() — for RLS. security definer so it can read profiles regardless
-- of the caller's own row policy; it only ever answers about auth.uid().
-- ---------------------------------------------------------------------------
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = (select auth.uid()) and role = 'admin' and not disabled
  );
$$;

revoke execute on function public.is_admin() from public, anon;
grant execute on function public.is_admin() to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- notification_settings (single row)
-- ---------------------------------------------------------------------------
create table if not exists public.notification_settings (
  id                      smallint primary key default 1 check (id = 1),

  slack_enabled           boolean not null default false,
  slack_webhook_url       text,
  slack_last_test_at      timestamptz,
  slack_last_test_ok      boolean,
  slack_last_test_error   text,

  rule_down               boolean not null default true,
  rule_recover            boolean not null default true,
  rule_degraded           boolean not null default false,
  degraded_minutes        int not null default 15 check (degraded_minutes between 1 and 1440),
  rule_checker_stalled    boolean not null default true,
  stalled_minutes         int not null default 15 check (stalled_minutes between 5 and 1440),

  quiet_enabled           boolean not null default true,
  quiet_start             time not null default '00:00',
  quiet_end               time not null default '06:00',
  quiet_override_minutes  int not null default 30 check (quiet_override_minutes between 5 and 1440),

  -- Watchdog bookkeeping: the newest check time a stall was posted / suppressed for.
  stall_notified_for      timestamptz,
  stall_suppressed_for    timestamptz,

  updated_at              timestamptz not null default now(),
  updated_by              uuid references auth.users (id) on delete set null,

  constraint notification_settings_webhook_https check (
    slack_webhook_url is null or slack_webhook_url ~ '^https://hooks\.slack\.com/'
  )
);

insert into public.notification_settings (id) values (1) on conflict (id) do nothing;

alter table public.notification_settings enable row level security;

revoke all on public.notification_settings from anon, authenticated;
-- Every column except the webhook URL (and the watchdog's internal stamps).
grant select (
  id, slack_enabled, slack_last_test_at, slack_last_test_ok, slack_last_test_error,
  rule_down, rule_recover, rule_degraded, degraded_minutes,
  rule_checker_stalled, stalled_minutes,
  quiet_enabled, quiet_start, quiet_end, quiet_override_minutes,
  updated_at, updated_by
) on public.notification_settings to authenticated;
grant update (
  slack_enabled,
  rule_down, rule_recover, rule_degraded, degraded_minutes,
  rule_checker_stalled, stalled_minutes,
  quiet_enabled, quiet_start, quiet_end, quiet_override_minutes,
  updated_at, updated_by
) on public.notification_settings to authenticated;
grant select, insert, update, delete on public.notification_settings to service_role;

drop policy if exists "notification_settings: admin read" on public.notification_settings;
create policy "notification_settings: admin read"
  on public.notification_settings for select to authenticated
  using (public.is_admin());

drop policy if exists "notification_settings: admin update" on public.notification_settings;
create policy "notification_settings: admin update"
  on public.notification_settings for update to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- ---------------------------------------------------------------------------
-- notification_log
-- ---------------------------------------------------------------------------
create table if not exists public.notification_log (
  id            bigserial primary key,
  created_at    timestamptz not null default now(),
  -- Null for site-less events (checker stopped, test). Deleting a site deletes
  -- its log rows with the rest of its history.
  site_id       uuid references public.monitored_sites (id) on delete cascade,
  event         text not null check (event in ('down', 'recover', 'degraded', 'checker_stalled', 'test')),
  channel       text not null default 'slack' check (channel in ('slack')),
  status        text not null check (status in ('sent', 'failed', 'suppressed_quiet', 'skipped_disabled')),
  http_status   int,
  error         text,
  incident_key  text
);

create index if not exists notification_log_created_idx on public.notification_log (created_at desc);

-- A given incident event is delivered at most once.
create unique index if not exists notification_log_sent_once_idx
  on public.notification_log (incident_key)
  where status = 'sent' and incident_key is not null;

alter table public.notification_log enable row level security;
revoke all on public.notification_log from anon, authenticated;
grant select on public.notification_log to authenticated;
grant select, insert, update, delete on public.notification_log to service_role;
grant usage, select on sequence public.notification_log_id_seq to service_role;

drop policy if exists "notification_log: admin read" on public.notification_log;
create policy "notification_log: admin read"
  on public.notification_log for select to authenticated
  using (public.is_admin());

-- ---------------------------------------------------------------------------
-- incidents: delivery stamps (each set once, by an atomic claim)
-- ---------------------------------------------------------------------------
alter table public.incidents
  add column if not exists notified_at           timestamptz,  -- down posted
  add column if not exists override_notified_at  timestamptz,  -- down posted after quiet-hours override
  add column if not exists quiet_suppressed_at   timestamptz,  -- down suppressed by quiet hours (logged once)
  add column if not exists recover_notified_at   timestamptz;  -- recovery posted

-- ---------------------------------------------------------------------------
-- degraded_episodes — continuous degraded spells (opened on the first degraded
-- check, closed on the first check that is not degraded).
-- ---------------------------------------------------------------------------
create table if not exists public.degraded_episodes (
  id                   bigserial primary key,
  site_id              uuid not null references public.monitored_sites (id) on delete cascade,
  started_at           timestamptz not null default now(),
  ended_at             timestamptz,
  notified_at          timestamptz,
  quiet_suppressed_at  timestamptz
);

-- At most one open episode per site (makes "open if none" race-free).
create unique index if not exists degraded_episodes_one_open_idx
  on public.degraded_episodes (site_id)
  where ended_at is null;

alter table public.degraded_episodes enable row level security;
revoke all on public.degraded_episodes from anon, authenticated;
grant select, insert, update, delete on public.degraded_episodes to service_role;
grant usage, select on sequence public.degraded_episodes_id_seq to service_role;

notify pgrst, 'reload schema';
