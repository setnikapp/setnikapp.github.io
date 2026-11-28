#!/usr/bin/env python3
"""Render 1080x1920 short-form TikTok MP4 videos via Playwright + FFmpeg (+ optional edge-tts).

Supports two visual modes:
  - broll_overlay: composites dynamic Playwright transparent PNG hooks/cards/captions over
    evergreen Setnik app screen recordings in static/assets/broll/ (falls back automatically
    to motion_cards when no B-roll clips exist).
  - motion_cards: renders full 1080x1920 Playwright scene frames with subtle FFmpeg motion.

Supports two audio modes (selected per brief):
  - voiceover: generates neural TTS via edge-tts (with graceful fallback to music_only)
  - music_only: encodes a clean silent AAC audio stream ready for a native TikTok sound
"""

from __future__ import annotations

import asyncio
import html
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path
from typing import Any

from PIL import Image
from playwright.sync_api import Browser, Page, sync_playwright

REPO_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_BROLL_DIR = REPO_ROOT / "static" / "assets" / "broll"

if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from tools.tiktok_carousels.render_carousels import (  # noqa: E402
    CLIP_RED,
    JPEG_QUALITY,
    SLIDE_HEIGHT,
    SLIDE_WIDTH,
)
from tools.tiktok_growth.render_growth_carousels import (  # noqa: E402
    _pick_palette,
    _render_show_card_html,
    _resolve_chrome_executable,
    _wordmark_data_uri,
)

VIDEO_FPS = 30


def discover_broll_clips(broll_dir: Path = DEFAULT_BROLL_DIR) -> list[Path]:
    """Return sorted evergreen .mp4/.mov clips in static/assets/broll/."""
    if not broll_dir.is_dir():
        return []
    clips = [
        p
        for p in sorted(broll_dir.iterdir())
        if p.is_file() and p.suffix.lower() in {".mp4", ".mov"}
    ]
    return clips


def _probe_duration(media_path: Path) -> float:
    cmd = [
        "ffprobe",
        "-v",
        "error",
        "-show_entries",
        "format=duration",
        "-of",
        "default=noprint_wrappers=1:nokey=1",
        str(media_path),
    ]
    out = subprocess.check_output(cmd, text=True).strip()
    return max(0.5, float(out))


async def _synthesize_edge_tts_async(text: str, voice: str, out_mp3: Path) -> None:
    import edge_tts  # imported lazily so module works even without edge-tts installed

    communicate = edge_tts.Communicate(text=text, voice=voice, rate="+6%")
    await communicate.save(str(out_mp3))


def synthesize_scene_voiceover(
    text: str,
    voice: str,
    out_mp3: Path,
    allow_network: bool = True,
) -> float | None:
    """Generate scene voiceover MP3 via edge-tts and return its duration in seconds (or None on fallback)."""
    clean = (text or "").strip()
    if not clean or not allow_network:
        return None
    try:
        asyncio.run(_synthesize_edge_tts_async(clean, voice, out_mp3))
        if out_mp3.is_file() and out_mp3.stat().st_size > 256:
            return _probe_duration(out_mp3)
    except Exception as exc:
        print(f"[render_growth_video] edge-tts unavailable ({exc}); falling back to music_only.", file=sys.stderr)
    return None


