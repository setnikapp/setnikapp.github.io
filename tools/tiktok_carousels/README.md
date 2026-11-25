# Weekly TikTok Genre Carousels Pipeline

Zero-cost, headless weekly GitHub Actions pipeline inside `setnikapp/setnikapp.github.io`. Every Thursday afternoon (`0 19 * * 4` UTC — 2:00 PM EST / 3:00 PM EDT), it:

1. Selects 2–4 upcoming NYC/NJ Fri–Sun weekend shows per configured genre (up to 5 genres: `rock`, `punk`, `electronic`, `indie`, `metal`) via Setnik Web's live data pipeline (`src/fetch.mjs`).
2. Renders 1080×1920 Setnik app card JPEGs via Playwright Chromium (`render_carousels.py`).
3. Syncs JPEGs into `static/carousels/<pages_folder>/<genre>/`, prunes folders older than 30 days, and pushes to `main` (triggering `.github/workflows/deploy.yml` so slides serve live at `https://setnikapp.github.io/carousels/...`).
4. Polls every live slide URL until HTTP 200 (rejecting 301/302 redirects), uploads up to 5 photo carousel drafts to TikTok Creator Inbox (`MEDIA_UPLOAD` + `PULL_FROM_URL`), rotates `TIKTOK_REFRESH_TOKEN`, and writes inline previews + exact headliner artist names to search in TikTok's native sound library into `$GITHUB_STEP_SUMMARY`.

---

## Required GitHub Repository Secrets

Configure these under **Settings → Secrets and variables → Actions → Repository secrets**:

| Secret | Required For | Notes |
| --- | --- | --- |
| `TIKTOK_CLIENT_KEY` | Live TikTok uploads | App Client Key from TikTok Developer Portal |
| `TIKTOK_CLIENT_SECRET` | Live TikTok uploads | App Client Secret from TikTok Developer Portal |
| `TIKTOK_REFRESH_TOKEN` | Live TikTok uploads | Generated once via `oauth_bootstrap.py`; auto-rotated on every live run |
| `PAGES_REPO_PAT` | Pushing `static/carousels/` to `main` | Fine-grained PAT with `Contents: Read and write` on `setnikapp/setnikapp.github.io` (falls back to `GH_SECRETS_PAT` if omitted; needed so the push triggers `deploy.yml`) |
| `GH_SECRETS_PAT` | Rotating `TIKTOK_REFRESH_TOKEN` | Fine-grained PAT with `Secrets: Read and write` (and optionally `Contents: Read and write`) on `setnikapp/setnikapp.github.io` |

Existing Setnik Web data secrets (`SUPABASE_URL`, `SUPABASE_ANON_KEY`, `LISTINGS_FEED_URL_TEMPLATE`) are reused automatically.

---

## TikTok Developer Portal URL Prefix Verification

TikTok's `PULL_FROM_URL` photo upload requires verifying URL prefix ownership before drafts will succeed:

1. Open **TikTok Developer Portal → Manage Apps → your app → Content Posting API → URL properties**.
2. Add the URL prefix: `https://setnikapp.github.io/carousels/`
3. Download TikTok's verification file (e.g. `tiktokXXXXXXXX.txt`) and commit it to `static/carousels/tiktokXXXXXXXX.txt` so `deploy.yml` publishes it at `https://setnikapp.github.io/carousels/tiktokXXXXXXXX.txt`.
4. Click **Verify** in the TikTok Developer Portal.

---

## One-Time OAuth Bootstrap (`oauth_bootstrap.py`)

Run locally once to obtain your initial `TIKTOK_REFRESH_TOKEN` (uses `scope=video.upload` and TikTok OAuth v2 lowercase hex SHA-256 PKCE):

```bash
python3 -m pip install -r tools/tiktok_carousels/requirements.txt

TIKTOK_CLIENT_KEY="<your-client-key>" \
TIKTOK_CLIENT_SECRET="<your-client-secret>" \
  python3 tools/tiktok_carousels/oauth_bootstrap.py \
  --redirect-uri "https://setnikapp.github.io/"
```

1. Open the printed TikTok authorization URL and approve `video.upload`.
2. Paste the full redirected callback URL back into the terminal.
3. Copy the printed `TIKTOK_REFRESH_TOKEN` into your GitHub Repository Secrets.

---

## Dry-Run Instructions

### In GitHub Actions
1. Go to **Actions → Weekly TikTok Genre Carousels → Run workflow**.
2. Check **`dry_run: true`** (and optionally **`use_mock: true`** to test without Supabase).
3. Slides are published under `static/carousels/dry-run-<YYYY-MM-DD>/`, verified via HTTP 200 polling, and previewed inline in the workflow's **Summary** tab without touching the TikTok API.

### Locally (Offline)
```bash
node tools/tiktok_carousels/select_shows.mjs --date 2026-11-26 --mock
python3 tools/tiktok_carousels/render_carousels.py --input build/carousel_selected/2026-11-26/selected.json
python3 tools/tiktok_carousels/publish_tiktok_drafts.py \
  --date 2026-11-26 \
  --pages-folder dry-run-2026-11-26 \
  --dry-run \
  --skip-url-poll
```
