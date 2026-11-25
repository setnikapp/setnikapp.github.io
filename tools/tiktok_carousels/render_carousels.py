#!/usr/bin/env python3
"""Render pixel-faithful 1080x1920 Setnik TikTok carousel JPEGs via Playwright Chromium.

Usage:
    python3 tools/tiktok_carousels/render_carousels.py --input build/carousel_selected/2026-11-26/selected.json
"""

from __future__ import annotations

import argparse
import base64
import html
import json
import os
import shutil
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from PIL import Image
from playwright.sync_api import Browser, Page, sync_playwright

REPO_ROOT = Path(__file__).resolve().parents[2]
WORDMARK_PATH = REPO_ROOT / "static" / "assets" / "wordmark.png"

SLIDE_WIDTH = 1080
SLIDE_HEIGHT = 1920
JPEG_QUALITY = 90
MAX_JPEG_BYTES = 20 * 1024 * 1024
MAX_TITLE_UTF16 = 90
MAX_DESC_UTF16 = 4000
MAX_HASHTAGS = 5

# Brand tokens (Setnik mobile app)
HOUSE_LIGHTS = "#F3EAD3"
ENCORE_WHITE = "#FBF8F0"
SURFACE_2 = "#EADFC2"
LINE_COLOR = "#D8CCAB"
STAGE_BLACK = "#141414"
INK_SOFT = "#3A3A3A"
FAINT = "#6E6755"
CLIP_RED = "#E4574E"

# 7 deterministic genre palette families (paper, ink, accent, accent_ink)
PALETTE_FAMILIES: dict[str, list[dict[str, str]]] = {
    "HEAVY": [
        {"paper": "#171416", "ink": "#F6EFE2", "accent": "#D7263D", "accent_ink": "#FBF8F0"},
        {"paper": "#1D1917", "ink": "#F3EAD3", "accent": "#E85D2A", "accent_ink": "#141414"},
        {"paper": "#131315", "ink": "#EAE4D5", "accent": "#C9A227", "accent_ink": "#141414"},
    ],
    "PUNK": [
        {"paper": "#F5ECD7", "ink": "#141414", "accent": "#FF5A36", "accent_ink": "#FBF8F0"},
        {"paper": "#F8E16C", "ink": "#141414", "accent": "#E4574E", "accent_ink": "#FBF8F0"},
        {"paper": "#ECE4D0", "ink": "#141414", "accent": "#D7263D", "accent_ink": "#FBF8F0"},
    ],
    "DARK": [
        {"paper": "#16161E", "ink": "#EDE8DC", "accent": "#8E6CEF", "accent_ink": "#FBF8F0"},
        {"paper": "#1B1820", "ink": "#F2ECE0", "accent": "#E4574E", "accent_ink": "#FBF8F0"},
        {"paper": "#12151C", "ink": "#E5E9F0", "accent": "#4EA8DE", "accent_ink": "#141414"},
    ],
    "DREAMY": [
        {"paper": "#EDE7F6", "ink": "#1D1829", "accent": "#5B3FD1", "accent_ink": "#FBF8F0"},
        {"paper": "#E7F0EB", "ink": "#16241F", "accent": "#E4574E", "accent_ink": "#FBF8F0"},
        {"paper": "#F5EAE6", "ink": "#211818", "accent": "#6E56CF", "accent_ink": "#FBF8F0"},
    ],
    "EXPERIMENTAL": [
        {"paper": "#EBE4D1", "ink": "#141414", "accent": "#1E6B52", "accent_ink": "#FBF8F0"},
        {"paper": "#1F2421", "ink": "#F3EAD3", "accent": "#E8B931", "accent_ink": "#141414"},
        {"paper": "#F2EDE1", "ink": "#141414", "accent": "#2E5EAA", "accent_ink": "#FBF8F0"},
    ],
    "CLUB": [
        {"paper": "#121318", "ink": "#F5F2EB", "accent": "#E4574E", "accent_ink": "#FBF8F0"},
        {"paper": "#10161B", "ink": "#EEF4F8", "accent": "#00C2A8", "accent_ink": "#141414"},
        {"paper": "#19121C", "ink": "#F6EEF8", "accent": "#FF4D8D", "accent_ink": "#FBF8F0"},
    ],
    "SOUL": [
        {"paper": "#F4E5C8", "ink": "#231914", "accent": "#C84B31", "accent_ink": "#FBF8F0"},
        {"paper": "#241914", "ink": "#F6EAD7", "accent": "#E09F3E", "accent_ink": "#141414"},
        {"paper": "#EFE3CF", "ink": "#1F1A17", "accent": "#9E2A2B", "accent_ink": "#FBF8F0"},
    ],
}

GENRE_TO_FAMILY: dict[str, str] = {
    "metal": "HEAVY",
    "sludge & doom": "HEAVY",
    "punk": "PUNK",
    "hardcore": "PUNK",
    "screamo": "PUNK",
    "emo": "PUNK",
    "garage": "PUNK",
    "rock": "PUNK",
    "post-punk": "DARK",
    "darkwave": "DARK",
    "industrial": "DARK",
    "indie rock": "DREAMY",
    "shoegaze": "DREAMY",
    "psych": "DREAMY",
    "pop": "DREAMY",
    "experimental": "EXPERIMENTAL",
    "noise rock": "EXPERIMENTAL",
    "jazz & improv": "EXPERIMENTAL",
    "classical": "EXPERIMENTAL",
    "electronic": "CLUB",
    "hip-hop": "CLUB",
    "soul & gospel": "SOUL",
    "folk": "SOUL",
    "country": "SOUL",
    "blues": "SOUL",
    "latin": "SOUL",
    "reggae": "SOUL",
}


