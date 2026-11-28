#!/usr/bin/env python3
"""Render 1080x1920 Setnik editorial growth carousels via Playwright Chromium.

Supports 3 growth templates styled with Setnik's exact brand tokens & palette families:
  - search_listicle   (Search-intent venue/show guides)
  - problem_solution  (Pain-point -> Setnik app demo -> CTA)
  - scene_hot_take    (Scene commentary & audience listener takes)
"""

from __future__ import annotations

import base64
import html
import os
import shutil
import sys
from pathlib import Path
from typing import Any

from PIL import Image
from playwright.sync_api import Browser, Page, sync_playwright

REPO_ROOT = Path(__file__).resolve().parents[2]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from tools.tiktok_carousels.render_carousels import (  # noqa: E402
    CLIP_RED,
    ENCORE_WHITE,
    FAINT,
    HOUSE_LIGHTS,
    INK_SOFT,
    JPEG_QUALITY,
    LINE_COLOR,
    PALETTE_FAMILIES,
    SLIDE_HEIGHT,
    SLIDE_WIDTH,
    STAGE_BLACK,
    WORDMARK_PATH,
)


def _wordmark_data_uri() -> str:
    if WORDMARK_PATH.is_file():
        b64 = base64.b64encode(WORDMARK_PATH.read_bytes()).decode("ascii")
        return f"data:image/png;base64,{b64}"
    return ""


def _resolve_chrome_executable() -> str | None:
    for env_key in ("PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH", "CHROME_PATH"):
        val = os.environ.get(env_key, "").strip()
        if val and Path(val).is_file():
            return val
    for candidate in ("google-chrome", "chromium", "chromium-browser"):
        found = shutil.which(candidate)
        if found:
            return found
    return None


def _pick_palette(family: str, index: int = 0) -> dict[str, str]:
    variants = PALETTE_FAMILIES.get(family.upper()) or PALETTE_FAMILIES["PUNK"]
    return variants[index % len(variants)]


def _render_show_card_html(show: dict[str, Any] | None, palette: dict[str, str]) -> str:
    if not show:
        return ""
    headliner = html.escape(str(show.get("headliner") or ""))
    venue = html.escape(str(show.get("venue") or ""))
    neighborhood = html.escape(str(show.get("neighborhood") or ""))
    short_date = str(show.get("short_date") or "").strip()
    weekday = str(show.get("weekday") or "").strip()
    time_str = str(show.get("time") or "").strip()
    date_part = short_date if (short_date and (not weekday or weekday in short_date)) else f"{weekday} {short_date}".strip()
    when_bits = [b for b in (date_part, time_str) if b]
    when_str = html.escape(" · ".join(when_bits))
    price = html.escape(str(show.get("price_text") or ""))
    genres = [html.escape(str(g)) for g in (show.get("genres") or [])[:3]]
    genre_pills = "".join(f'<span class="pill">{g}</span>' for g in genres)
    price_badge = f'<span class="price-badge">{price}</span>' if price else ""

    return f"""
    <div class="show-card" style="background:{palette['paper']};color:{palette['ink']};border-color:{palette['accent']};">
      <div class="show-top">
        <span class="show-hood" style="color:{palette['accent']};">{neighborhood}</span>
        {price_badge}
      </div>
      <div class="show-headliner">{headliner}</div>
      <div class="show-venue">{venue}</div>
      <div class="show-when">{when_str}</div>
      <div class="show-pills">{genre_pills}</div>
    </div>
    """


