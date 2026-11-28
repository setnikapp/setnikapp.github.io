#!/usr/bin/env python3
"""Content Copywriter + Automated Brand & Fact Checker for Setnik TikTok Growth Pipeline.

Takes briefs.json + inventory.json, generates slide-by-slide carousel scripts and
scene-by-scene short-form video scripts via Gemini (or deterministic offline mock),
and enforces brand voice, text budgets, TikTok API limits, and show/venue fact grounding.

Usage:
    python3 tools/tiktok_growth/content_agent.py \
      --briefs build/growth/2026-11-30/nyc/briefs.json \
      --inventory build/growth/2026-11-30/nyc/inventory.json \
      --out build/growth/2026-11-30/nyc/scripts.json
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
from pathlib import Path
from typing import Any

REPO_ROOT = Path(__file__).resolve().parents[2]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from tools.tiktok_growth.gemini_client import GeminiClient  # noqa: E402

MAX_TITLE_UTF16 = 90
MAX_DESC_UTF16 = 4000
MAX_HASHTAGS = 5

AI_CLICHE_PATTERNS: list[tuple[re.Pattern[str], str]] = [
    (re.compile(r"\bgame[- ]changer\b", re.IGNORECASE), "must-have"),
    (re.compile(r"\belevate your\b", re.IGNORECASE), "upgrade your"),
    (re.compile(r"\bunlock the magic of\b", re.IGNORECASE), "discover"),
    (re.compile(r"\bdive into\b", re.IGNORECASE), "check out"),
    (re.compile(r"\bseamlessly\b", re.IGNORECASE), "fast"),
    (re.compile(r"\bcurated experience\b", re.IGNORECASE), "local lineup"),
]

CONTENT_SYSTEM_INSTRUCTION = (
    "You write crisp, authentic, non-corporate TikTok scripts and photo carousel copy for "
    "Setnik, a live-music discovery app for underground, indie, rock, punk, and electronic shows. "
    "Write like a real local music fan—short punchy lines, specific venues and bands from the "
    "provided inventory, zero hallucinated gigs, zero corporate buzzwords. Return strictly valid JSON."
)


def utf16_len(text: str) -> int:
    return len(text.encode("utf-16-le")) // 2


def truncate_utf16(text: str, max_units: int) -> str:
    cleaned = re.sub(r"\s+", " ", (text or "").strip())
    if utf16_len(cleaned) <= max_units:
        return cleaned
    out = cleaned
    while out and utf16_len(out + "...") > max_units:
        out = out[:-1]
    return (out.rstrip(" ,.-:") + "...") if out else ""


def strip_ai_cliches(text: str) -> str:
    out = text or ""
    for pattern, replacement in AI_CLICHE_PATTERNS:
        out = pattern.sub(replacement, out)
    return re.sub(r"\s+", " ", out).strip()


def sanitize_hashtags(hashtags: list[str], metro: str) -> list[str]:
    cleaned: list[str] = []
    seen: set[str] = set()
    defaults = [f"#{metro}", "#livemusic", "#concerts", "#setnik", "#localmusic"]
    for raw in list(hashtags or []) + defaults:
        tag = re.sub(r"[^a-zA-Z0-9_]", "", str(raw or "").lstrip("#")).lower()
        if not tag or tag in seen:
            continue
        seen.add(tag)
        cleaned.append(f"#{tag}")
        if len(cleaned) >= MAX_HASHTAGS:
            break
    return cleaned


def build_inventory_lookup(inventory: dict[str, Any]) -> tuple[dict[str, dict[str, Any]], set[str]]:
    shows_by_headliner: dict[str, dict[str, Any]] = {}
    valid_venues: set[str] = set()
    for s in inventory.get("shows") or []:
        if not isinstance(s, dict):
            continue
        h = str(s.get("headliner") or "").strip().lower()
        v = str(s.get("venue") or "").strip().lower()
        if h and h not in shows_by_headliner:
            shows_by_headliner[h] = s
        if v:
            valid_venues.add(v)
    return shows_by_headliner, valid_venues


def resolve_grounded_show(
    ref_text: str,
    shows_by_headliner: dict[str, dict[str, Any]],
    fallback_shows: list[dict[str, Any]],
    fallback_index: int = 0,
) -> dict[str, Any] | None:
    """Match a show reference to a verified show in inventory.json (no hallucinations)."""
    key = (ref_text or "").strip().lower()
    if key and key in shows_by_headliner:
        return shows_by_headliner[key]
    if key:
        for h_key, show in shows_by_headliner.items():
            if key in h_key or h_key in key:
                return show
    if fallback_shows:
        return fallback_shows[fallback_index % len(fallback_shows)]
    return None


def validate_and_sanitize_post(
    post: dict[str, Any],
    brief: dict[str, Any],
    inventory: dict[str, Any],
) -> dict[str, Any]:
    """Enforce brand voice, character budgets, fact grounding, and TikTok API limits."""
    metro = str(brief.get("metro") or inventory.get("metro") or "nyc").lower()
    shows = list(inventory.get("shows") or [])
    shows_by_headliner, _ = build_inventory_lookup(inventory)

    fmt = str(post.get("format") or brief.get("format") or "carousel").lower()
    hashtags = sanitize_hashtags(post.get("hashtags") or [], metro)
    title = truncate_utf16(strip_ai_cliches(str(post.get("title") or brief.get("hook") or brief.get("topic") or "Setnik")), MAX_TITLE_UTF16)

    caption_body = strip_ai_cliches(str(post.get("caption") or brief.get("angle") or ""))
    cta_line = strip_ai_cliches(str(brief.get("setnik_cta") or "Download Setnik free on Google Play (link in bio)."))
    hashtag_line = " ".join(hashtags)
    full_desc = f"{caption_body}\n\n{cta_line}\n\n{hashtag_line}".strip()
    description = truncate_utf16(full_desc, MAX_DESC_UTF16)

    palette_family = str(post.get("palette_family") or "PUNK").upper()
    if palette_family not in {"HEAVY", "PUNK", "DARK", "DREAMY", "EXPERIMENTAL", "CLUB", "SOUL"}:
        palette_family = "CLUB" if metro == "la" else "PUNK"

    base: dict[str, Any] = {
        "slug": str(brief["slug"]),
        "metro": metro,
        "format": fmt,
        "template": str(post.get("template") or brief.get("template") or ("short_explainer" if fmt == "video" else "search_listicle")),
        "topic": str(brief.get("topic") or ""),
        "hook": strip_ai_cliches(str(brief.get("hook") or title))[:95],
        "source_signal": str(brief.get("source_signal") or ""),
        "seed_ids": list(brief.get("seed_ids") or []),
        "palette_family": palette_family,
        "title": title,
        "description": description,
        "hashtags": hashtags,
        "suggested_sound_query": str(post.get("suggested_sound_query") or brief.get("suggested_sound_query") or f"{metro} live music").strip(),
        "brand_check_notes": [],
    }

    if fmt == "carousel":
        raw_slides = list(post.get("slides") or [])
        sanitized_slides: list[dict[str, Any]] = []
        for idx, sl in enumerate(raw_slides[:7]):
            if not isinstance(sl, dict):
                continue
            show_ref_name = str(sl.get("show_ref") or "").strip()
            grounded_show = (
                resolve_grounded_show(show_ref_name, shows_by_headliner, shows, idx)
                if show_ref_name
                else None
            )
            if show_ref_name and grounded_show and grounded_show["headliner"].lower() != show_ref_name.lower():
                base["brand_check_notes"].append(
                    f"Slide {idx + 1}: replaced unverified show '{show_ref_name}' with '{grounded_show['headliner']}'"
                )
            sanitized_slides.append(
                {
                    "role": str(sl.get("role") or ("cover" if idx == 0 else "body")).lower(),
                    "kicker": strip_ai_cliches(str(sl.get("kicker") or ""))[:42],
                    "headline": strip_ai_cliches(str(sl.get("headline") or ""))[:90],
                    "body": strip_ai_cliches(str(sl.get("body") or ""))[:220],
                    "bullets": [strip_ai_cliches(str(b))[:85] for b in (sl.get("bullets") or []) if b][:4],
                    "grounded_show": grounded_show,
                    "cta": strip_ai_cliches(str(sl.get("cta") or ""))[:70],
                }
            )
        if len(sanitized_slides) < 2:
            sanitized_slides = _build_fallback_carousel_slides(brief, inventory)
        base["slides"] = sanitized_slides
    else:
        audio_mode = str(post.get("audio_mode") or brief.get("audio_mode") or "voiceover").lower()
        if audio_mode not in {"voiceover", "music_only"}:
            audio_mode = "voiceover"
        visual_mode = str(post.get("visual_mode") or brief.get("visual_mode") or "broll_overlay").lower()
        if visual_mode not in {"broll_overlay", "motion_cards"}:
            visual_mode = "broll_overlay"
        raw_scenes = list(post.get("scenes") or [])
        sanitized_scenes: list[dict[str, Any]] = []
        for idx, sc in enumerate(raw_scenes[:6]):
            if not isinstance(sc, dict):
                continue
            dur = float(sc.get("duration_sec") or 3.5)
            dur = max(2.2, min(6.0, dur))
            show_ref_name = str(sc.get("show_ref") or "").strip()
            grounded_show = (
                resolve_grounded_show(show_ref_name, shows_by_headliner, shows, idx)
                if show_ref_name
                else None
            )
            sanitized_scenes.append(
                {
                    "role": str(sc.get("role") or ("hook" if idx == 0 else "body")).lower(),
                    "duration_sec": round(dur, 2),
                    "kicker": strip_ai_cliches(str(sc.get("kicker") or ""))[:36],
                    "on_screen_text": strip_ai_cliches(str(sc.get("on_screen_text") or ""))[:85],
                    "subtext": strip_ai_cliches(str(sc.get("subtext") or ""))[:110],
                    "narration": strip_ai_cliches(str(sc.get("narration") or ""))[:180],
                    "grounded_show": grounded_show,
                }
            )
        if len(sanitized_scenes) < 3:
            sanitized_scenes = _build_fallback_video_scenes(brief, inventory)
        base["audio_mode"] = audio_mode
        base["visual_mode"] = visual_mode
        base["voice"] = str(post.get("voice") or "en-US-AndrewNeural")
        base["scenes"] = sanitized_scenes

    return base


def _build_fallback_carousel_slides(brief: dict[str, Any], inventory: dict[str, Any]) -> list[dict[str, Any]]:
    city = "NYC" if brief.get("metro") == "nyc" else "LA"
    shows = list(inventory.get("shows") or [])
    template = str(brief.get("template") or "search_listicle")

    if template == "problem_solution":
        return [
            {
                "role": "cover",
                "kicker": f"{city} LIVE MUSIC",
                "headline": str(brief.get("hook") or f"Stop checking 15 venue pages just to find a {city} show"),
                "body": "Swipe for the faster way to find real local gigs tonight.",
                "bullets": [],
                "grounded_show": None,
                "cta": "Swipe ->",
            },
            {
                "role": "body",
                "kicker": "THE PROBLEM",
                "headline": "Half the best shows never show up on big ticket apps",
                "body": "Small rooms, DIY bills, and last-minute flyers are scattered across Instagram stories and group chats.",
                "bullets": ["$25+ service fees on arena sites", "Zero idea what the opener sounds like", "Hours lost scrolling calendars"],
                "grounded_show": None,
                "cta": "",
            },
            {
                "role": "body",
                "kicker": "THE FIX",
                "headline": "One swipeable deck for every room in the city",
                "body": f"Setnik pulls upcoming {city} shows into one feed with 30-second audio previews for every band on the bill.",
                "bullets": ["Hear the band before you go", "Filter by neighborhood & genre", "Save shows in one tap"],
                "grounded_show": shows[0] if shows else None,
                "cta": "",
            },
            {
                "role": "cta",
                "kicker": "TRY SETNIK FREE",
                "headline": f"Find your next favorite {city} show in 30 seconds",
                "body": "Free on Google Play. No account required to start swiping.",
                "bullets": [],
                "grounded_show": None,
                "cta": "Link in bio -> Setnik",
            },
        ]

    # Default: search_listicle / scene_hot_take grounded in real shows
    slides: list[dict[str, Any]] = [
        {
            "role": "cover",
            "kicker": f"{city} SHOW GUIDE",
            "headline": str(brief.get("hook") or f"Real {city} shows worth leaving the house for this week"),
            "body": str(brief.get("angle") or "Hand-picked from Setnik's live calendar."),
            "bullets": [],
            "grounded_show": None,
            "cta": "Swipe for the lineup ->",
        }
    ]
    for idx, show in enumerate(shows[:3], start=1):
        price_str = f" · {show['price_text']}" if show.get("price_text") else ""
        slides.append(
            {
                "role": "show",
                "kicker": f"PICK 0{idx} · {show['neighborhood'].upper()}",
                "headline": show["headliner"],
                "body": f"{show['venue']} · {show['weekday']} {show['short_date']} {show['time']}{price_str}",
                "bullets": show.get("genres", [])[:3],
                "grounded_show": show,
                "cta": "",
            }
        )
    slides.append(
        {
            "role": "cta",
            "kicker": "HEAR EVERY BAND FIRST",
            "headline": f"All {inventory.get('total_shows', '')} upcoming {city} shows in one deck",
            "body": "Preview 30-second clips and save gigs on Setnik.",
            "bullets": [],
            "grounded_show": None,
            "cta": "Download Setnik — Link in bio",
        }
    )
    return slides


def _build_fallback_video_scenes(brief: dict[str, Any], inventory: dict[str, Any]) -> list[dict[str, Any]]:
    city = "NYC" if brief.get("metro") == "nyc" else "LA"
    shows = list(inventory.get("shows") or [])
    show_a = shows[0] if len(shows) > 0 else None
    show_b = shows[1] if len(shows) > 1 else show_a
    return [
        {
            "role": "hook",
            "duration_sec": 3.2,
            "kicker": f"{city} LIVE MUSIC",
            "on_screen_text": str(brief.get("hook") or f"How to actually find good shows in {city} this week"),
            "subtext": "No $40 service fees. Just real local rooms.",
            "narration": f"Stop paying eighty dollars for concerts in {city}. Here is how to find the real shows this week.",
            "grounded_show": None,
        },
        {
            "role": "show",
            "duration_sec": 4.2,
            "kicker": "ON DECK THIS WEEK",
            "on_screen_text": show_a["headliner"] if show_a else f"Underground {city} Pick",
            "subtext": f"{show_a['venue']} · {show_a['short_date']}" if show_a else f"Small rooms across {city}",
            "narration": (
                f"First up, {show_a['headliner']} at {show_a['venue']} on {show_a['short_date']}."
                if show_a
                else f"Start with small neighborhood rooms across {city}."
            ),
            "grounded_show": show_a,
        },
        {
            "role": "show",
            "duration_sec": 4.2,
            "kicker": "ANOTHER PICK",
            "on_screen_text": show_b["headliner"] if show_b else "30-Second Band Previews",
            "subtext": f"{show_b['venue']} · {show_b['short_date']}" if show_b else "Hear every act before you buy tickets",
            "narration": (
                f"Plus {show_b['headliner']} at {show_b['venue']} — and you can preview every band for thirty seconds first."
                if show_b
                else "You can preview every single band for thirty seconds before you buy a ticket."
            ),
            "grounded_show": show_b,
        },
        {
            "role": "cta",
            "duration_sec": 3.5,
            "kicker": "SETNIK APP",
            "on_screen_text": f"Swipe every {city} show in one app",
            "subtext": "Free on Google Play · Link in bio",
            "narration": "Grab Setnik free on Google Play — link is in our bio.",
            "grounded_show": None,
        },
    ]


def build_content_prompt(brief: dict[str, Any], inventory: dict[str, Any]) -> str:
    compact_shows = [
        {
            "headliner": s["headliner"],
            "venue": s["venue"],
            "neighborhood": s["neighborhood"],
            "date": s["short_date"],
            "weekday": s["weekday"],
            "time": s["time"],
            "price": s["price_text"],
            "genres": s["genres"][:2],
        }
        for s in (inventory.get("shows") or [])[:20]
    ]
    if brief.get("format") == "video":
        schema = {
            "title": "TikTok title (<= 85 chars)",
            "caption": "2-3 punchy sentences for TikTok description",
            "hashtags": ["#nyc", "#livemusic", "#concerts", "#setnik", "#indie"],
            "palette_family": "HEAVY | PUNK | DARK | DREAMY | EXPERIMENTAL | CLUB | SOUL",
            "audio_mode": "voiceover | music_only",
            "visual_mode": "broll_overlay | motion_cards",
            "suggested_sound_query": "artist or vibe to search in TikTok sound library",
            "scenes": [
                {
                    "role": "hook | body | show | cta",
                    "duration_sec": 3.5,
                    "kicker": "SHORT UPPERCASE LABEL (<= 30 chars)",
                    "on_screen_text": "punchy bold text (<= 75 chars)",
                    "subtext": "supporting line (<= 95 chars)",
                    "narration": "spoken sentence for voiceover (<= 140 chars; keep natural)",
                    "show_ref": "EXACT headliner name from available_shows if referencing a show, else empty string",
                }
            ],
        }
        extra = "Produce 4 or 5 scenes totaling ~15 to 20 seconds."
    else:
        schema = {
            "title": "TikTok title (<= 85 chars)",
            "caption": "2-3 punchy sentences for TikTok description",
            "hashtags": ["#nyc", "#livemusic", "#concerts", "#setnik", "#indie"],
            "palette_family": "HEAVY | PUNK | DARK | DREAMY | EXPERIMENTAL | CLUB | SOUL",
            "template": "search_listicle | problem_solution | scene_hot_take",
            "suggested_sound_query": "artist or vibe to search in TikTok sound library",
            "slides": [
                {
                    "role": "cover | body | show | cta",
                    "kicker": "SHORT LABEL (<= 34 chars)",
                    "headline": "bold slide headline (<= 75 chars)",
                    "body": "concise copy (<= 180 chars)",
                    "bullets": ["optional 2-3 short bullets (<= 65 chars each)"],
                    "show_ref": "EXACT headliner name from available_shows if featuring a show card, else empty string",
                    "cta": "optional footer pill text (<= 55 chars)",
                }
            ],
        }
        extra = "Produce 4 to 6 slides: cover -> 2-4 value/show slides -> Setnik download CTA slide."

    return json.dumps(
        {
            "task": f"Write a complete TikTok {brief.get('format')} script for this brief. {extra}",
            "brief": brief,
            "available_shows": compact_shows,
            "rules": [
                "NEVER invent venues, dates, prices, or band names not in available_shows.",
                "Every slide/scene must be scannable in 2 seconds on a phone screen.",
                "Avoid corporate AI clichés ('game-changer', 'elevate', 'dive into', 'seamlessly').",
            ],
            "output_schema": schema,
        },
        indent=2,
        ensure_ascii=False,
    )


def generate_content_scripts(
    briefs_path: Path,
    inventory_path: Path,
    out_path: Path,
    mock: bool = False,
    gemini_client: GeminiClient | None = None,
) -> dict[str, Any]:
    """Generate and brand-check scripts for all briefs in briefs.json."""
    briefs_doc = json.loads(briefs_path.read_text(encoding="utf-8"))
    inventory = json.loads(inventory_path.read_text(encoding="utf-8"))
    briefs = list(briefs_doc.get("briefs") or [])

    has_gemini = bool(os.environ.get("GEMINI_API_KEY", "").strip()) or gemini_client is not None
    client = (gemini_client or GeminiClient()) if (not mock and has_gemini) else None

    posts: list[dict[str, Any]] = []
    for brief in briefs:
        if client is None:
            raw_post: dict[str, Any] = {
                "format": brief.get("format", "carousel"),
                "template": brief.get("template", "search_listicle"),
                "title": brief.get("hook") or brief.get("topic"),
                "caption": brief.get("angle") or "",
                "hashtags": [f"#{brief.get('metro', 'nyc')}", "#livemusic", "#concerts", "#setnik", "#localmusic"],
                "audio_mode": brief.get("audio_mode", "voiceover"),
                "visual_mode": brief.get("visual_mode", "broll_overlay"),
                "suggested_sound_query": brief.get("suggested_sound_query", ""),
                "slides": _build_fallback_carousel_slides(brief, inventory) if brief.get("format") != "video" else [],
                "scenes": _build_fallback_video_scenes(brief, inventory) if brief.get("format") == "video" else [],
            }
        else:
            prompt = build_content_prompt(brief, inventory)
            raw_post = client.generate_json(
                prompt=prompt,
                system_instruction=CONTENT_SYSTEM_INSTRUCTION,
                temperature=0.65,
            )
            if not isinstance(raw_post, dict):
                raw_post = {}

        validated = validate_and_sanitize_post(raw_post, brief, inventory)
        posts.append(validated)

    result = {
        "run_date": briefs_doc.get("run_date", inventory.get("run_date", "")),
        "metro": briefs_doc.get("metro", inventory.get("metro", "nyc")),
        "signals_summary": briefs_doc.get("signals_summary", {}),
        "posts": posts,
    }
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(result, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"[content_agent] Generated & validated {len(posts)} script(s) -> {out_path}")
    return result


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Generate & brand-check TikTok growth scripts.")
    parser.add_argument("--briefs", required=True, help="Path to briefs.json")
    parser.add_argument("--inventory", required=True, help="Path to inventory.json")
    parser.add_argument("--out", required=True, help="Path to write scripts.json")
    parser.add_argument("--mock", action="store_true")
    args = parser.parse_args(argv)

    generate_content_scripts(
        briefs_path=Path(args.briefs).resolve(),
        inventory_path=Path(args.inventory).resolve(),
        out_path=Path(args.out).resolve(),
        mock=args.mock,
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
