# 9Expert Internal Status Monitor

Watches every 9Expert project's `/api/health` endpoint and shows them on one
real-time dashboard.

- **Framework:** Next.js 16 (App Router, TypeScript, Turbopack)
- **Data store:** Supabase (Postgres + Realtime)
- **Scheduler:** GitHub Actions, every 5 minutes
- **Deploy target:** Vercel

The monitor never fetches a monitored site from the browser. All probing happens
server-side in `POST /api/checks/run`.

---

## Environment variables

| Variable                        | Required | Where          | Purpose                                                            |
| ------------------------------- | -------- | -------------- | ------------------------------------------------------------------ |
| `SUPABASE_URL`                  | yes      | server only    | Supabase project URL.                                              |
| `SUPABASE_SERVICE_ROLE_KEY`     | yes      | server only    | Bypasses RLS. The only key that writes. Never expose it.           |
| `CRON_SECRET`                   | yes      | server only    | Shared secret for `/api/checks/run` and `/api/checks/prune`.       |
| `NEXT_PUBLIC_SUPABASE_URL`      | no       | browser        | Enables Realtime push updates on the dashboard.                    |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | no       | browser        | Publishable anon key. RLS grants it `SELECT` and nothing else.     |

Copy `.env.example` to `.env.local` and fill it in. Generate a secret with
`openssl rand -hex 32`.

The two `NEXT_PUBLIC_*` variables are optional: without them the dashboard still
works, it just refreshes on navigation and on "Check now" instead of pushing
live updates. There is a visible note on the page when they are missing.

### GitHub Actions secrets

Both workflows need:

| Secret        | Value                                                    |
| ------------- | -------------------------------------------------------- |
| `MONITOR_URL` | Deployed base URL, no trailing slash (`https://…`)        |
| `CRON_SECRET` | Same value as the app's `CRON_SECRET`                     |

---

## Setup

```bash
npm install

# 1. Apply the migration (Supabase CLI, or paste it into the SQL editor)
supabase db push
#   or: supabase/migrations/20260804090000_init_monitor.sql

# 2. Seed the site registry from config/sites.ts
npm run seed

# 3. Run
npm run dev
```

Then confirm Realtime is on for `health_checks` and `incidents` in
**Supabase → Database → Replication**. The migration adds both tables to the
`supabase_realtime` publication, but only if the publication already exists.

---

## Adding a new site

1. Add one entry to [`config/sites.ts`](config/sites.ts):

   ```ts
   {
     slug: 'new-project',
     name: '9Expert New Project',
     url: 'https://new.9expert.co.th',
     healthUrl: 'https://new.9expert.co.th/api/health',
     group: 'Production',
     expectedMs: 1500,
   }
   ```

2. `npm run seed`

That is the whole process. The seed script upserts on `slug`, so it is safe to
run repeatedly, and the array order becomes the display order.

**Removing a site:** delete its entry and re-seed. The row is *disabled*, not
deleted — deleting would cascade away its entire check history. Drop it manually
in Supabase if you really want the history gone.

Never edit `monitored_sites` by hand; the next seed will overwrite it.

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

Every monitored project must expose `GET /api/health` returning **HTTP 200** with
a JSON object:

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

- Respond in under the site's `expectedMs` (default 1500ms). Slower responses
  are classified `degraded`.
- Always return HTTP 200 when the app itself is serving, even if a dependency is
  broken — signal that through `status` and `checks[]`. Returning 5xx opens an
  incident.
- The endpoint must be publicly reachable and unauthenticated. A 401/403 is
  recorded as `degraded`.
- Keep the payload under 64KB.

### How responses are classified

| Result                                                    | Status     |
| --------------------------------------------------------- | ---------- |
| Network error, DNS failure, or timeout (10s)               | `down`     |
| HTTP ≥ 500                                                 | `down`     |
| HTTP 2xx, `status === "ok"`, all checks ok, fast enough    | `up`       |
| HTTP 2xx but `status !== "ok"`                             | `degraded` |
| HTTP 2xx but any `checks[].status !== "ok"`                | `degraded` |
| HTTP 2xx but slower than `expected_ms`                     | `degraded` |
| Non-JSON or malformed body                                 | `degraded` |
| Any other non-2xx (3xx, 4xx)                               | `degraded` |

Before recording `down`, the checker **retries once after 2 seconds**. Only if
that also fails is `down` recorded — this is what keeps cold starts from paging
anyone. `degraded` is never retried.

---

## Staleness