def build_editorial_slide_html(
    slide: dict[str, Any],
    slide_idx: int,
    total_slides: int,
    post: dict[str, Any],
    wordmark_uri: str,
) -> str:
    role = str(slide.get("role") or "body").lower()
    palette = _pick_palette(str(post.get("palette_family") or "PUNK"), slide_idx)
    is_cover_or_cta = role in {"cover", "cta"}

    bg_color = palette["paper"] if is_cover_or_cta else HOUSE_LIGHTS
    fg_color = palette["ink"] if is_cover_or_cta else STAGE_BLACK
    sub_color = palette["ink"] if is_cover_or_cta else INK_SOFT
    accent = palette["accent"]
    accent_ink = palette["accent_ink"]

    kicker = html.escape(str(slide.get("kicker") or f"{post.get('metro', 'nyc').upper()} LIVE MUSIC"))
    headline = html.escape(str(slide.get("headline") or ""))
    body = html.escape(str(slide.get("body") or ""))
    cta = html.escape(str(slide.get("cta") or ""))
    bullets = [html.escape(str(b)) for b in (slide.get("bullets") or []) if b]
    bullet_html = ""
    if bullets:
        items = "".join(f'<li><span class="dot" style="background:{accent};"></span><span>{b}</span></li>' for b in bullets)
        bullet_html = f'<ul class="bullets">{items}</ul>'

    show_card_html = _render_show_card_html(slide.get("grounded_show"), palette)
    cta_html = (
        f'<div class="cta-pill" style="background:{accent};color:{accent_ink};">{cta}</div>'
        if cta
        else ""
    )
    logo_html = (
        f'<img src="{wordmark_uri}" class="wordmark" alt="Setnik" />'
        if wordmark_uri
        else '<span class="wordmark-text">SETNIK</span>'
    )
    dots_html = "".join(
        f'<span class="prog-dot {"active" if i == slide_idx else ""}" '
        f'style="background:{accent if i == slide_idx else LINE_COLOR};"></span>'
        for i in range(total_slides)
    )

    return f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<style>
  * {{ box-sizing: border-box; margin: 0; padding: 0; }}
  html, body {{
    width: {SLIDE_WIDTH}px;
    height: {SLIDE_HEIGHT}px;
    overflow: hidden;
    background: {bg_color};
    color: {fg_color};
    font-family: "Inter", "Helvetica Neue", Arial, sans-serif;
  }}
  .frame {{
    width: 100%;
    height: 100%;
    padding: 150px 76px 220px 76px;
    display: flex;
    flex-direction: column;
    justify-content: space-between;
    position: relative;
  }}
  .top-bar {{
    display: flex;
    align-items: center;
    justify-content: space-between;
  }}
  .wordmark {{
    height: 44px;
    object-fit: contain;
    filter: {"brightness(0) invert(1)" if is_cover_or_cta and bg_color.startswith("#1") else "none"};
  }}
  .wordmark-text {{
    font-weight: 900;
    font-size: 36px;
    letter-spacing: 0.12em;
  }}
  .slide-count {{
    font-size: 26px;
    font-weight: 700;
    letter-spacing: 0.08em;
    opacity: 0.72;
  }}
  .main {{
    display: flex;
    flex-direction: column;
    gap: 36px;
    my: auto;
  }}
  .kicker {{
    display: inline-block;
    align-self: flex-start;
    padding: 12px 22px;
    border-radius: 999px;
    font-size: 24px;
    font-weight: 800;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    background: {accent};
    color: {accent_ink};
  }}
  .headline {{
    font-size: {"82px" if is_cover_or_cta else "68px"};
    line-height: 1.06;
    font-weight: 900;
    letter-spacing: -0.025em;
  }}
  .body {{
    font-size: 36px;
    line-height: 1.38;
    font-weight: 500;
    color: {sub_color};
    opacity: 0.92;
  }}
  .bullets {{
    list-style: none;
    display: flex;
    flex-direction: column;
    gap: 22px;
    margin-top: 8px;
  }}
  .bullets li {{
    display: flex;
    align-items: flex-start;
    gap: 20px;
    font-size: 33px;
    line-height: 1.3;
    font-weight: 600;
    background: {ENCORE_WHITE if not is_cover_or_cta else "rgba(255,255,255,0.08)"};
    padding: 22px 28px;
    border-radius: 22px;
    border: 2px solid {LINE_COLOR if not is_cover_or_cta else "rgba(255,255,255,0.16)"};
  }}
  .bullets .dot {{
    width: 16px;
    height: 16px;
    border-radius: 999px;
    margin-top: 12px;
    flex-shrink: 0;
  }}
  .show-card {{
    border-radius: 28px;
    padding: 36px 40px;
    border-left: 10px solid {CLIP_RED};
    display: flex;
    flex-direction: column;
    gap: 14px;
    box-shadow: 0 18px 42px rgba(20, 20, 20, 0.14);
  }}
  .show-top {{
    display: flex;
    align-items: center;
    justify-content: space-between;
  }}
  .show-hood {{
    font-size: 24px;
    font-weight: 800;
    letter-spacing: 0.1em;
    text-transform: uppercase;
  }}
  .price-badge {{
    font-size: 24px;
    font-weight: 800;
    padding: 6px 16px;
    border-radius: 10px;
    background: rgba(255,255,255,0.14);
  }}
  .show-headliner {{
    font-size: 52px;
    font-weight: 900;
    line-height: 1.08;
  }}
  .show-venue {{
    font-size: 32px;
    font-weight: 700;
    opacity: 0.9;
  }}
  .show-when {{
    font-size: 28px;
    font-weight: 600;
    opacity: 0.78;
  }}
  .show-pills {{
    display: flex;
    flex-wrap: wrap;
    gap: 12px;
    margin-top: 8px;
  }}
  .pill {{
    font-size: 22px;
    font-weight: 700;
    padding: 8px 18px;
    border-radius: 999px;
    background: rgba(255,255,255,0.14);
  }}
  .bottom-bar {{
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 24px;
  }}
  .cta-pill {{
    font-size: 30px;
    font-weight: 800;
    padding: 20px 34px;
    border-radius: 18px;
    letter-spacing: 0.01em;
  }}
  .prog-dots {{
    display: flex;
    gap: 12px;
    margin-left: auto;
  }}
  .prog-dot {{
    width: 14px;
    height: 14px;
    border-radius: 999px;
  }}
  .prog-dot.active {{
    width: 38px;
  }}
  .footer-note {{
    font-size: 22px;
    font-weight: 700;
    color: {FAINT if not is_cover_or_cta else sub_color};
    opacity: 0.75;
    letter-spacing: 0.06em;
    text-transform: uppercase;
  }}
