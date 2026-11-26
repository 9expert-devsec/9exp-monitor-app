-- ===========================================================================
-- Round 10 — per-site logos for the TV wall.
--
-- monitored_sites.logo_path: the object path inside the `site-logos` bucket
--   ("<site_id>/<random>.<ext>"), never a full URL — the public URL is derived
--   with the storage helper at read time.
-- monitored_sites.logo_mono: render the logo as a white silhouette (default);
--   off for a logo that collapses into a blob when knocked out.
--
-- Storage: a public-read bucket. There are NO insert/update/delete policies for
-- anon or authenticated — uploads and deletes go through the server with the
-- service role only (admin-checked Server Actions). Public read needs no
-- policy: a public bucket serves its objects at /object/public/… directly.
-- ===========================================================================

alter table public.monitored_sites
  add column if not exists logo_path text,
  add column if not exists logo_mono boolean not null default true;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('site-logos', 'site-logos', true, 262144, array['image/png', 'image/webp', 'image/svg+xml'])
on conflict (id) do nothing;

notify pgrst, 'reload schema';
