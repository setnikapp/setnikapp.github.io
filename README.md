# Setnik Web

Zero-cost, automated hyperlocal SEO static site and web-to-app conversion funnel for **[Setnik](https://play.google.com/store/apps/details?id=com.setnik.app)** (Android package `com.setnik.app`), hosted on GitHub Pages for **$0/month**.

Every morning at 6:00 AM EST (`0 11 * * *` UTC), GitHub Actions fetches the next 30 days of upcoming concerts, generates mobile-first static HTML pages with Google-compliant `MusicEvent` JSON-LD and 30-second band previews, and deploys directly to GitHub Pages.

---

## How Data Is Sourced (Aligned with the Setnik Android App)

Because the Setnik backend enforces Row-Level Security (RLS) on every table and serves first-party listings through RPCs, `setnik-web` queries the exact same public read interfaces as the Android app:

1. **Remote Kill Switches (Supabase RPCs):**
   - `POST /rest/v1/rpc/get_flags` — reads `jambase_enabled` and `deezer_enabled`
   - `POST /rest/v1/rpc/fp_licensed_switches` — reads `jambase_listings`
2. **First-Party Venue & Flyer Shows (Supabase RPC):**
   - `POST /rest/v1/rpc/fp_public_shows` with `{"p_metro": "<metro>"}` (reads approved public shows from `fp.shows` + `fp.venues` without exposing private `fp.*` tables)
3. **Community Submissions (Supabase `public.submissions`):**
   - `GET /rest/v1/submissions?status=eq.live&metro=eq.<metro>` (covered by anon `SELECT` RLS policy)
4. **Public Listings Feeds (`setnik-listings` GitHub Release `listings`):**
   - `shows-{metro}.json` feeds, automatically skipped if `jambase_enabled` or `jambase_listings` is turned off in Supabase.

All sources are merged and deduplicated by `local_date | venue | headliner` (first-party Supabase records take precedence), filtered to the next 30 days, and compiled into static HTML.

---

## Generated Site Structure & SEO Compliance

- **Homepage (`/`)** — Live-music discovery hub with stats, weekend jump-links, city/borough hubs, top venues, genres, and Google Play CTA.
- **Weekend Hubs (`/<metro>-shows-this-weekend/`)** — e.g. `/nyc-shows-this-weekend/`, `/la-shows-this-weekend/`
- **City, Borough & Neighborhood Hubs (`/<area>-live-music/`)** — e.g. `/nyc-live-music/`, `/brooklyn-live-music/`, `/manhattan-live-music/`, `/queens-live-music/`, `/jersey-city-live-music/`
- **Venue Calendars (`/venues/<venue-slug>/` + `/venues/`)** — e.g. `/venues/gold-sounds/`, `/venues/market-hotel/`
- **Genre Clusters (`/genres/<genre-slug>/` + `/genres/`)** — derived from Setnik's canonical genre tags
- **Individual Show Leaf Pages (`/shows/YYYY-MM-DD-<venue-slug>-<headliner-slug>/`)**
  - **Only** leaf pages emit Schema.org `MusicEvent` JSON-LD (never emitted on hub pages).
  - `MusicEvent` JSON-LD is **strictly gated**: emitted only when the venue has `addressVisibility === 'public'` and a valid physical street address (`PostalAddress`). Shows without a physical street address or with withheld DIY addresses render clean HTML without `MusicEvent` JSON-LD so Google Search Console never flags missing-address errors.
  - `name` contains only the event/lineup title (never venue name, city, or ticket price).
  - `startDate` always includes the full ISO-8601 timestamp with numeric UTC offset (`-05:00` / `-04:00` for `America/New_York`).
  - Every JSON-LD field (`name`, venue, street address, performers, status, description, offers) is visibly rendered in the HTML body.
- **Audio Previews & Web-to-App Tracking:**
  - Direct HTML5 `<audio>` snippet player wherever a static `previewUrl` exists in the data, plus optional progressive-enhancement 30-second Deezer preview playback (gated by Supabase's `deezer_enabled` kill switch) since Deezer signed preview URLs expire after ~45 minutes.
  - Every primary CTA links to Google Play with UTM referrer tracking:
    ```
    https://play.google.com/store/apps/details?id=com.setnik.app&referrer=utm_source%3Dsetnik_web%26utm_medium%3Dseo%26utm_campaign%3D<page_slug>
    ```
- **Root Crawl & Future App-Link Files:**
  - `.nojekyll` (empty file so GitHub Pages serves dot-folders like `.well-known/assetlinks.json` when Android App Links are added later)
  - `robots.txt`
  - `sitemap.xml` and plain-text `sitemap.txt`
  - `404.html`

---

## Local Dry-Run & Testing (Node 22, Zero Dependencies)

No `npm install` required — the generator uses only Node.js built-in modules.

```bash
# Run automated SEO, JSON-LD, HTML parity, and schema unit tests
npm test

# Local dry-run with realistic mock data matching the Supabase schema
npm run build:mock

# Preview the generated dist/ folder locally
npx --yes serve dist
```

CLI options for `node src/build.mjs`:

| Flag | Default | Description |
| --- | --- | --- |
| `--mock` | `false` | Use sample data (`data/sample-shows.mjs`) instead of querying Supabase |
| `--out <dir>` | `./dist` | Output directory |
| `--site-url <url>` | `SITE_URL` env or default GitHub Pages URL | Canonical base URL used in `<link rel="canonical">`, `robots.txt`, and sitemaps |
| `--metros <ids>` | `nyc,la,chi,sf,tor,mtl,van,bos,dc,phl` | Comma-separated metro IDs (top 10 US & Canada by default, or `all` for all 47 Setnik metros) |
| `--window-days <n>` | `30` | Upcoming show window in days |

---

## Setup Guide ($0 GitHub Pages Deployment)

### 1. Enable GitHub Pages (Free)
1. *(Recommended for the cleanest $0 URL)* Create the repository under your dedicated Setnik GitHub account named **`<setnik-username>.github.io`** (e.g. `setnikapp/setnikapp.github.io`) so your site lives cleanly at `https://<setnik-username>.github.io/` with no repo subpath. Any other repo name (like `setnik-web`) also works automatically at `https://<setnik-username>.github.io/setnik-web/`.
2. Open **Settings → Pages** and set **Build and deployment → Source** to **GitHub Actions**.

### 2. Add Required GitHub Secrets
Open **Settings → Secrets and variables → Actions → Secrets** and add:

| Secret Name | Value | Notes |
| --- | --- | --- |
| `SUPABASE_URL` | `https://<your-project-ref>.supabase.co` | Same project URL used by the Android app (`EXPO_PUBLIC_SUPABASE_URL`) |
| `SUPABASE_ANON_KEY` | `<your-supabase-anon-publishable-key>` | Public anon/publishable key only — **never** use `service_role` here |
| `LISTINGS_FEED_URL_TEMPLATE` *(optional)* | `https://github.com/<owner>/setnik-listings/releases/download/listings/shows-{metro}.json` | Stored as a Secret so GitHub masks the URL in public Action logs if the feeds repo is under another handle (can be moved to a Variable once feeds live under your Setnik account) |

*(Paste raw values with no trailing spaces, quotes, or shell prompt characters.)*

### 3. Optional Repository Variables
Open **Settings → Secrets and variables → Actions → Variables** to customize without editing code:

| Variable Name | Default | Purpose |
| --- | --- | --- |
| `SITE_URL` | Auto-detected from GitHub Pages | Override only if you host elsewhere or want an explicit canonical domain |
| `GOOGLE_SITE_VERIFICATION` | *(blank)* | Google Search Console HTML tag token (injected automatically into `<head>`) |
| `SETNIK_METROS` | `nyc,la,chi,sf,tor,mtl,van,bos,dc,phl` | Comma-separated metros to build (top 10 US & Canada by default, prioritizing NYC, LA, Chicago; set `all` for all 47) |
| `INCLUDE_LISTINGS_FEED` | `true` | Set to `false` to build strictly from Supabase (`fp_public_shows` + `public.submissions`) |

### 4. Run Your First Deploy
1. Open the **Actions** tab → **Build and Deploy Setnik Web to GitHub Pages** → **Run workflow**.
2. Wait ~30 seconds for `build` and `deploy` to turn green, then click the deployed GitHub Pages URL.

---

## Google Search Console Verification & Rich Results Check

1. Open [Google Search Console](https://search.google.com/search-console) and click **Add property**.
2. Choose **URL prefix** and enter your exact deployed GitHub Pages URL (e.g. `https://<owner>.github.io/setnik-web/` — or your custom domain if you add one later).
3. Choose the **HTML tag** verification method (zero code edits needed):
   - Copy just the `content="..."` token from Google's meta tag.
   - Add it as a GitHub Repository Variable named `GOOGLE_SITE_VERIFICATION` under **Settings → Secrets and variables → Actions → Variables**.
   - Re-run the deploy workflow, wait ~30 seconds, and click **Verify** in Search Console.
   - *(Alternatively, choose **HTML file**, save Google's `googleXXXXXXXX.html` into `static/`, and push — everything in `static/` is copied into `dist/` automatically.)*
4. Once verified, go to **Sitemaps** in the left menu and submit:
   - `sitemap.xml`
   - `sitemap.txt` *(plain-text fallback)*
5. Paste 2–3 generated `/shows/.../` leaf URLs into Google's [Rich Results Test](https://search.google.com/test/rich-results) to confirm **Events (`MusicEvent`)** passes with zero errors.

---

## Adding Android App Links Later (`.well-known/assetlinks.json`)

This build writes an empty `.nojekyll` file at the root of `dist/` so GitHub Pages never strips dot-prefixed directories. When you later add a custom domain and enable `autoVerify: true` `intentFilters` in the Setnik Android app's `app.json`, save your file at `static/.well-known/assetlinks.json` containing `com.setnik.app` and your Google Play App Signing SHA-256 certificate fingerprint — `build.mjs` copies `static/` into `dist/` automatically.