</style>
</head>
<body>
  <div class="frame">
    <div class="top-bar">
      {logo_html}
      <span class="slide-count">{slide_idx + 1:02d} / {total_slides:02d}</span>
    </div>
    <div class="main">
      <div class="kicker">{kicker}</div>
      <h1 class="headline">{headline}</h1>
      {f'<p class="body">{body}</p>' if body else ''}
      {bullet_html}
      {show_card_html}
    </div>
    <div class="bottom-bar">
      {cta_html or '<span class="footer-note">SETNIK · LIVE MUSIC DISCOVERY</span>'}
      <div class="prog-dots">{dots_html}</div>
    </div>
  </div>
</body>
</html>
"""


def _render_html_to_jpeg(page: Page, html_str: str, out_jpg: Path) -> None:
    out_jpg.parent.mkdir(parents=True, exist_ok=True)
    tmp_png = out_jpg.with_suffix(".tmp.png")
    page.set_content(html_str, wait_until="load")
    page.screenshot(path=str(tmp_png), type="png")
    with Image.open(tmp_png) as img:
        rgb = img.convert("RGB")
        rgb.save(out_jpg, format="JPEG", quality=JPEG_QUALITY, optimize=True)
    tmp_png.unlink(missing_ok=True)


def render_growth_carousels(
    posts: list[dict[str, Any]],
    ready_dir: Path,
) -> list[dict[str, Any]]:
    """Render all carousel posts in `posts` into ready_dir/<slug>/slide-NN.jpg."""
    carousel_posts = [p for p in posts if p.get("format") == "carousel"]
    if not carousel_posts:
        return []

    wordmark_uri = _wordmark_data_uri()
    exe_path = _resolve_chrome_executable()
    launch_kwargs: dict[str, Any] = {"headless": True}
    if exe_path:
        launch_kwargs["executable_path"] = exe_path

    rendered_entries: list[dict[str, Any]] = []
    with sync_playwright() as pw:
        browser: Browser = pw.chromium.launch(**launch_kwargs)
        page = browser.new_page(viewport={"width": SLIDE_WIDTH, "height": SLIDE_HEIGHT})
        try:
            for post in carousel_posts:
                slug = str(post["slug"])
                slides = list(post.get("slides") or [])
                slide_files: list[str] = []
                for idx, slide in enumerate(slides):
                    filename = f"slide-{idx + 1:02d}.jpg"
                    html_str = build_editorial_slide_html(
                        slide=slide,
                        slide_idx=idx,
                        total_slides=len(slides),
                        post=post,
                        wordmark_uri=wordmark_uri,
                    )
                    _render_html_to_jpeg(page, html_str, ready_dir / slug / filename)
                    slide_files.append(filename)

                rendered_entries.append(
                    {
                        "slug": slug,
                        "display_name": f"{post.get('metro', 'nyc').upper()} Growth · {post.get('template', 'editorial')}",
                        "title": post["title"],
                        "description": post["description"],
                        "headliner_sound_query": post.get("suggested_sound_query", ""),
                        "source_signal": post.get("source_signal", ""),
                        "topic": post.get("topic", ""),
                        "slides": slide_files,
                    }
                )
        finally:
            browser.close()

    print(
        f"[render_growth_carousels] Rendered {len(rendered_entries)} carousel(s) -> {ready_dir}"
    )
    return rendered_entries
