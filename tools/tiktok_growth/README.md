# Setnik TikTok Growth Pipeline (NYC & LA)

Zero-cost, automated **Research → Content (Carousels + Short-Form Video) → Publish** pipeline powered by the Gemini free-tier API, Playwright, FFmpeg, and TikTok's Content Posting API (`video.upload`).

Runs on **Monday (NYC)** and **Tuesday (LA)** at 19:00 UTC (2 PM EST / 3 PM EDT)—leaving Wed / Thu / Fri free for the existing show roundup & spotlight batches.

| Day | Market | Output per Run |
| --- | --- | --- |
| **Monday** (`0 19 * * 1`) | **NYC** | 2 researched editorial carousels + 1 short-form MP4 video (**3 drafts**) |
| **Tuesday** (`0 19 * * 2`) | **LA** | 2 researched editorial carousels + 1 short-form MP4 video (**3 drafts**) |

---

## One-Time Setup

### 1. Add `GEMINI_API_KEY` Secret
Open **Settings → Secrets and variables → Actions → Repository secrets** and add:
- `GEMINI_API_KEY` — your Gemini API key (free tier works; uses ~3–5 calls per run).
- *(Optional repository variable)* `GEMINI_MODEL` — defaults to `gemini-3.8-flash`.

All existing Setnik secrets (`TIKTOK_CLIENT_KEY`, `TIKTOK_CLIENT_SECRET`, `TIKTOK_REFRESH_TOKEN`, `PAGES_REPO_PAT`, `GH_SECRETS_PAT`, `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `LISTINGS_FEED_URL_TEMPLATE`) are reused automatically.

### 2. Create Your Pinned Mobile "Seed Inbox" Issue
1. In GitHub, create a label named **`research-seed`**.
2. Open a single issue titled **"Creator Search Insights Seed Inbox"** with the **`research-seed`** label and pin it.
3. Whenever you spot good topics in TikTok's Creator Search Insights app on your phone:
   - Open the GitHub Mobile app → your pinned issue → attach 1–5 screenshots (or type a few topic lines) as a comment → **Send**.
   - `.github/workflows/ingest-research-seeds.yml` automatically runs Gemini Vision, extracts every topic into `tools/tiktok_growth/research_seeds.json`, commits it, and replies with a confirmation table.
   - Only comments from repo owners/collaborators trigger ingestion.

### 3. *(Optional)* Add Evergreen Setnik App B-Roll
Drop 3–5 short 9:16 screen recordings (`.mp4`/`.mov`) into `static/assets/broll/` (see `static/assets/broll/README.md`). Record once; FFmpeg overlays fresh weekly hooks and NYC/LA show cards on top. If the folder is empty, the video renderer automatically falls back to **100% Playwright motion-graphic cards**.

---

## Local Offline Dry-Run

```bash
python3 -m pip install -r tools/tiktok_growth/requirements.txt

# Run Research -> Content -> Editorial Carousels + Short-Form Video (offline mock)
python3 tools/tiktok_growth/run_growth_pipeline.py \
  --metro nyc \
  --date 2026-11-30 \
  --mock \
  --dry-run

# Validate JPEGs + MP4 + generate job_summary.md without touching TikTok API
python3 tools/tiktok_carousels/publish_tiktok_drafts.py \
  --date 2026-11-30 \
  --ready-dir build/growth_ready/2026-11-30 \
  --pages-folder dry-run-2026-11-30 \
  --dry-run \
  --skip-url-poll
```

---

## Reviewing & Posting in TikTok Creator Inbox
- **Photo Carousels:** Open the draft in TikTok Inbox, pick the suggested sound from `$GITHUB_STEP_SUMMARY`, and tap **Post**.
- **Short-Form Videos:** Open the video draft in TikTok Inbox. If the brief used an AI voice-over (`edge-tts`) and you prefer a trending song instead, tap **Add sound → Volume → Original sound = 0%** (captions stay burned in). Copy the caption/hashtags from `$GITHUB_STEP_SUMMARY` and tap **Post**.