def fnv1a_32(text: str) -> int:
    """Deterministic 32-bit FNV-1a hash matching Setnik app poster generator."""
    h = 0x811C9DC5
    for byte in text.encode("utf-8"):
        h ^= byte
        h = (h * 0x01000193) & 0xFFFFFFFF
    return h


def xorshift32(seed: int) -> int:
    """Single step of xorshift32 PRNG."""
    x = seed & 0xFFFFFFFF
    if x == 0:
        x = 0x9E3779B9
    x ^= (x << 13) & 0xFFFFFFFF
    x ^= (x >> 17) & 0xFFFFFFFF
    x ^= (x << 5) & 0xFFFFFFFF
    return x & 0xFFFFFFFF


def fit_font(text: str, max_px: int = 104, min_px: int = 44, max_chars_at_max: int = 10) -> int:
    """Compute Anton display font size in px to fit headliner cleanly inside flyer-box."""
    cleaned = text.strip()
    if not cleaned:
        return max_px
    longest_word = max((len(w) for w in cleaned.split()), default=len(cleaned))
    effective = max(len(cleaned) * 0.65, float(longest_word) * 1.15)
    if effective <= max_chars_at_max:
        return max_px
    scaled = int(round(max_px * (max_chars_at_max / effective)))
    return max(min_px, min(max_px, scaled))


def pick_palette_and_layout(show: dict[str, Any]) -> tuple[dict[str, str], str, int]:
    """Deterministically select a palette family swatch and xerox poster layout."""
    seed_key = f"{show.get('id', '')}|{show.get('headliner', '')}|{show.get('venue_name', '')}"
    h1 = fnv1a_32(seed_key)
    h2 = xorshift32(h1)
    h3 = xorshift32(h2)

    family = "PUNK"
    for g in show.get("genres") or []:
        mapped = GENRE_TO_FAMILY.get(str(g).strip().lower())
        if mapped:
            family = mapped
            break

    swatches = PALETTE_FAMILIES[family]
    palette = swatches[h1 % len(swatches)]
    layouts = ("StackPoster", "BandPoster", "ZinePoster")
    layout = layouts[h2 % len(layouts)]
    return palette, layout, h3


def utf16_len(text: str) -> int:
    """Return length in UTF-16 code units as enforced by TikTok Content Posting API."""
    return len(text.encode("utf-16-le")) // 2


def truncate_utf16(text: str, max_units: int) -> str:
    """Truncate text cleanly to <= max_units UTF-16 code units without splitting surrogate pairs."""
    if utf16_len(text) <= max_units:
        return text
    ellipsis = "…"
    limit = max_units - utf16_len(ellipsis)
    out_chars: list[str] = []
    used = 0
    for ch in text:
        ch_units = utf16_len(ch)
        if used + ch_units > limit:
            break
        out_chars.append(ch)
        used += ch_units
    result = "".join(out_chars).rstrip(" ,·–-")
    return f"{result}{ellipsis}"


def build_tiktok_copy(
    genre: dict[str, Any],
    weekend_range: str,
    city_label: str,
) -> tuple[str, str, list[str], str]:
    """Build clean, concise TikTok title (<=90 UTF-16), description (<=4000 UTF-16, <=5 hashtags), and sound query."""
    display_name = str(genre.get("display_name", "Live")).strip()
    shows: list[dict[str, Any]] = list(genre.get("shows") or [])
    hashtags = [str(h).strip() for h in (genre.get("hashtags") or []) if str(h).strip()][:MAX_HASHTAGS]

    city_short = city_label.split("/")[0].strip() if "/" in city_label else city_label.strip()
    raw_title = f"{city_short} {display_name} Shows This Weekend"
    title = truncate_utf16(raw_title, MAX_TITLE_UTF16)

    lead = (
        f"{city_short} {display_name} shows this weekend ({weekend_range})."
        if weekend_range
        else f"{city_short} {display_name} shows this weekend."
    )
    lines: list[str] = [
        lead,
        "Swipe for the lineup — hear 30s previews on Setnik.",
    ]
    if hashtags:
        lines.extend(["", " ".join(hashtags)])

    description = truncate_utf16("\n".join(lines), MAX_DESC_UTF16)
    headliner_sound_query = str(shows[0].get("headliner", "")).strip() if shows else ""
    return title, description, hashtags, headliner_sound_query


def load_wordmark_data_uri() -> str:
    """Load static/assets/wordmark.png as a base64 PNG data URI."""
    raw = WORDMARK_PATH.read_bytes()
    b64 = base64.b64encode(raw).decode("ascii")
    return f"data:image/png;base64,{b64}"


def find_chromium_executable() -> str | None:
    """Auto-detect system Chrome/Chromium before falling back to Playwright's bundled browser."""
    env_path = os.environ.get("CHROME_EXECUTABLE_PATH", "").strip()
    if env_path and Path(env_path).is_file():
        return env_path
    for candidate in ("google-chrome", "google-chrome-stable", "chromium", "chromium-browser"):
        found = shutil.which(candidate)
        if found:
            return found
    return None


def _google_fonts_head() -> str:
    return (
        '<link rel="preconnect" href="https://fonts.googleapis.com">'
        '<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>'
        '<link href="https://fonts.googleapis.com/css2?family=Anton&family=DM+Sans:ital,opsz,wght@0,9..40,400..800;1,9..40,400..800&display=swap" rel="stylesheet">'
    )