def build_video_scene_html(
    scene: dict[str, Any],
    scene_idx: int,
    total_scenes: int,
    post: dict[str, Any],
    wordmark_uri: str,
    transparent_bg: bool = False,
) -> str:
    """Build 1080x1920 HTML for either an opaque motion card or a transparent B-roll overlay."""
    palette = _pick_palette(str(post.get("palette_family") or "CLUB"), scene_idx)
    accent = palette["accent"]
    accent_ink = palette["accent_ink"]
    bg_css = "transparent" if transparent_bg else palette["paper"]
    fg_css = "#FFFFFF" if transparent_bg else palette["ink"]

    kicker = html.escape(str(scene.get("kicker") or f"{post.get('metro', 'nyc').upper()} LIVE MUSIC"))
    main_text = html.escape(str(scene.get("on_screen_text") or ""))
    subtext = html.escape(str(scene.get("subtext") or ""))
    caption_text = html.escape(str(scene.get("narration") or scene.get("subtext") or ""))
    show_card_html = _render_show_card_html(scene.get("grounded_show"), palette)

    logo_html = (
        f'<img src="{wordmark_uri}" class="wordmark" alt="Setnik" />'
        if wordmark_uri
        else '<span class="wordmark-text">SETNIK</span>'
    )
    panel_bg = "rgba(20, 20, 20, 0.72)" if transparent_bg else "transparent"
    panel_pad = "36px 40px" if transparent_bg else "0"

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
    background: {bg_css};
    color: {fg_css};
    font-family: "Inter", "Helvetica Neue", Arial, sans-serif;
  }}
  .frame {{
    width: 100%;
    height: 100%;
    padding: 160px 72px 260px 72px;
    display: flex;
    flex-direction: column;
    justify-content: space-between;
  }}
  .top-bar {{
    display: flex;
    align-items: center;
    justify-content: space-between;
  }}
  .wordmark {{
    height: 44px;
    object-fit: contain;
    filter: brightness(0) invert(1);
  }}
  .wordmark-text {{
    font-weight: 900;
    font-size: 36px;
    letter-spacing: 0.12em;
  }}
  .scene-tag {{
    font-size: 24px;
    font-weight: 800;
    padding: 10px 20px;
    border-radius: 999px;
    background: {accent};
    color: {accent_ink};
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }}
  .center-block {{
    display: flex;
    flex-direction: column;
    gap: 30px;
    background: {panel_bg};
    padding: {panel_pad};
    border-radius: 28px;
  }}
  .headline {{
    font-size: 76px;
    line-height: 1.08;
    font-weight: 900;
    letter-spacing: -0.025em;
    text-shadow: {"0 4px 20px rgba(0,0,0,0.65)" if transparent_bg else "none"};
  }}
  .subtext {{
    font-size: 36px;
    line-height: 1.35;
    font-weight: 600;
    opacity: 0.92;
  }}
  .show-card {{
    border-radius: 26px;
    padding: 34px 38px;
    border-left: 10px solid {CLIP_RED};
    display: flex;
    flex-direction: column;
    gap: 12px;
    box-shadow: 0 18px 42px rgba(0, 0, 0, 0.35);
  }}
  .show-top {{ display: flex; justify-content: space-between; align-items: center; }}
  .show-hood {{ font-size: 22px; font-weight: 800; letter-spacing: 0.1em; text-transform: uppercase; }}
  .price-badge {{ font-size: 22px; font-weight: 800; padding: 6px 14px; border-radius: 10px; background: rgba(255,255,255,0.16); }}
  .show-headliner {{ font-size: 48px; font-weight: 900; line-height: 1.08; }}
  .show-venue {{ font-size: 30px; font-weight: 700; opacity: 0.92; }}
  .show-when {{ font-size: 26px; font-weight: 600; opacity: 0.8; }}
  .show-pills {{ display: flex; flex-wrap: wrap; gap: 10px; margin-top: 6px; }}
  .pill {{ font-size: 20px; font-weight: 700; padding: 6px 16px; border-radius: 999px; background: rgba(255,255,255,0.16); }}
  .caption-box {{
    align-self: center;
    text-align: center;
    max-width: 92%;
    background: rgba(20, 20, 20, 0.86);
    color: #FBF8F0;
    padding: 20px 30px;
    border-radius: 20px;
    border: 2px solid rgba(255,255,255,0.14);
    font-size: 32px;
    line-height: 1.3;
    font-weight: 700;
  }}
</style>
</head>
<body>
  <div class="frame">
    <div class="top-bar">
      {logo_html}
      <span class="scene-tag">{kicker}</span>
    </div>
    <div class="center-block">
      <h1 class="headline">{main_text}</h1>
      {f'<p class="subtext">{subtext}</p>' if subtext else ''}
      {show_card_html}
    </div>
    {f'<div class="caption-box">{caption_text}</div>' if caption_text else '<div></div>'}
  </div>