If the newest check for a site is more than **15 minutes** old, the dashboard
renders it as `stale` (grey hollow diamond) rather than repeating its last known
status, and the header shows a warning that the checker may not be running.

Three consecutive missed runs is the threshold. A monitor that shows green when
it has stopped checking is worse than no monitor at all.

---

## Typography

The brand face is **LINE Seed Sans TH**. Its files are licensed per-project and
are not committed. To enable it, drop these into `public/fonts/`:

```
public/fonts/LINESeedSansTH_W_Rg.woff2    (400)
public/fonts/LINESeedSansTH_W_Bd.woff2    (700)
public/fonts/LINESeedSansTH_W_XBd.woff2   (800)
```

`src/app/globals.css` already declares the `@font-face` rules. Until the files
are present the fallback stack (Noto Sans Thai → system sans) renders correctly
in both Thai and Latin.

---

## Notifications

`src/lib/notifier.ts` defines the `Notifier` interface. `NoopNotifier` is the
only implementation today and is called from the incident transition logic in
`src/lib/checker.ts`.

To add Discord later: implement `Notifier`, return it from `getNotifier()`. No
changes to the checker are needed. Failures inside a notifier are logged and
swallowed — a broken webhook must never fail a run or lose a recorded check.

---

## Scripts

| Command             | Does                                              |
| ------------------- | ------------------------------------------------- |
| `npm run dev`       | Dev server                                        |
| `npm run build`     | Production build                                  |
| `npm run seed`      | Sync `monitored_sites` from `config/sites.ts`     |
| `npm run check:local` | Fire the checker against a running server       |
| `npm run lint`      | ESLint                                            |
| `npm run typecheck` | `tsc --noEmit`                                    |

---

## Scheduled jobs

| Workflow                          | Schedule           | Calls                 |
| --------------------------------- | ------------------ | --------------------- |
| `.github/workflows/monitor.yml`   | `*/5 * * * *`      | `/api/checks/run`     |
| `.github/workflows/prune.yml`     | `20 18 * * *` UTC  | `/api/checks/prune`   |

Both support `workflow_dispatch` for manual runs and fail the job on a non-2xx
response, so a broken checker is visible in the Actions tab rather than silently
green.

GitHub's scheduler is best-effort and skews under load; a 5-minute cron often
lands every 6–10 minutes. That is why the staleness threshold is 15 minutes.

---

## Security model

- **Writes:** service role only, server-side. RLS defines no write policy for
  `anon` or `authenticated`, so browser writes are denied outright.
- **Reads:** the dashboard's initial paint reads via the service role in a
  Server Component. `anon` additionally has `SELECT`, which is what Supabase
  Realtime requires to deliver events at all. This data is non-sensitive status
  information that the page already renders.
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
   which transition occurred, and the notifier is invoked from TypeScript.

4. **"Check now" is a Server Action, not a session-authenticated route.** The
   spec asked for `POST /api/checks/run` authenticated by the dashboard session;
   this app has no login. Next.js only accepts Server Actions as same-origin
   POSTs carrying a valid action id, which is a stronger gate than an
   unauthenticated public route and keeps `CRON_SECRET` away from the browser.
   It calls the same `runChecks()`. A 15-second per-instance cooldown stops a
   held-down button from hammering the monitored sites.

5. **Non-2xx below 500 is `degraded`, not `up`.** Read literally, "up —
   everything else" would classify a 404 on `/api/health` as healthy. A missing
   or auth-walled endpoint is recorded as `degraded` with the status line in
   `error`.

6. **Rollup days are Bangkok-local, not UTC.** A "day" on the history bar should
   match the day the team actually worked.

7. **Realtime needs an anon `SELECT` policy.** Postgres changes are filtered by
   RLS before delivery, so a dashboard that subscribes has to be able to read.
   Writes remain denied. The two `NEXT_PUBLIC_*` variables are additions to the
   specified env list, and are optional.

8. **Charts are hand-rolled inline SVG.** No charting library. The series is
   bucketed in Postgres by `site_response_series()`, so a 30-day window arrives
   as a few hundred points rather than ~8,600 rows.

9. **LINE Seed Sans TH via `@font-face`, not `next/font/local`.** The latter
   fails the build outright when the font files are absent, and they are
   licensed per-project. See [Typography](#typography).

10. **`incidents` gets `REPLICA IDENTITY FULL`.** Without it, the UPDATE that
    sets `resolved_at` replicates only the primary key and the dashboard cannot
    tell which site recovered.