def render_cover_html(
    genre: dict[str, Any],
    weekend_banner: str,
    city_label: str,
    wordmark_uri: str,
) -> str:
    """Build Slide 1 (01_cover.jpg) HTML matching Setnik's zine card aesthetic inside TikTok safe zones."""
    accent = html.escape(str(genre.get("accent_color") or CLIP_RED))
    cover_title = html.escape(str(genre.get("cover_title") or f"NYC {genre.get('display_name', '')} SHOWS · THIS WEEKEND"))
    shows: list[dict[str, Any]] = list(genre.get("shows") or [])
    show_count = len(shows)
    show_label = f"{show_count} HANDPICKED SHOW" + ("S" if show_count != 1 else "")

    venues_seen: list[str] = []
    for s in shows:
        v = str(s.get("venue_name") or "").strip()
        if v and v not in venues_seen:
            venues_seen.append(v)

    venue_pills_html = "".join(
        f'<span class="venue-pill">{html.escape(v)}</span>' for v in venues_seen[:4]
    )
    headliners_html = "".join(
        f'<div class="bill-row">'
        f'<span class="bill-num">0{i}</span>'
        f'<span class="bill-band">{html.escape(str(s.get("headliner", "")))}</span>'
        f'<span class="bill-day">{html.escape(str(s.get("weekday_short", "")).upper())}</span>'
        f'</div>'
        for i, s in enumerate(shows[:4], start=1)
    )

    return f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
{_google_fonts_head()}
<style>
  * {{ box-sizing: border-box; margin: 0; padding: 0; }}
  html, body {{
    width: {SLIDE_WIDTH}px;
    height: {SLIDE_HEIGHT}px;
    overflow: hidden;
    background: {HOUSE_LIGHTS};
    font-family: 'DM Sans', -apple-system, BlinkMacSystemFont, sans-serif;
    color: {STAGE_BLACK};
  }}
  .canvas {{
    width: {SLIDE_WIDTH}px;
    height: {SLIDE_HEIGHT}px;
    padding: 188px 132px 350px 72px;
    display: flex;
    flex-direction: column;
    position: relative;
    background-image:
      radial-gradient({LINE_COLOR} 1.5px, transparent 1.5px);
    background-size: 26px 26px;
  }}
  .zine-card {{
    flex: 1;
    background: {ENCORE_WHITE};
    border: 4px solid {STAGE_BLACK};
    border-radius: 28px;
    box-shadow: 14px 14px 0 {STAGE_BLACK};
    padding: 46px 44px 40px 44px;
    display: flex;
    flex-direction: column;
    justify-content: space-between;
    position: relative;
  }}
  .top-bar {{
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    padding-bottom: 24px;
    border-bottom: 2px solid {LINE_COLOR};
  }}
  .wordmark {{
    height: 44px;
    width: auto;
    display: block;
  }}
  .city-pill {{
    background: {STAGE_BLACK};
    color: {ENCORE_WHITE};
    font-size: 22px;
    font-weight: 700;
    letter-spacing: 0.08em;
    padding: 10px 20px;
    border-radius: 999px;
    text-transform: uppercase;
  }}
  .hero {{
    display: flex;
    flex-direction: column;
    gap: 24px;
    margin-top: 12px;
  }}
  .date-badge {{
    align-self: flex-start;
    background: {accent};
    color: {ENCORE_WHITE};
    font-size: 26px;
    font-weight: 800;
    letter-spacing: 0.09em;
    padding: 12px 24px;
    border-radius: 12px;
    border: 3px solid {STAGE_BLACK};
    box-shadow: 5px 5px 0 {STAGE_BLACK};
  }}
  .headline {{
    font-family: 'Anton', Impact, sans-serif;
    font-size: 96px;
    line-height: 0.96;
    letter-spacing: 0.01em;
    color: {STAGE_BLACK};
    text-transform: uppercase;
  }}
  .bill-preview {{
    background: {SURFACE_2};
    border: 2.5px solid {STAGE_BLACK};
    border-radius: 18px;
    padding: 20px 24px;
    display: flex;
    flex-direction: column;
    gap: 12px;
  }}
  .bill-row {{
    display: flex;
    align-items: baseline;
    gap: 16px;
    font-size: 26px;
    font-weight: 700;
    color: {STAGE_BLACK};
  }}
  .bill-num {{
    font-family: 'Anton', sans-serif;
    color: {accent};
    font-size: 28px;
    min-width: 38px;
  }}
  .bill-band {{
    flex: 1;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }}
  .bill-day {{
    font-size: 20px;
    font-weight: 800;
    color: {FAINT};
    letter-spacing: 0.06em;
  }}
  .meta-block {{
    display: flex;
    flex-direction: column;
    gap: 16px;
  }}
  .count-row {{
    display: flex;
    align-items: center;
    gap: 12px;
    font-size: 22px;
    font-weight: 800;
    letter-spacing: 0.08em;
    color: {INK_SOFT};
    text-transform: uppercase;
  }}
  .count-dot {{
    width: 12px;
    height: 12px;
    border-radius: 50%;
    background: {accent};
    border: 2px solid {STAGE_BLACK};
  }}
  .venue-pills {{
    display: flex;
    flex-wrap: wrap;
    gap: 10px;
  }}
  .venue-pill {{
    background: {HOUSE_LIGHTS};
    border: 2px solid {STAGE_BLACK};
    border-radius: 999px;
    padding: 8px 18px;
    font-size: 21px;
    font-weight: 700;
    color: {STAGE_BLACK};
  }}
  .footer {{
    border-top: 2px solid {LINE_COLOR};
    padding-top: 22px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    font-size: 23px;
    font-weight: 700;
    color: {INK_SOFT};
  }}
  .arrow-chip {{
    background: {STAGE_BLACK};
    color: {ENCORE_WHITE};
    width: 48px;
    height: 48px;
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 26px;
    font-weight: 800;
  }}
