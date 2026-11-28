#!/usr/bin/env python3
"""Research Agent: gathers NYC/LA trend signals + Creator Search Insights seeds -> briefs.json.

Sources:
1. Unconsumed seeds from tools/tiktok_growth/research_seeds.json (highest priority)
2. Reddit Audience Listener (NYC & LA music/concert subreddits)
3. Google Autocomplete Search Trend Scout
4. Live Setnik concert inventory (inventory.json from export_metro_shows.mjs)
5. Deduplication against tools/tiktok_growth/content_log.json (last 21 days)

Usage:
    python3 tools/tiktok_growth/research_agent.py \
      --metro nyc \
      --date 2026-11-30 \
      --inventory build/growth/2026-11-30/nyc/inventory.json \
      --out build/growth/2026-11-30/nyc/briefs.json
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
from datetime import date, timedelta
from pathlib import Path
from typing import Any
from urllib.parse import quote_plus

import httpx

REPO_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_SEEDS_PATH = REPO_ROOT / "tools" / "tiktok_growth" / "research_seeds.json"
DEFAULT_LOG_PATH = REPO_ROOT / "tools" / "tiktok_growth" / "content_log.json"

if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from tools.tiktok_growth.gemini_client import GeminiClient  # noqa: E402

METRO_CONFIG: dict[str, dict[str, Any]] = {
    "nyc": {
        "display_name": "NYC",
        "city_label": "New York City",
        "subreddits": ["avesNYC", "Brooklyn", "AskNYC", "indieheads"],
        "autocomplete_stems": [
            "concerts in nyc ",
            "underground shows brooklyn ",
            "live music nyc ",
            "raves in nyc ",
        ],
    },
    "la": {
        "display_name": "LA",
        "city_label": "Los Angeles",
        "subreddits": ["avesLA", "LosAngeles", "aves", "Concerts"],
        "autocomplete_stems": [
            "concerts in la ",
            "underground shows los angeles ",
            "live music la ",
            "raves in la ",
        ],
    },
}

MUSIC_KEYWORDS = (
    "concert",
    "show",
    "venue",
    "rave",
    "ticket",
    "gig",
    "band",
    "dj",
    "club",
    "live music",
    "setlist",
    "brooklyn",
    "bushwick",
    "silver lake",
    "echo park",
    "underground",
    "diy",
    "techno",
    "house",
    "punk",
    "indie",
    "metal",
    "electronic",
    "lineup",
    "festival",
)

RESEARCH_SYSTEM_INSTRUCTION = (
    "You are the Growth Research Strategist for Setnik, a mobile app that helps live-music "
    "fans discover local underground & indie/electronic/rock shows with 30-second band previews "
    "and a fast swipeable deck (no Ticketmaster bloat). "
    "Return strictly valid JSON."
)


def fetch_reddit_signals(
    metro: str,
    http_client: httpx.Client | None = None,
    limit_per_sub: int = 8,
) -> list[dict[str, Any]]:
    """Fetch recent music/nightlife Reddit posts for the target metro (best-effort)."""
    cfg = METRO_CONFIG.get(metro, METRO_CONFIG["nyc"])
    headers = {"User-Agent": "SetnikGrowthResearch/1.0 (+https://setnikapp.github.io)"}
    own_client = http_client is None
    client = http_client or httpx.Client(timeout=12.0, follow_redirects=True)
    results: list[dict[str, Any]] = []
    try:
        for sub in cfg["subreddits"]:
            url = f"https://www.reddit.com/r/{sub}/hot.json?limit={limit_per_sub}"
            try:
                resp = client.get(url, headers=headers)
                if resp.status_code != 200:
                    continue
                children = ((resp.json().get("data") or {}).get("children")) or []
                for child in children:
                    post = child.get("data") or {}
                    if post.get("stickied"):
                        continue
                    title = str(post.get("title") or "").strip()
                    if not title:
                        continue
                    # For general city subs, filter to music/nightlife relevance
                    if sub in {"Brooklyn", "AskNYC", "LosAngeles"}:
                        low = title.lower()
                        if not any(kw in low for kw in MUSIC_KEYWORDS):
                            continue
                    results.append(
                        {
                            "subreddit": sub,
                            "title": title[:180],
                            "score": int(post.get("score") or 0),
                            "num_comments": int(post.get("num_comments") or 0),
                        }
                    )
            except Exception:
                continue
    finally:
        if own_client:
            client.close()

    results.sort(key=lambda r: (r["num_comments"] * 2 + r["score"]), reverse=True)
    return results[:15]


def fetch_autocomplete_signals(
    metro: str,
    http_client: httpx.Client | None = None,
) -> list[str]:
    """Fetch Google Autocomplete search suggestions for NYC/LA live-music stems (best-effort)."""
    cfg = METRO_CONFIG.get(metro, METRO_CONFIG["nyc"])
    own_client = http_client is None
    client = http_client or httpx.Client(timeout=10.0)
    suggestions: list[str] = []
    seen: set[str] = set()
    try:
        for stem in cfg["autocomplete_stems"]:
            url = f"https://suggestqueries.google.com/complete/search?client=firefox&q={quote_plus(stem)}"
            try:
                resp = client.get(url)
                if resp.status_code != 200:
                    continue
                data = resp.json()
                if isinstance(data, list) and len(data) >= 2 and isinstance(data[1], list):
                    for item in data[1][:6]:
                        text = str(item).strip()
                        if text and text.lower() not in seen:
                            seen.add(text.lower())
                            suggestions.append(text)
            except Exception:
                continue
    finally:
        if own_client:
            client.close()
    return suggestions[:20]


def load_unconsumed_seeds(seeds_path: Path, metro: str) -> list[dict[str, Any]]:
    """Return unconsumed Creator Search Insights seeds matching metro or 'both'."""
    if not seeds_path.exists():
        return []
    data = json.loads(seeds_path.read_text(encoding="utf-8"))
    seeds = data.get("seeds") if isinstance(data, dict) else []
    matched: list[dict[str, Any]] = []
    for s in seeds or []:
        if not isinstance(s, dict):
            continue
        if s.get("consumed_at"):
            continue
        s_metro = str(s.get("metro") or "both").lower()
        if s_metro in {metro, "both"}:
            matched.append(s)
    return matched[:10]


def load_recent_topics(log_path: Path, run_date: str, lookback_days: int = 21) -> list[str]:
    """Return recent topics/hooks from content_log.json within lookback_days for deduplication."""
    if not log_path.exists():
        return []
    data = json.loads(log_path.read_text(encoding="utf-8"))
    entries = data.get("entries") if isinstance(data, dict) else []
    cutoff = (date.fromisoformat(run_date) - timedelta(days=lookback_days)).isoformat()
    recent: list[str] = []
    for e in entries or []:
        if not isinstance(e, dict):
            continue
        if str(e.get("date") or "") >= cutoff:
            topic = str(e.get("topic") or "").strip()
            hook = str(e.get("hook") or "").strip()
            if topic:
                recent.append(f"{topic} ({hook})" if hook else topic)
    return recent[-30:]


def slugify(text: str, max_len: int = 40) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")
    return (slug[:max_len].strip("-")) or "growth-post"


def build_offline_mock_briefs(
    metro: str,
    run_date: str,
    inventory: dict[str, Any],
    seeds: list[dict[str, Any]],
    max_carousels: int = 2,
    max_videos: int = 1,
) -> list[dict[str, Any]]:
    """Deterministic offline brief generator grounded in inventory.json (for --mock / dry-run)."""
    city = METRO_CONFIG.get(metro, METRO_CONFIG["nyc"])["display_name"]
    shows = inventory.get("shows") or []
    venues = [v["name"] for v in (inventory.get("top_venues") or [])[:5]]
    venue_sample = venues[:4] if venues else [f"{city} DIY Rooms"]
    seed_note = seeds[0]["query"] if seeds else f"best underground shows in {city.lower()}"
    seed_ids = [seeds[0]["id"]] if seeds else []

    briefs: list[dict[str, Any]] = []
    if max_carousels >= 1:
        briefs.append(
            {
                "slug": f"{metro}-growth-listicle-1",
                "metro": metro,
                "format": "carousel",
                "template": "search_listicle",
                "topic": f"Small {city} venues with stacked shows this week",
                "hook": f"Where to actually find good live music in {city} this week",
                "source_signal": f"Seed / Search intent: {seed_note}",
                "seed_ids": seed_ids,
                "angle": f"Highlight real upcoming {city} shows across {', '.join(venue_sample[:3])} with prices & dates",
                "setnik_cta": f"Preview every band for 30 seconds on Setnik before buying tickets",
                "target_venues": venue_sample[:4],
                "target_shows": [s["headliner"] for s in shows[:5]],
                "audio_mode": "music_only",
                "visual_mode": "motion_cards",
                "suggested_sound_query": shows[0]["headliner"] if shows else f"{city} indie",
            }
        )
    if max_carousels >= 2:
        briefs.append(
            {
                "slug": f"{metro}-growth-problem-2",
                "metro": metro,
                "format": "carousel",
                "template": "problem_solution",
                "topic": f"How to stop missing underground {city} shows without checking 15 Instagram pages",
                "hook": f"POV: You're trying to find a show in {city} tonight without paying $90 in fees",
                "source_signal": f"Audience pain point: fragmented venue calendars in {city}",
                "seed_ids": [],
                "angle": "Show the frustration of scattered flyers vs swiping Setnik's deck + 30s audio previews",
                "setnik_cta": "Download Setnik free on Google Play — link in bio",
                "target_venues": venue_sample[:3],
                "target_shows": [s["headliner"] for s in shows[:3]],
                "audio_mode": "music_only",
                "visual_mode": "motion_cards",
                "suggested_sound_query": f"{city} underground",
            }
        )
    if max_videos >= 1:
        briefs.append(
            {
                "slug": f"{metro}-growth-video-1",
                "metro": metro,
                "format": "video",
                "template": "short_explainer",
                "topic": f"How to find cheap live music in {city} this week",
                "hook": f"Stop paying $80 for concerts in {city} — here's how to find the real shows",
                "source_signal": f"Search trend: cheap concerts {city.lower()} this week",
                "seed_ids": [],
                "angle": f"Fast 18-second walkthrough of finding local {city} gigs + previewing bands on Setnik",
                "setnik_cta": "Grab Setnik free on Google Play (link in bio)",
                "target_venues": venue_sample[:3],
                "target_shows": [s["headliner"] for s in shows[:4]],
                "audio_mode": "voiceover",
                "visual_mode": "broll_overlay",
                "suggested_sound_query": shows[0]["headliner"] if shows else f"{city} live music",
            }
        )
    return briefs


def build_research_prompt(
    metro: str,
    run_date: str,
    inventory: dict[str, Any],
    seeds: list[dict[str, Any]],
    reddit_posts: list[dict[str, Any]],
    autocomplete: list[str],
    recent_topics: list[str],
    max_carousels: int,
    max_videos: int,
) -> str:
    city = METRO_CONFIG.get(metro, METRO_CONFIG["nyc"])["city_label"]
    compact_shows = [
        {
            "headliner": s["headliner"],
            "venue": s["venue"],
            "neighborhood": s["neighborhood"],
            "date": s["short_date"],
            "price": s["price_text"],
            "genres": s["genres"][:2],
        }
        for s in (inventory.get("shows") or [])[:25]
    ]
    return json.dumps(
        {
            "task": (
                f"Generate {max_carousels} TikTok photo carousel brief(s) and {max_videos} short-form "
                f"TikTok video brief(s) for {city} ({metro.upper()}) on {run_date} to grow Setnik's "
                "audience and drive app downloads."
            ),
            "priorities": [
                "1. Prioritize unconsumed Creator Search Insights seeds first if any are provided.",
                "2. Ground every venue, artist, date, and price ONLY in the provided Setnik inventory.",
                "3. Avoid repeating any topic in recent_topics.",
                "4. For each video brief, choose audio_mode ('voiceover' for explainers/guides, 'music_only' for vibe/list cuts) and visual_mode ('broll_overlay' for app demos, 'motion_cards' for pure venue/show spotlights).",
                "5. Keep hooks punchy, conversational, and native to TikTok (no corporate buzzwords).",
            ],
            "output_schema": {
                "briefs": [
                    {
                        "slug": "short-kebab-slug",
                        "format": "carousel | video",
                        "template": "search_listicle | problem_solution | scene_hot_take | short_explainer",
                        "topic": "concise topic title",
                        "hook": "scroll-stopping opening line (<= 85 chars)",
                        "source_signal": "which seed, reddit thread, or search trend inspired this",
                        "seed_ids": ["optional seed id(s) used"],
                        "angle": "2-sentence editorial angle",
                        "setnik_cta": "natural CTA driving Setnik app downloads",
                        "target_venues": ["venue names from inventory"],
                        "target_shows": ["headliner names from inventory"],
                        "audio_mode": "voiceover | music_only",
                        "visual_mode": "broll_overlay | motion_cards",
                        "suggested_sound_query": "artist or vibe to search in TikTok sound library",
                    }
                ]
            },
            "creator_search_insights_seeds": seeds,
            "reddit_audience_signals": reddit_posts,
            "google_autocomplete_signals": autocomplete,
            "recent_topics_to_avoid": recent_topics,
            "setnik_inventory_summary": {
                "total_shows": inventory.get("total_shows", 0),
                "top_venues": (inventory.get("top_venues") or [])[:10],
                "top_genres": (inventory.get("top_genres") or [])[:8],
                "affordable_count": inventory.get("affordable_count", 0),
                "sample_shows": compact_shows,
            },
        },
        indent=2,
        ensure_ascii=False,
    )


def run_research(
    metro: str,
    run_date: str,
    inventory_path: Path,
    out_path: Path,
    seeds_path: Path = DEFAULT_SEEDS_PATH,
    log_path: Path = DEFAULT_LOG_PATH,
    max_carousels: int = 2,
    max_videos: int = 1,
    mock: bool = False,
    gemini_client: GeminiClient | None = None,
    http_client: httpx.Client | None = None,
) -> dict[str, Any]:
    """Run the Research Node and write briefs.json."""
    inventory = json.loads(inventory_path.read_text(encoding="utf-8"))
    seeds = load_unconsumed_seeds(seeds_path, metro)
    recent_topics = load_recent_topics(log_path, run_date)

    reddit_posts: list[dict[str, Any]] = []
    autocomplete: list[str] = []
    if not mock:
        reddit_posts = fetch_reddit_signals(metro, http_client=http_client)
        autocomplete = fetch_autocomplete_signals(metro, http_client=http_client)

    has_gemini_key = bool(os.environ.get("GEMINI_API_KEY", "").strip()) or gemini_client is not None
    if mock or not has_gemini_key:
        if not mock and not has_gemini_key:
            print("[research_agent] GEMINI_API_KEY not set; using offline fallback briefs.", file=sys.stderr)
        briefs = build_offline_mock_briefs(
            metro=metro,
            run_date=run_date,
            inventory=inventory,
            seeds=seeds,
            max_carousels=max_carousels,
            max_videos=max_videos,
        )
    else:
        client = gemini_client or GeminiClient()
        prompt = build_research_prompt(
            metro=metro,
            run_date=run_date,
            inventory=inventory,
            seeds=seeds,
            reddit_posts=reddit_posts,
            autocomplete=autocomplete,
            recent_topics=recent_topics,
            max_carousels=max_carousels,
            max_videos=max_videos,
        )
        raw = client.generate_json(prompt=prompt, system_instruction=RESEARCH_SYSTEM_INSTRUCTION, temperature=0.7)
        raw_briefs = raw.get("briefs") if isinstance(raw, dict) else []
        briefs = []
        car_count = 0
        vid_count = 0
        for idx, b in enumerate(raw_briefs or [], start=1):
            if not isinstance(b, dict):
                continue
            fmt = str(b.get("format") or "carousel").strip().lower()
            if fmt == "video":
                if vid_count >= max_videos:
                    continue
                vid_count += 1
            else:
                fmt = "carousel"
                if car_count >= max_carousels:
                    continue
                car_count += 1
            base_slug = slugify(str(b.get("slug") or b.get("topic") or f"brief-{idx}"))
            slug = f"{metro}-{base_slug}" if not base_slug.startswith(f"{metro}-") else base_slug
            briefs.append(
                {
                    "slug": slug,
                    "metro": metro,
                    "format": fmt,
                    "template": str(b.get("template") or ("short_explainer" if fmt == "video" else "search_listicle")),
                    "topic": str(b.get("topic") or "").strip(),
                    "hook": str(b.get("hook") or "").strip(),
                    "source_signal": str(b.get("source_signal") or "Automated research").strip(),
                    "seed_ids": [str(x) for x in (b.get("seed_ids") or []) if x],
                    "angle": str(b.get("angle") or "").strip(),
                    "setnik_cta": str(b.get("setnik_cta") or "Download Setnik free on Google Play").strip(),
                    "target_venues": [str(x) for x in (b.get("target_venues") or []) if x],
                    "target_shows": [str(x) for x in (b.get("target_shows") or []) if x],
                    "audio_mode": str(b.get("audio_mode") or ("voiceover" if fmt == "video" else "music_only")).lower(),
                    "visual_mode": str(b.get("visual_mode") or ("broll_overlay" if fmt == "video" else "motion_cards")).lower(),
                    "suggested_sound_query": str(b.get("suggested_sound_query") or "").strip(),
                }
            )

    result = {
        "run_date": run_date,
        "metro": metro,
        "signals_summary": {
            "unconsumed_seeds": len(seeds),
            "reddit_posts": len(reddit_posts),
            "autocomplete_queries": len(autocomplete),
            "inventory_shows": inventory.get("total_shows", 0),
        },
        "briefs": briefs,
    }
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(result, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"[research_agent] Generated {len(briefs)} brief(s) for {metro.upper()} -> {out_path}")
    return result


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Run Setnik TikTok Growth Research Agent.")
    parser.add_argument("--metro", choices=["nyc", "la"], required=True)
    parser.add_argument("--date", required=True, help="Run date YYYY-MM-DD")
    parser.add_argument("--inventory", required=True, help="Path to inventory.json")
    parser.add_argument("--out", required=True, help="Path to write briefs.json")
    parser.add_argument("--seeds-path", default=str(DEFAULT_SEEDS_PATH))
    parser.add_argument("--log-path", default=str(DEFAULT_LOG_PATH))
    parser.add_argument("--max-carousels", type=int, default=2)
    parser.add_argument("--max-videos", type=int, default=1)
    parser.add_argument("--mock", action="store_true")
    args = parser.parse_args(argv)

    run_research(
        metro=args.metro,
        run_date=args.date,
        inventory_path=Path(args.inventory).resolve(),
        out_path=Path(args.out).resolve(),
        seeds_path=Path(args.seeds_path).resolve(),
        log_path=Path(args.log_path).resolve(),
        max_carousels=args.max_carousels,
        max_videos=args.max_videos,
        mock=args.mock,
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
