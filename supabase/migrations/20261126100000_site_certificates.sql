-- ===========================================================================
-- Round 9 — SSL expiry.
--
-- site_certificates: one row per site, the last TLS certificate read for its
-- host. Written by the checker (service role) at most once per 24 h per site;
-- read by the TV wall through the service role. Like degraded_episodes, no
-- client role can touch it.
--
-- Also lets notification_log record the new 'ssl_expiry' Slack event.
-- ===========================================================================

create table if not exists public.site_certificates (
  site_id                  uuid primary key references public.monitored_sites (id) on delete cascade,
  valid_to                 timestamptz,
  issuer                   text,
  subject                  text,
  authorized               boolean,
  checked_at               timestamptz not null,
  last_error               text,
  -- Consecutive daily lookups that failed (reset to 0 on success).
  failed_days              int not null default 0 check (failed_days >= 0),
  -- Last Slack threshold announced for the current valid_to (30 / 14 / 7 / 0).
  last_notified_threshold  int check (last_notified_threshold in (30, 14, 7, 0))
);

alter table public.site_certificates enable row level security;
revoke all on public.site_certificates from anon, authenticated;
grant select, insert, update, delete on public.site_certificates to service_role;

-- notification_log.event: add 'ssl_expiry'.
alter table public.notification_log drop constraint if exists notification_log_event_check;
alter table public.notification_log
  add constraint notification_log_event_check
  check (event in ('down', 'recover', 'degraded', 'checker_stalled', 'test', 'ssl_expiry'));

notify pgrst, 'reload schema';