</style>
</head>
<body>
  <div class="canvas">
    <div class="zine-card">
      <div class="top-bar">
        <img class="wordmark" src="{wordmark_uri}" alt="Setnik">
        <div class="city-pill">{html.escape(city_label)}</div>
      </div>

      <div class="hero">
        <div class="date-badge">{html.escape(weekend_banner)}</div>
        <h1 class="headline">{cover_title}</h1>
        <div class="bill-preview">
          {headliners_html}
        </div>
      </div>

      <div class="meta-block">
        <div class="count-row">
          <span class="count-dot"></span>
          <span>{html.escape(show_label)}</span>
        </div>
        <div class="venue-pills">
          {venue_pills_html}
        </div>
        <div class="footer">
          <span>Swipe for the lineup · Hear previews on Setnik</span>
          <span class="arrow-chip">→</span>
        </div>
      </div>
    </div>
  </div>
</body>
</html>
"""


def _render_xerox_poster_inner(show: dict[str, Any], palette: dict[str, str], layout: str) -> str:
    """Render deterministic xerox poster art (StackPoster, BandPoster, or ZinePoster) inside flyer-box."""
    headliner = str(show.get("headliner") or "Live Show").strip()
    supports = [str(a).strip() for a in (show.get("support_acts") or []) if str(a).strip()]
    support_line = "  ·  ".join(supports[:3])
    venue_name = str(show.get("venue_name") or "").strip().upper()
    neighborhood = str(show.get("neighborhood") or show.get("area") or "").strip().upper()
    weekday = str(show.get("weekday_short") or "").upper()
    month = str(show.get("month_short") or "").upper()
    day_num = str(show.get("day_num") or "")
    time_str = str(show.get("time_display") or "").upper()
    price_str = str(show.get("price_display") or "").upper()

    paper = palette["paper"]
    ink = palette["ink"]
    accent = palette["accent"]
    accent_ink = palette["accent_ink"]
    font_px = fit_font(headliner, max_px=108, min_px=48, max_chars_at_max=10)

    if layout == "StackPoster":
        return f"""
        <div class="poster poster-stack" style="background:{paper};color:{ink};">
          <svg class="poster-bg" viewBox="0 0 800 890" preserveAspectRatio="none" aria-hidden="true">
            <defs>
              <pattern id="halftone" width="22" height="22" patternUnits="userSpaceOnUse">
                <circle cx="11" cy="11" r="3.2" fill="{accent}" opacity="0.22"/>
              </pattern>
            </defs>
            <rect width="800" height="890" fill="url(#halftone)"/>
            <rect x="0" y="0" width="800" height="20" fill="{accent}"/>
          </svg>
          <div class="poster-content stack-content">
            <div class="stack-kicker" style="background:{accent};color:{accent_ink};">
              {html.escape(weekday)} {html.escape(month)} {html.escape(day_num)} · {html.escape(time_str)}
            </div>
            <div class="stack-headline" style="font-size:{font_px}px;">{html.escape(headliner.upper())}</div>
            {f'<div class="stack-supports">+ {html.escape(support_line)}</div>' if support_line else ''}
            <div class="stack-venue-bar" style="border-top:4px solid {ink};">
              <span>{html.escape(venue_name)}</span>
              <span>{html.escape(neighborhood)}{f' · {html.escape(price_str)}' if price_str else ''}</span>
            </div>
          </div>
        </div>
        """

    if layout == "BandPoster":
        return f"""
        <div class="poster poster-band" style="background:{paper};color:{ink};">
          <svg class="poster-bg" viewBox="0 0 800 890" preserveAspectRatio="none" aria-hidden="true">
            <defs>
              <pattern id="diagStripes" width="36" height="36" patternUnits="userSpaceOnUse" patternTransform="rotate(35)">
                <rect width="12" height="36" fill="{accent}" opacity="0.16"/>
              </pattern>
            </defs>
            <rect width="800" height="890" fill="url(#diagStripes)"/>
          </svg>
          <div class="date-sticker" style="background:{accent};color:{accent_ink};border-color:{ink};">
            <div class="sticker-mon">{html.escape(month)}</div>
            <div class="sticker-day">{html.escape(day_num)}</div>
            <div class="sticker-wk">{html.escape(weekday)}</div>
          </div>
          <div class="poster-content band-content">
            <div class="band-tilt" style="background:{ink};color:{paper};">
              <div class="band-headline" style="font-size:{max(44, font_px - 8)}px;">{html.escape(headliner.upper())}</div>
            </div>
            {f'<div class="band-supports" style="background:{paper};border:3px solid {ink};">{html.escape(support_line)}</div>' if support_line else ''}
            <div class="band-footer" style="color:{ink};">
              <strong>{html.escape(venue_name)}</strong> · {html.escape(time_str)}{f' · {html.escape(price_str)}' if price_str else ''}
            </div>
          </div>
        </div>
        """

    # ZinePoster (default)
    return f"""
    <div class="poster poster-zine" style="background:{paper};color:{ink};">
      <svg class="poster-bg" viewBox="0 0 800 890" preserveAspectRatio="none" aria-hidden="true">
        <defs>
          <filter id="zineGrain">
            <feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves="2" stitchTiles="stitch"/>
            <feColorMatrix type="saturate" values="0"/>
          </filter>
        </defs>
        <rect width="800" height="890" filter="url(#zineGrain)" opacity="0.12"/>
        <text x="400" y="640" text-anchor="middle" font-family="Anton, sans-serif" font-size="560" fill="{accent}" opacity="0.18">{html.escape(day_num)}</text>
      </svg>
      <div class="poster-content zine-content">
        <div class="zine-top-strip" style="border-bottom:3px solid {ink};">
          <span>{html.escape(weekday)} · {html.escape(month)} {html.escape(day_num)}</span>
          <span style="color:{accent};">{html.escape(neighborhood or 'NYC')}</span>
        </div>
        <div class="zine-center">
          <div class="zine-headline" style="font-size:{font_px}px;">{html.escape(headliner.upper())}</div>
          {f'<div class="zine-supports">w/ {html.escape(support_line)}</div>' if support_line else ''}
        </div>
        <div class="zine-bottom-strip" style="background:{accent};color:{accent_ink};">
          <span>{html.escape(venue_name)}</span>
          <span>{html.escape(time_str)}{f' · {html.escape(price_str)}' if price_str else ''}</span>
        </div>
      </div>
    </div>
    """


def render_show_html(
    show: dict[str, Any],
    genre: dict[str, Any],
    wordmark_uri: str,
) -> str:
    """Build Slides 2-5 (02_show.jpg .. 05_show.jpg) pixel-faithful Setnik mobile Deck UI."""
    palette, layout, prng_val = pick_palette_and_layout(show)
    xerox_html = _render_xerox_poster_inner(show, palette, layout)

    headliner = str(show.get("headliner") or "Live Show").strip()
    venue_name = str(show.get("venue_name") or "").strip()
    neighborhood = str(show.get("neighborhood") or show.get("area") or "").strip()
    short_date = str(show.get("short_date") or show.get("relative_day") or "").strip()
    time_display = str(show.get("time_display") or "").strip()
    price_display = str(show.get("price_display") or "").strip()
    genres_list = [str(g).strip() for g in (show.get("genres") or []) if str(g).strip()][:3]
    filter_genre = str(genre.get("display_name") or genre.get("filter_label") or "All").strip()
    image_url = show.get("image_url")
    progress_pct = 28 + (prng_val % 45)

    photo_overlay_html = ""
    if isinstance(image_url, str) and image_url.strip():
        escaped_img = html.escape(image_url.strip())
        photo_overlay_html = f"""
        <div class="photo-poster" id="photoPoster">
          <img src="{escaped_img}" alt="{html.escape(headliner)}"
               onload="if(this.naturalWidth<80){{document.getElementById('photoPoster').style.display='none';}}"
               onerror="document.getElementById('photoPoster').style.display='none';">
          <div class="photo-scrim"></div>
          <div class="photo-caption">
            <div class="photo-band">{html.escape(headliner.upper())}</div>
            <div class="photo-sub">{html.escape(venue_name)} · {html.escape(short_date)}</div>
          </div>
        </div>
        """

    genre_chips_html = "".join(
        f'<span class="card-genre-chip">{html.escape(g)}</span>' for g in genres_list
    )
    meta_parts = [p for p in (short_date, time_display, price_display) if p]
    meta_line = " · ".join(meta_parts)

    return f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
{_google_fonts_head()}
<style>
  * {{ box-sizing: border-box; margin: 0; padding: 0; }}
  html, body {{
    width: {SLIDE_WIDTH}px;
    height: {SLIDE_HEIGHT}px;
    overflow: hidden;
    background: {HOUSE_LIGHTS};
    font-family: 'DM Sans', -apple-system, BlinkMacSystemFont, sans-serif;
    color: {STAGE_BLACK};
  }}
  .deck-canvas {{
    width: {SLIDE_WIDTH}px;
    height: {SLIDE_HEIGHT}px;
    padding: 132px 116px 310px 64px;
    display: flex;
    flex-direction: column;
    gap: 16px;
  }}
  .deck-header {{
    flex-shrink: 0;
    display: flex;
    align-items: center;
    justify-content: space-between;
  }}
  .deck-wordmark {{
    height: 36px;
    width: auto;
    display: block;
  }}
  .deck-pill-badge {{
    background: {SURFACE_2};
    border: 2px solid {LINE_COLOR};
    color: {INK_SOFT};
    font-size: 19px;
    font-weight: 700;
    padding: 7px 16px;
    border-radius: 999px;
  }}
  .filter-row {{
    flex-shrink: 0;
    display: flex;
    align-items: center;
    gap: 10px;
    flex-wrap: nowrap;
  }}
  .filter-chip {{
    background: {ENCORE_WHITE};
    border: 2px solid {LINE_COLOR};
    color: {STAGE_BLACK};
    font-size: 20px;
    font-weight: 700;
    padding: 9px 18px;
    border-radius: 999px;
    white-space: nowrap;
  }}
  .filter-chip.active {{
    background: {STAGE_BLACK};
    border-color: {STAGE_BLACK};
    color: {ENCORE_WHITE};
  }}
  .card-stack {{
    position: relative;
    flex: 1;
    display: flex;
    flex-direction: column;
    min-height: 0;
  }}
  .peek-card {{
    position: absolute;
    left: 22px;
    right: 22px;
    bottom: -14px;
    height: 80px;
    background: {SURFACE_2};
    border: 3px solid {LINE_COLOR};
    border-radius: 26px;
    z-index: 0;
  }}
  .show-card {{
    position: relative;
    z-index: 1;
    background: {ENCORE_WHITE};
    border: 3.5px solid {STAGE_BLACK};
    border-radius: 28px;
    box-shadow: 0 12px 28px rgba(20, 20, 20, 0.12);
    overflow: hidden;
    display: flex;
    flex-direction: column;
    flex: 1;
  }}
  .flyer-box {{
    position: relative;
    height: 890px;
    width: 100%;
    overflow: hidden;
    border-bottom: 3px solid {STAGE_BLACK};
    flex-shrink: 0;
  }}
  .top-dashes {{
    position: absolute;
    top: 16px;
    left: 20px;
    right: 20px;
    display: flex;
    gap: 10px;
    z-index: 10;
  }}
  .dash {{
    flex: 1;
    height: 6px;
    border-radius: 999px;
    background: rgba(251, 248, 240, 0.45);
    box-shadow: 0 1px 4px rgba(0, 0, 0, 0.28);
  }}
  .dash.active {{
    background: {ENCORE_WHITE};
  }}
  .poster {{
    position: relative;
    width: 100%;
    height: 100%;
    overflow: hidden;
    display: flex;
    flex-direction: column;
  }}
  .poster-bg {{
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    pointer-events: none;
  }}
  .poster-content {{
    position: relative;
    z-index: 2;
    width: 100%;
    height: 100%;
    padding: 58px 42px 40px 42px;
    display: flex;
    flex-direction: column;
    justify-content: space-between;
  }}
  /* StackPoster */
  .stack-kicker {{
    align-self: flex-start;
    font-size: 24px;
    font-weight: 800;
    letter-spacing: 0.08em;
    padding: 10px 20px;
    border-radius: 8px;
  }}
  .stack-headline {{
    font-family: 'Anton', Impact, sans-serif;
    line-height: 0.94;
    letter-spacing: 0.01em;
    word-break: break-word;
  }}
  .stack-supports {{
    font-size: 28px;
    font-weight: 700;
    opacity: 0.88;
    line-height: 1.25;
  }}
  .stack-venue-bar {{
    padding-top: 18px;
    display: flex;
    justify-content: space-between;
    font-size: 22px;
    font-weight: 800;
    letter-spacing: 0.05em;
  }}
  /* BandPoster */
  .date-sticker {{
    position: absolute;
    top: 46px;
    right: 36px;
    width: 136px;
    height: 136px;
    border-radius: 50%;
    border: 4px solid {STAGE_BLACK};
    z-index: 4;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    transform: rotate(8deg);
  }}
  .sticker-mon {{ font-size: 20px; font-weight: 800; letter-spacing: 0.08em; }}
  .sticker-day {{ font-family: 'Anton', sans-serif; font-size: 54px; line-height: 0.95; }}
  .sticker-wk {{ font-size: 18px; font-weight: 800; letter-spacing: 0.08em; }}
  .band-content {{
    justify-content: center;
    gap: 28px;
  }}
  .band-tilt {{
    transform: rotate(-5deg);
    padding: 28px 34px;
    margin: 0 -14px;
    box-shadow: 10px 10px 0 rgba(0, 0, 0, 0.25);
  }}
  .band-headline {{
    font-family: 'Anton', Impact, sans-serif;
    line-height: 0.95;
    word-break: break-word;
  }}
  .band-supports {{
    align-self: flex-start;
    padding: 12px 22px;
    font-size: 24px;
    font-weight: 800;
  }}
  .band-footer {{
    position: absolute;
    bottom: 34px;
    left: 42px;
    right: 42px;
    font-size: 23px;
    font-weight: 700;
    letter-spacing: 0.04em;
  }}
  /* ZinePoster */
  .zine-top-strip {{
    display: flex;
    justify-content: space-between;
    padding-bottom: 14px;
    font-size: 22px;
    font-weight: 800;
    letter-spacing: 0.08em;
  }}
  .zine-center {{
    display: flex;
    flex-direction: column;
    gap: 18px;
  }}
  .zine-headline {{
    font-family: 'Anton', Impact, sans-serif;
    line-height: 0.94;
    word-break: break-word;
  }}
  .zine-supports {{
    font-size: 27px;
    font-weight: 700;
    opacity: 0.85;
  }}
  .zine-bottom-strip {{
    display: flex;
    justify-content: space-between;
    padding: 16px 22px;
    border-radius: 10px;
    font-size: 22px;
    font-weight: 800;
    letter-spacing: 0.05em;
  }}
  /* PhotoPoster overlay (hidden automatically on error) */
  .photo-poster {{
    position: absolute;
    inset: 0;
    z-index: 5;
  }}
  .photo-poster img {{
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
  }}
  .photo-scrim {{
    position: absolute;
    inset: 0;
    background: linear-gradient(180deg, rgba(20,20,20,0.18) 0%, rgba(20,20,20,0.08) 45%, rgba(20,20,20,0.86) 100%);
  }}
  .photo-caption {{
    position: absolute;
    left: 36px;
    right: 36px;
    bottom: 34px;
    color: {ENCORE_WHITE};
  }}
  .photo-band {{
    font-family: 'Anton', sans-serif;
    font-size: 72px;
    line-height: 0.96;
    text-shadow: 0 4px 16px rgba(0,0,0,0.55);
  }}
  .photo-sub {{
    margin-top: 8px;
    font-size: 24px;
    font-weight: 700;
    opacity: 0.92;
  }}
  /* AudioBar */
  .audio-bar {{
    padding: 18px 26px 14px 26px;
    background: {SURFACE_2};
    border-bottom: 2px solid {LINE_COLOR};
    display: flex;
    align-items: center;
    gap: 18px;
    flex-shrink: 0;
  }}
  .play-btn {{
    width: 52px;
    height: 52px;
    border-radius: 50%;
    background: {CLIP_RED};
    border: 2.5px solid {STAGE_BLACK};
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
  }}
  .play-triangle {{
    width: 0;
    height: 0;
    margin-left: 5px;
    border-top: 11px solid transparent;
    border-bottom: 11px solid transparent;
    border-left: 18px solid {ENCORE_WHITE};
  }}
  .audio-track-col {{
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 8px;
    min-width: 0;
  }}
  .audio-label-row {{
    display: flex;
    justify-content: space-between;
    font-size: 20px;
    font-weight: 700;
    color: {STAGE_BLACK};
  }}
  .audio-artist {{
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }}
  .audio-time {{
    color: {FAINT};
    font-size: 18px;
    margin-left: 12px;
    flex-shrink: 0;
  }}
  .progress-track {{
    height: 8px;
    border-radius: 999px;
    background: {LINE_COLOR};
    overflow: hidden;
  }}
  .progress-fill {{
    height: 100%;
    width: {progress_pct}%;
    background: {CLIP_RED};
    border-radius: 999px;
  }}
  /* Card info body */
  .card-info {{
    padding: 20px 26px 22px 26px;
    display: flex;
    flex-direction: column;
    gap: 10px;
    flex: 1;
    justify-content: center;
  }}
  .info-venue-row {{
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 12px;
  }}
  .info-venue {{
    font-size: 30px;
    font-weight: 800;
    color: {STAGE_BLACK};
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }}
  .info-hood {{
    font-size: 21px;
    font-weight: 700;
    color: {FAINT};
    flex-shrink: 0;
  }}
  .info-meta {{
    font-size: 22px;
    font-weight: 700;
    color: {INK_SOFT};
  }}
  .card-genres {{
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    margin-top: 2px;
  }}
  .card-genre-chip {{
    background: {HOUSE_LIGHTS};
    border: 1.5px solid {LINE_COLOR};
    color: {INK_SOFT};
    font-size: 18px;
    font-weight: 700;
    padding: 5px 14px;
    border-radius: 999px;
  }}
  /* Pass / Undo / Going action bar */
  .action-row {{
    flex-shrink: 0;
    margin-top: 18px;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 28px;
  }}
  .act-btn {{
    border-radius: 999px;
    border: 3px solid {STAGE_BLACK};
    background: {ENCORE_WHITE};
    color: {STAGE_BLACK};
    font-weight: 800;
    display: flex;
    align-items: center;
    justify-content: center;
    box-shadow: 4px 4px 0 {STAGE_BLACK};
  }}
  .act-pass {{
    width: 170px;
    height: 68px;
    font-size: 23px;
    gap: 10px;
  }}
  .act-undo {{
    width: 68px;
    height: 68px;
    font-size: 26px;
    background: {SURFACE_2};
  }}
  .act-going {{
    width: 190px;
    height: 68px;
    font-size: 23px;
    background: {CLIP_RED};
    color: {ENCORE_WHITE};
    gap: 10px;
  }}
</style>
</head>
<body>
  <div class="deck-canvas">
    <div class="deck-header">
      <img class="deck-wordmark" src="{wordmark_uri}" alt="Setnik">
      <div class="deck-pill-badge">Deck · 30s Previews</div>
    </div>

    <div class="filter-row">
      <div class="filter-chip">New York · 25 mi</div>
      <div class="filter-chip">This weekend</div>
      <div class="filter-chip active">{html.escape(filter_genre)}</div>
    </div>

    <div class="card-stack">
      <div class="peek-card"></div>
      <div class="show-card">
        <div class="flyer-box">
          <div class="top-dashes">
            <div class="dash active"></div>
            <div class="dash"></div>
          </div>
          {xerox_html}
          {photo_overlay_html}
        </div>

        <div class="audio-bar">
          <div class="play-btn"><div class="play-triangle"></div></div>
          <div class="audio-track-col">
            <div class="audio-label-row">
              <span class="audio-artist">{html.escape(headliner)} — 30s preview</span>
              <span class="audio-time">0:12 / 0:30</span>
            </div>
            <div class="progress-track"><div class="progress-fill"></div></div>
          </div>
        </div>

        <div class="card-info">
          <div class="info-venue-row">
            <span class="info-venue">{html.escape(venue_name)}</span>
            <span class="info-hood">{html.escape(neighborhood)}</span>
          </div>
          <div class="info-meta">{html.escape(meta_line)}</div>
          <div class="card-genres">{genre_chips_html}</div>
        </div>
      </div>
    </div>

    <div class="action-row">
      <div class="act-btn act-pass">✕ Pass</div>
      <div class="act-btn act-undo">↺</div>
      <div class="act-btn act-going">✓ Going</div>
    </div>
  </div>
</body>
</html>
"""


