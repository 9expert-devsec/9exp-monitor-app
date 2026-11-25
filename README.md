# 9Expert Internal Status Monitor

Checks every 9Expert site every 5 minutes — the page itself always, plus an
optional `/api/health` endpoint for in-house projects — and shows them on one
real-time dashboard. Sites are managed by admins on the **Sites** page.

- **Framework:** Next.js 16 (App Router, TypeScript, Turbopack)
- **Data store:** Supabase (Postgres + Realtime)
- **Scheduler:** Supabase `pg_cron` + `pg_net`, every 5 minutes (GitHub Actions for the daily prune and manual runs)
- **Deploy target:** Vercel

The monitor never fetches a monitored site from the browser. All probing happens
server-side in `POST /api/checks/run`.

---

## Environment variables

| Variable                        | Required | Where          | Purpose                                                            |
| ------------------------------- | -------- | -------------- | ------------------------------------------------------------------ |
| `SUPABASE_URL`                  | yes      | server only    | Supabase project URL.                                              |
| `SUPABASE_SERVICE_ROLE_KEY`     | yes      | server only    | Bypasses RLS. The only key that writes. Never expose it.           |
| `CRON_SECRET`                   | yes      | server only    | Shared secret for `/api/checks/run`, `/prune` and `/api/cron/watchdog`. |
| `NEXT_PUBLIC_SUPABASE_URL`      | yes      | browser        | Sign-in, session cookies and Realtime.                             |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | yes      | browser        | Publishable anon key. Alone it reads nothing; with a session, RLS. |

Copy `.env.example` to `.env.local` and fill it in. Generate a secret with
`openssl rand -hex 32`.

The two `NEXT_PUBLIC_*` variables are required since sign-in was added: auth,
the session cookies and Realtime all run on them. The pill on the right of the
top nav shows whether live updates are on (`Live`) or off (`Live updates off`).

### GitHub Actions secrets

The `monitor` (manual only) and `prune` workflows need:

| Secret        | Value                                                    |
| ------------- | -------------------------------------------------------- |
| `MONITOR_URL` | Deployed base URL, no trailing slash (`https://…`)        |
| `CRON_SECRET` | Same value as the app's `CRON_SECRET`                     |

---

## Setup

```bash
npm install

# 1. Apply the migrations in order (Supabase CLI, or paste each into the SQL editor)
supabase db push
#   or: supabase/migrations/20260804090000_init_monitor.sql
#       supabase/migrations/20261124120000_auth_profiles.sql
#       supabase/migrations/20261124150000_sites_managed.sql
#       supabase/migrations/20261124180000_notifications.sql
#       supabase/migrations/20261124200000_watchdog_cron.sql
#       supabase/migrations/20261125100000_checker_cron.sql

# 2. Create the first admin (prints a temporary password once)
npm run create-admin -- --email you@example.com --name "Your Name"

# 3. Run, sign in, and add sites on the Sites page
npm run dev
```

Then confirm Realtime is on for `health_checks` and `incidents` in
**Supabase → Database → Replication**. The migration adds both tables to the
`supabase_realtime` publication, but only if the publication already exists.

---

## Accounts

Email + password through Supabase Auth. There is no public sign-up, no OAuth
and no magic link: an admin creates every account on **Users** (`/users`), and
the first admin comes from `npm run create-admin`. Turn off
**Authentication → Sign In / Providers → Allow new users to sign up** in the
Supabase dashboard as well; the app never calls `signUp`.

- **Roles:** `admin` manages users, sites and notifications;
  `viewer` is read-only but may press "Check now".
- **Temporary passwords:** new accounts and resets get a generated
  16-character password, shown to the admin once. The user must set their own
  (12+ characters) at the next sign-in.
- **Lockout:** 5 wrong passwords for an address lock it for 15 minutes
  (`login_failures`). An unknown email and a wrong password get the same reply.
- **Disabling** an account sets `profiles.disabled` and bans the user in
  Supabase Auth, so their refresh tokens stop working; the next request signs
  them out. An admin cannot disable or demote themselves, and the last active
  admin can never be disabled or demoted.
- **Where it is enforced:** `src/proxy.ts` refreshes the session and redirects
  (signed out → `/login`, disabled → signed out, temporary password →
  `/account/password`). Pages and Server Actions check again on their own
  (`src/lib/session.ts`). `/users` answers a viewer with the normal 404.

---

## Adding a new site

Sign in as an admin, open **Sites** (`/sites`) and press **+ Add site**:

- **Page URL** (required, `https://` only) — the page every check fetches.
- **Health check URL** (optional) — in-house projects that implement
  [the `/api/health` contract](#the-apihealth-contract). Leave it empty for
  outsourced or third-party systems: they get a page check only.
- **Group** — `In-house` or `Outsourced`; **Degraded above (ms)** defaults to
  800 / 1500 for a new site.
- **Test connection** runs the exact same check once without recording it.

The database is the only source of truth; there is no config file or seed
script. The slug (the `/sites/<slug>` URL) is generated from the name on create
and never changes on rename.

**Order:** groups are always `In-house`, then `Outsourced`, then any others A→Z.
Within a group, admins set the order with **Reorder** on the Sites page (drag
rows, or use the arrow buttons); the dashboard and the Sites table both follow
it. New sites, and sites moved to another group, go to the bottom of the group.

**Pausing** a site (the toggle, or *Monitoring enabled* in the drawer) stops
checks but keeps its history. **Deleting** a site removes its whole history
permanently.

To try a URL from the terminal without touching the database:

```bash
npm run probe -- https://www.example.com                                   # page only
npm run probe -- https://www.example.com https://www.example.com/api/health 800
```

---

## Running the checker locally

```bash
npm run dev                     # terminal 1
npm run check:local             # terminal 2
```

`check:local` POSTs to `http://localhost:3000/api/checks/run` with your
`CRON_SECRET`. Extra flags:

```bash
npm run check:local -- --prune                      # run the prune job instead
npm run check:local -- --url https://monitor.example # hit a deployed instance
```

Or by hand:

```bash
curl -X POST http://localhost:3000/api/checks/run \
  -H "x-cron-secret: $CRON_SECRET"
```

A run returns:

```json
{ "checked": 3, "up": 2, "degraded": 1, "down": 0, "duration_ms": 842 }
```

The dashboard's **Check now** button runs the same code via a Server Action.
See [Design decisions](#design-decisions).

---

## The `/api/health` contract

Optional, for in-house projects. A site with a health URL must return
**HTTP 200** with a JSON object from it:

```jsonc
{
  "status": "ok",              // required: "ok" | anything else
  "version": "1.4.2",          // optional, free-form
  "checks": [                  // optional: one entry per dependency
    { "name": "mongodb",  "status": "ok",    "response_ms": 42 },
    { "name": "redis",    "status": "ok",    "response_ms": 3 },
    { "name": "storage",  "status": "error", "response_ms": 5001,
      "error": "connect ETIMEDOUT" }
  ]
}
```

| Field                 | Type     | Required | Notes                                                     |
| --------------------- | -------- | -------- | --------------------------------------------------------- |
| `status`              | string   | yes      | Must be exactly `"ok"` when healthy.                      |
| `checks[]`            | array    | no       | Rendered as chips on the card.                            |
| `checks[].name`       | string   | yes\*    | Short dependency name, e.g. `mongodb`.                    |
| `checks[].status`     | string   | yes\*    | Must be exactly `"ok"` when healthy.                      |
| `checks[].response_ms`| number   | no       | Shown on the chip.                                        |
| `checks[].error`      | string   | no       | Shown as the chip's tooltip.                              |
| `version`             | string   | no       | Stored in the payload; not currently displayed.           |

\* required when `checks[]` is present.

Requirements:

- Always return HTTP 200 when the app itself is serving, even if a dependency is
  broken — signal that through `status` and `checks[]`. Check DB connectivity.
- The endpoint must be publicly reachable and unauthenticated. A 401/403 is
  recorded as `degraded`.
- Keep the payload under 64KB.

### How a site is classified (page-first)

Every run fetches the **page** (`GET url`, redirects followed, 10 s timeout,
`User-Agent: 9ExpertMonitor/1.0 (+internal uptime check)`). If the site has a
health URL and the page answered, the health endpoint is checked next.

| Page                                   | Health check                         | Status     |
| -------------------------------------- | ------------------------------------ | ---------- |
| Not 2xx, network/DNS error, or timeout | (not run)                            | `down`     |
| 2xx, slower than `expected_ms`         | any                                  | `degraded` |
| 2xx                                    | failing, non-2xx, malformed, or a `checks[]` entry not `"ok"` | `degraded` |
| 2xx                                    | OK, or no health URL                 | `up`       |

Only the page can make a site `down` and open an incident. `response_ms` and
`http_status` are the page's; the health call's own status and time are stored
in `health_http_status` / `health_ms`, and its JSON in `payload` (the chips).

Before recording a failed page, the checker **retries once after 2 seconds**.
Only if that also fails is `down` recorded — this is what keeps cold starts
from paging anyone. `degraded` is never retried. The decision table is the pure
function `combineCheck()` in `src/lib/classify.ts`.

---

## Staleness

If the newest check for a site is more than **15 minutes** old, the dashboard
renders it as `stale` (grey hollow diamond) rather than repeating its last known
status, and the header shows a warning that the checker may not be running.

Three consecutive missed runs is the threshold. A monitor that shows green when
it has stopped checking is worse than no monitor at all.

---

## Typography

Two self-hosted families, the same as genesis-lab, declared with
`next/font/local` in `src/app/layout.tsx`. The files live in `src/fonts/` and
**are committed** — `next/font/local` fails the build when they are missing.

| Variable      | Family            | Files                                                        | Used for                         |
| ------------- | ----------------- | ------------------------------------------------------------ | -------------------------------- |
| `--font-en`   | Google Sans       | `GoogleSans-Latin-wght.woff2` (variable, wght 400–700, Latin) | Body, detail, English, numbers   |
| `--font-thai` | LINE Seed Sans TH | `LINESeedSansTH_W_Rg` / `_Bd` / `_He` / `_XBd` `.woff2` (400 / 700 / 800 / 900) | Thai text, headings |

Google Sans is the SIL OFL release; the licence is `src/fonts/OFL.txt`.

In `src/app/globals.css` (`@theme`):

- `--font-sans` = Google Sans, then LINE Seed Sans TH — Thai glyphs fall through
  to LINE Seed.
- `--font-heading` = LINE Seed Sans TH first — `h1`–`h3`, the TV banner headline
  and the TV tile site names.
- `--font-mono` = Google Sans too. There is no monospace family; numbers that
  tick or sit in a column (`font-mono`, `.tv-num`) use Google Sans's tabular
  figures (`font-variant-numeric: tabular-nums`) so digits don't jitter.

---

## Notifications

Admins configure alerts on **Notifications** (`/notifications`). Today the
channel is Slack, through an **Incoming Webhook**; on-screen alerts are always
on; email is not built yet.

- **Webhook URL** is a secret: it is stored in `notification_settings`, read only
  on the server with the service role, shown masked on the page, and never
  logged. The column is excluded from the `authenticated` grant. Only
  `https://hooks.slack.com/…` URLs are accepted.
- **Rules** (only for sites with *Alert when this site goes down* on):
  - *Site goes down* — after the page check's retry confirms it.
  - *Site recovers* — only for a down that was actually posted; includes the
    total downtime. Not held back by quiet hours.
  - *Degraded for more than N min* — once per continuous degraded spell.
  - *Checker stopped* — no result for N+ min (see the watchdog below).
- **Quiet hours** (Bangkok time, may cross midnight): incidents are recorded and
  the delivery log says `suppressed_quiet`; a site still down after the override
  minutes is posted once, marked "during quiet hours". A down that is still
  unposted when quiet hours end is posted then.
- **Exactly once:** each post is preceded by an atomic claim on the incident
  (`notified_at`, `recover_notified_at`, …), and `notification_log` has a unique
  index on sent `incident_key`s, so overlapping runs cannot post twice. A failed
  post releases the claim; the next run retries.
- **Never breaks a run:** Slack has a 5 s timeout and every error is caught and
  logged to `notification_log`, not thrown into the checker.
- Message text comes from `src/lib/notify/slack-message.ts`; the page's preview
  renders the same model, so it cannot drift from what is sent. Links use
  `APP_BASE_URL` (or Vercel's production domain).

### Watchdog: "Checker stopped"

`POST /api/cron/watchdog` (header `x-cron-secret: $CRON_SECRET`) posts once
per stall when the newest check result is older than the configured minutes.
It runs as its own `pg_cron` job, `monitor-watchdog`, separate from the
checker's job — see [Scheduled jobs](#scheduled-jobs). It notices the checker
job failing or `/api/checks/run` erroring; it cannot notice `pg_cron` itself
stopping, since it runs there too.

With Slack off (or no webhook saved) the route answers 200 and posts nothing.

---

## Scripts

| Command             | Does                                              |
| ------------------- | ------------------------------------------------- |
| `npm run dev`       | Dev server                                        |
| `npm run build`     | Production build                                  |
| `npm run check:local` | Fire the checker against a running server       |
| `npm run create-admin` | Create the first admin (see Accounts)          |
| `npm run probe`     | Check one URL with the real check; no DB          |
| `npm run lint`      | ESLint                                            |
| `npm run typecheck` | `tsc --noEmit`                                    |

---

## Scheduled jobs

The 5-minute jobs run inside Supabase: `pg_cron` fires a `security definer`
function in the `private` schema, which POSTs to the app with `pg_net` and the
`x-cron-secret` header.

| Job (pg_cron)       | Schedule      | Calls                  | Migration                         |
| ------------------- | ------------- | ---------------------- | --------------------------------- |
| `monitor-checker`   | `*/5 * * * *` | `/api/checks/run`      | `20261125100000_checker_cron.sql` |
| `monitor-watchdog`  | `*/5 * * * *` | `/api/cron/watchdog`   | `20261124200000_watchdog_cron.sql`|

Both read the target and the secret from **Supabase Vault** at run time, so
nothing secret is in the repo. Until both secrets exist the jobs run and do
nothing:

```sql
select vault.create_secret('<BASE_URL>', 'monitor_base_url');       -- e.g. https://monitor.9expert.app
select vault.create_secret('<CRON_SECRET>', 'monitor_cron_secret'); -- same as CRON_SECRET in Vercel
```

To see them working:

```sql
select jobid, jobname, schedule, active from cron.job order by jobname;
select status, return_message, start_time from cron.job_run_details
  where jobid = (select jobid from cron.job where jobname = 'monitor-checker')
  order by start_time desc limit 10;
select id, status_code, left(content::text, 200), created
  from net._http_response order by created desc limit 10;
```

GitHub Actions keeps two workflows:

| Workflow                          | Trigger                     | Calls               |
| --------------------------------- | --------------------------- | ------------------- |
| `.github/workflows/monitor.yml`   | `workflow_dispatch` (manual) | `/api/checks/run`   |
| `.github/workflows/prune.yml`     | `20 18 * * *` UTC + manual  | `/api/checks/prune` |

`monitor` lost its schedule because GitHub's scheduler is best-effort: it fired
only a few times a day. Use "Run workflow" for a one-off check run. Both
workflows fail on a non-2xx response, so a broken endpoint shows up in the
Actions tab. The staleness threshold stays at 15 minutes (three missed runs).

---

## Security model

- **Writes:** service role only, server-side. RLS defines no write policy for
  `anon` or `authenticated`, so browser writes are denied outright.
- **Reads:** signed-in users only. Pages verify the session, then read via the
  service role in a Server Component. In the database, `anon` has no access to
  any monitoring table; `authenticated` has `SELECT`, which is what Supabase
  Realtime needs to deliver events to the dashboard's signed-in socket.
  `profiles` is readable only row-by-row by its owner; `login_failures` by the
  service role only.
- **Secrets:** `src/lib/env.ts`, `src/lib/checker.ts`, `src/lib/dashboard.ts`
  and `src/lib/supabase/server.ts` all import `server-only`, so pulling any of
  them into a client component is a build error rather than a leak.
- `record_health_check()` and `prune_health_checks()` have `EXECUTE` revoked
  from `anon`/`authenticated`.

---

## Design decisions

Places where this deviates from, or resolves ambiguity in, the original spec:

1. **Next.js 16, not 15.** The repo was scaffolded on 16.3.0. Async `params` /
   `searchParams`, Turbopack, and the React Compiler lint rules all follow from
   that.

2. **`daily_rollups.response_sample_count`.** One column beyond the specified
   schema. `avg_response_ms` is maintained as a running mean, and `down` checks
   record a NULL `response_ms`; without a separate sample count they would drag
   the average toward zero.

3. **One RPC per check instead of four round trips.** `record_health_check()`
   does the insert, the incident transition, and the rollup upsert in a single
   statement. A partial unique index guarantees at most one open incident per
   site, so two overlapping runs cannot both open one. The function returns
   which transition occurred, and the Slack rules (`src/lib/notify/engine.ts`)
   act on it from TypeScript.

4. **"Check now" is a Server Action, not a session-authenticated route.** The
   action verifies the signed-in session itself (any enabled account, viewers
   included), keeps `CRON_SECRET` away from the browser, and calls the same
   `runChecks()` as `POST /api/checks/run`. A 15-second per-instance cooldown stops a
   held-down button from hammering the monitored sites.

5. **Page-first: the page decides `down`, the health check only degrades.**
   Outsourced (PHP) systems cannot add `/api/health`, so a health endpoint is
   optional and every site gets a page check. A page that is not 2xx is `down`;
   a missing, auth-walled or failing health endpoint on a working page is
   `degraded` with the reason in `error`, never `down`.

6. **Rollup days are Bangkok-local, not UTC.** A "day" on the history bar should
   match the day the team actually worked.

7. **Realtime runs on the user's session.** Postgres changes are filtered by
   RLS before delivery, so the subscriber has to be able to read. The browser
   client carries the signed-in session, so `authenticated` needs `SELECT` and
   `anon` needs nothing. Writes remain denied.

8. **Charts are hand-rolled inline SVG.** No charting library. The series is
   bucketed in Postgres by `site_response_series()`, so a 30-day window arrives
   as a few hundred points rather than ~8,600 rows.

9. **Fonts via `next/font/local`, files committed.** Google Sans and LINE Seed
   Sans TH are self-hosted from `src/fonts/`, like genesis-lab. See
   [Typography](#typography).

10. **`incidents` gets `REPLICA IDENTITY FULL`.** Without it, the UPDATE that
    sets `resolved_at` replicates only the primary key and the dashboard cannot
    tell which site recovered.