</body>
</html>
"""


def _run_ffmpeg(args: list[str]) -> None:
    cmd = ["ffmpeg", "-y", "-hide_banner", "-loglevel", "error", *args]
    subprocess.run(cmd, check=True)


def _encode_scene_segment(
    overlay_png: Path,
    duration: float,
    out_mp4: Path,
    broll_clip: Path | None = None,
    audio_mp3: Path | None = None,
) -> None:
    """Encode a single 1080x1920 30fps H.264/AAC scene segment."""
    if broll_clip is not None:
        # Loop/scale evergreen B-roll to 1080x1920, darken slightly for readability, overlay transparent PNG
        filter_complex = (
            f"[0:v]scale={SLIDE_WIDTH}:{SLIDE_HEIGHT}:force_original_aspect_ratio=increase,"
            f"crop={SLIDE_WIDTH}:{SLIDE_HEIGHT},eq=brightness=-0.08:saturation=0.95,fps={VIDEO_FPS}[bg];"
            f"[bg][1:v]overlay=0:0:shortest=1,format=yuv420p[v]"
        )
        inputs = ["-stream_loop", "-1", "-i", str(broll_clip), "-loop", "1", "-i", str(overlay_png)]
    else:
        # Subtle slow zoom-in motion on crisp 1080x1920 Playwright card
        frames = max(1, int(round(duration * VIDEO_FPS)))
        filter_complex = (
            f"[0:v]scale={SLIDE_WIDTH}:{SLIDE_HEIGHT},"
            f"zoompan=z='min(zoom+0.0008,1.06)':d={frames}:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':"
            f"s={SLIDE_WIDTH}x{SLIDE_HEIGHT}:fps={VIDEO_FPS},format=yuv420p[v]"
        )
        inputs = ["-loop", "1", "-i", str(overlay_png)]

    if audio_mp3 is not None and audio_mp3.is_file():
        audio_inputs = ["-i", str(audio_mp3)]
        audio_map = ["-map", f"{2 if broll_clip else 1}:a:0", "-af", f"apad=whole_dur={duration:.3f}"]
    else:
        audio_inputs = ["-f", "lavfi", "-i", "anullsrc=channel_layout=stereo:sample_rate=44100"]
        audio_map = ["-map", f"{2 if broll_clip else 1}:a:0"]

    _run_ffmpeg(
        [
            *inputs,
            *audio_inputs,
            "-filter_complex",
            filter_complex,
            "-map",
            "[v]",
            *audio_map,
            "-t",
            f"{duration:.3f}",
            "-c:v",
            "libx264",
            "-preset",
            "veryfast",
            "-crf",
            "23",
            "-r",
            str(VIDEO_FPS),
            "-c:a",
            "aac",
            "-ar",
            "44100",
            "-ac",
            "2",
            "-b:a",
            "128k",
            "-movflags",
            "+faststart",
            str(out_mp4),
        ]
    )


def render_growth_videos(
    posts: list[dict[str, Any]],
    ready_dir: Path,
    broll_dir: Path = DEFAULT_BROLL_DIR,
    allow_tts_network: bool = True,
) -> list[dict[str, Any]]:
    """Render all video posts in `posts` into ready_dir/<slug>/video.mp4 + cover.jpg."""
    video_posts = [p for p in posts if p.get("format") == "video"]
    if not video_posts:
        return []

    if shutil.which("ffmpeg") is None:
        raise RuntimeError("ffmpeg is required to render short-form videos but was not found on PATH")

    broll_clips = discover_broll_clips(broll_dir)
    wordmark_uri = _wordmark_data_uri()
    exe_path = _resolve_chrome_executable()
    launch_kwargs: dict[str, Any] = {"headless": True}
    if exe_path:
        launch_kwargs["executable_path"] = exe_path

    rendered_entries: list[dict[str, Any]] = []
    with sync_playwright() as pw:
        browser: Browser = pw.chromium.launch(**launch_kwargs)
        page: Page = browser.new_page(viewport={"width": SLIDE_WIDTH, "height": SLIDE_HEIGHT})
        try:
            for post in video_posts:
                slug = str(post["slug"])
                scenes = list(post.get("scenes") or [])
                if not scenes:
                    continue

                use_broll = (post.get("visual_mode") == "broll_overlay") and bool(broll_clips)
                effective_visual = "broll_overlay" if use_broll else "motion_cards"
                want_voiceover = post.get("audio_mode") == "voiceover"
                voice = str(post.get("voice") or "en-US-AndrewNeural")

                out_dir = ready_dir / slug
                out_dir.mkdir(parents=True, exist_ok=True)
                final_mp4 = out_dir / "video.mp4"
                cover_jpg = out_dir / "cover.jpg"

                used_voiceover = False
                with tempfile.TemporaryDirectory(prefix=f"setnik_vid_{slug}_") as tmp:
                    tmp_path = Path(tmp)
                    segment_paths: list[Path] = []

                    for idx, scene in enumerate(scenes):
                        png_path = tmp_path / f"scene_{idx:02d}.png"
                        html_str = build_video_scene_html(
                            scene=scene,
                            scene_idx=idx,
                            total_scenes=len(scenes),
                            post=post,
                            wordmark_uri=wordmark_uri,
                            transparent_bg=use_broll,
                        )
                        page.set_content(html_str, wait_until="load")
                        page.screenshot(path=str(png_path), type="png", omit_background=use_broll)

                        # Save an opaque cover JPEG from scene 0 for GitHub Actions Summary preview
                        if idx == 0:
                            if use_broll:
                                cover_html = build_video_scene_html(
                                    scene=scene,
                                    scene_idx=0,
                                    total_scenes=len(scenes),
                                    post=post,
                                    wordmark_uri=wordmark_uri,
                                    transparent_bg=False,
                                )
                                cover_png = tmp_path / "cover.png"
                                page.set_content(cover_html, wait_until="load")
                                page.screenshot(path=str(cover_png), type="png")
                                src_cover = cover_png
                            else:
                                src_cover = png_path
                            with Image.open(src_cover) as img:
                                img.convert("RGB").save(cover_jpg, format="JPEG", quality=JPEG_QUALITY, optimize=True)

                        audio_mp3: Path | None = None
                        duration = float(scene.get("duration_sec") or 3.5)
                        if want_voiceover and scene.get("narration"):
                            cand_mp3 = tmp_path / f"scene_{idx:02d}.mp3"
                            tts_dur = synthesize_scene_voiceover(
                                text=str(scene["narration"]),
                                voice=voice,
                                out_mp3=cand_mp3,
                                allow_network=allow_tts_network,
                            )
                            if tts_dur is not None:
                                audio_mp3 = cand_mp3
                                duration = max(duration, tts_dur + 0.35)
                                used_voiceover = True

                        seg_mp4 = tmp_path / f"seg_{idx:02d}.mp4"
                        broll_clip = broll_clips[idx % len(broll_clips)] if use_broll else None
                        _encode_scene_segment(
                            overlay_png=png_path,
                            duration=duration,
                            out_mp4=seg_mp4,
                            broll_clip=broll_clip,
                            audio_mp3=audio_mp3,
                        )
                        segment_paths.append(seg_mp4)

                    concat_file = tmp_path / "concat.txt"
                    concat_file.write_text(
                        "\n".join(f"file '{p.as_posix()}'" for p in segment_paths) + "\n",
                        encoding="utf-8",
                    )
                    _run_ffmpeg(
                        [
                            "-f",
                            "concat",
                            "-safe",
                            "0",
                            "-i",
                            str(concat_file),
                            "-c",
                            "copy",
                            "-movflags",
                            "+faststart",
                            str(final_mp4),
                        ]
                    )

                total_dur = _probe_duration(final_mp4)
                rendered_entries.append(
                    {
                        "slug": slug,
                        "display_name": f"{post.get('metro', 'nyc').upper()} Growth Video · {effective_visual}",
                        "title": post["title"],
                        "description": post["description"],
                        "video_file": "video.mp4",
                        "cover_file": "cover.jpg",
                        "duration_sec": round(total_dur, 1),
                        "audio_mode": "voiceover" if used_voiceover else "music_only",
                        "visual_mode": effective_visual,
                        "headliner_sound_query": post.get("suggested_sound_query", ""),
                        "source_signal": post.get("source_signal", ""),
                        "topic": post.get("topic", ""),
                    }
                )
        finally:
            browser.close()

    print(f"[render_growth_video] Rendered {len(rendered_entries)} video(s) -> {ready_dir}")
    return rendered_entries