def _verify_jpeg(path: Path) -> None:
    """Verify rendered file is a valid 1080x1920 JPEG under 20 MB."""
    size_bytes = path.stat().st_size
    if size_bytes <= 0 or size_bytes >= MAX_JPEG_BYTES:
        raise ValueError(f"Rendered JPEG {path} has invalid size: {size_bytes} bytes")
    with Image.open(path) as img:
        if img.format != "JPEG":
            raise ValueError(f"Expected JPEG format for {path}, got {img.format}")
        if img.size != (SLIDE_WIDTH, SLIDE_HEIGHT):
            raise ValueError(f"Expected {SLIDE_WIDTH}x{SLIDE_HEIGHT} for {path}, got {img.size}")


def _render_html_to_jpeg(page: Page, html_content: str, out_path: Path) -> None:
    out_path.parent.mkdir(parents=True, exist_ok=True)
    page.set_content(html_content, wait_until="load", timeout=15000)
    # Wait briefly for web fonts if reachable, without failing offline.
    try:
        page.evaluate("() => document.fonts ? document.fonts.ready : Promise.resolve()")
    except Exception:
        pass
    page.screenshot(path=str(out_path), type="jpeg", quality=JPEG_QUALITY, full_page=False)
    _verify_jpeg(out_path)


def render_carousels(selection_path: Path, out_dir: Path | None = None) -> Path:
    """Render all genre carousels from selected.json into JPEGs + manifest.json."""
    selection = json.loads(selection_path.read_text(encoding="utf-8"))
    run_date = str(selection.get("run_date") or datetime.now(timezone.utc).strftime("%Y-%m-%d"))
    city_label = str(selection.get("city_label") or "NYC / NJ")
    weekend_range = str(selection.get("weekend_range") or "")
    weekend_banner = str(selection.get("weekend_banner") or "")
    genres: list[dict[str, Any]] = list(selection.get("genres") or [])

    target_dir = out_dir or (REPO_ROOT / "build" / "carousel_ready" / run_date)
    target_dir.mkdir(parents=True, exist_ok=True)
    wordmark_uri = load_wordmark_data_uri()

    manifest_carousels: list[dict[str, Any]] = []
    chromium_path = find_chromium_executable()

    with sync_playwright() as p:
        launch_kwargs: dict[str, Any] = {
            "headless": True,
            "args": ["--no-sandbox", "--disable-dev-shm-usage", "--font-render-hinting=none"],
        }
        if chromium_path:
            launch_kwargs["executable_path"] = chromium_path
        browser: Browser = p.chromium.launch(**launch_kwargs)
        try:
            context = browser.new_context(
                viewport={"width": SLIDE_WIDTH, "height": SLIDE_HEIGHT},
                device_scale_factor=1,
            )
            page = context.new_page()

            for genre in genres:
                slug = str(genre["slug"]).strip()
                shows: list[dict[str, Any]] = list(genre.get("shows") or [])
                if not shows:
                    continue

                genre_dir = target_dir / slug
                genre_dir.mkdir(parents=True, exist_ok=True)

                slide_files: list[str] = []
                cover_name = "01_cover.jpg"
                cover_html = render_cover_html(genre, weekend_banner, city_label, wordmark_uri)
                _render_html_to_jpeg(page, cover_html, genre_dir / cover_name)
                slide_files.append(cover_name)

                for idx, show in enumerate(shows[:4], start=2):
                    slide_name = f"{idx:02d}_show.jpg"
                    show_html = render_show_html(show, genre, wordmark_uri)
                    _render_html_to_jpeg(page, show_html, genre_dir / slide_name)
                    slide_files.append(slide_name)

                title, description, hashtags, sound_query = build_tiktok_copy(
                    genre, weekend_range, city_label
                )
                manifest_carousels.append(
                    {
                        "slug": slug,
                        "display_name": genre.get("display_name", slug.title()),
                        "filter_label": genre.get("filter_label", genre.get("display_name", slug.title())),
                        "cover_title": genre.get("cover_title", ""),
                        "accent_color": genre.get("accent_color", CLIP_RED),
                        "slides": slide_files,
                        "title": title,
                        "description": description,
                        "hashtags": hashtags,
                        "headliner_sound_query": sound_query,
                        "shows": [
                            {
                                "id": s.get("id"),
                                "headliner": s.get("headliner"),
                                "venue_name": s.get("venue_name"),
                                "short_date": s.get("short_date"),
                                "time_display": s.get("time_display"),
                            }
                            for s in shows[:4]
                        ],
                    }
                )
        finally:
            browser.close()

    manifest = {
        "run_date": run_date,
        "metro_id": selection.get("metro_id", "nyc"),
        "city_label": city_label,
        "weekend_start": selection.get("weekend_start", ""),
        "weekend_end": selection.get("weekend_end", ""),
        "weekend_range": weekend_range,
        "weekend_banner": weekend_banner,
        "source_mode": selection.get("source_mode", "live"),
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "carousels": manifest_carousels,
    }
    manifest_path = target_dir / "manifest.json"
    manifest_path.write_text(json.dumps(manifest, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(
        f"[render_carousels] Rendered {len(manifest_carousels)} genre carousels "
        f"({sum(len(c['slides']) for c in manifest_carousels)} JPEGs) -> {manifest_path}"
    )
    return manifest_path


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Render 1080x1920 Setnik TikTok carousel JPEGs.")
    parser.add_argument(
        "--input",
        required=True,
        help="Path to selected.json produced by select_shows.mjs",
    )
    parser.add_argument(
        "--out",
        default=None,
        help="Output directory (defaults to build/carousel_ready/<run_date>)",
    )
    args = parser.parse_args(argv)
    out_dir = Path(args.out).resolve() if args.out else None
    render_carousels(Path(args.input).resolve(), out_dir=out_dir)
    return 0


if __name__ == "__main__":
    sys.exit(main())
