#!/usr/bin/env python3
"""End-to-end orchestrator for the Setnik TikTok Growth Pipeline (NYC & LA).

Runs:
  1. export_metro_shows.mjs -> inventory.json
  2. research_agent.py      -> briefs.json
  3. content_agent.py       -> scripts.json (with brand & fact check)
  4. render_growth_carousels.py + render_growth_video.py -> manifest.json in ready_dir
  5. Updates content_log.json & marks consumed seeds in research_seeds.json (unless --dry-run)

Usage:
    python3 tools/tiktok_growth/run_growth_pipeline.py \
      --metro nyc \
      --date 2026-11-30 \
      --mock \
      --dry-run
"""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

REPO_ROOT = Path(__file__).resolve().parents[2]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from tools.tiktok_growth.content_agent import generate_content_scripts  # noqa: E402
from tools.tiktok_growth.render_growth_carousels import render_growth_carousels  # noqa: E402
from tools.tiktok_growth.render_growth_video import DEFAULT_BROLL_DIR, render_growth_videos  # noqa: E402
from tools.tiktok_growth.research_agent import (  # noqa: E402
    DEFAULT_LOG_PATH,
    DEFAULT_SEEDS_PATH,
    run_research,
)


def mark_seeds_consumed(seeds_path: Path, seed_ids: set[str], timestamp: str) -> int:
    """Mark used Creator Search Insights seeds as consumed in research_seeds.json."""
    if not seed_ids or not seeds_path.exists():
        return 0
    data = json.loads(seeds_path.read_text(encoding="utf-8"))
    seeds = data.get("seeds") if isinstance(data, dict) else []
    count = 0
    for s in seeds or []:
        if isinstance(s, dict) and s.get("id") in seed_ids and not s.get("consumed_at"):
            s["consumed_at"] = timestamp
            count += 1
    if count:
        seeds_path.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    return count


def append_content_log(
    log_path: Path,
    run_date: str,
    metro: str,
    posts: list[dict[str, Any]],
) -> int:
    """Record generated posts in content_log.json for future deduplication & analytics loop."""
    if log_path.exists():
        data = json.loads(log_path.read_text(encoding="utf-8"))
    else:
        data = {"entries": []}
    if not isinstance(data, dict) or not isinstance(data.get("entries"), list):
        data = {"entries": []}

    added = 0
    for p in posts:
        data["entries"].append(
            {
                "date": run_date,
                "metro": metro,
                "slug": p.get("slug", ""),
                "format": p.get("format", ""),
                "template": p.get("template", ""),
                "topic": p.get("topic", ""),
                "hook": p.get("hook", ""),
                "source_signal": p.get("source_signal", ""),
                "audio_mode": p.get("audio_mode", "music_only"),
            }
        )
        added += 1

    # Retain the most recent 200 entries
    data["entries"] = data["entries"][-200:]
    log_path.parent.mkdir(parents=True, exist_ok=True)
    log_path.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    return added


def run_growth_pipeline(
    metro: str,
    run_date: str,
    ready_dir: Path,
    work_dir: Path,
    seeds_path: Path = DEFAULT_SEEDS_PATH,
    log_path: Path = DEFAULT_LOG_PATH,
    broll_dir: Path = DEFAULT_BROLL_DIR,
    max_carousels: int = 2,
    max_videos: int = 1,
    mock: bool = False,
    dry_run: bool = False,
    allow_tts_network: bool = True,
) -> Path:
    """Execute the full Research -> Content -> Render pipeline and return manifest.json path."""
    work_dir.mkdir(parents=True, exist_ok=True)
    ready_dir.mkdir(parents=True, exist_ok=True)

    inventory_path = work_dir / "inventory.json"
    briefs_path = work_dir / "briefs.json"
    scripts_path = work_dir / "scripts.json"

    # 1. Export metro show inventory
    node_cmd = [
        "node",
        str(REPO_ROOT / "tools" / "tiktok_growth" / "export_metro_shows.mjs"),
        "--metro",
        metro,
        "--date",
        run_date,
        "--out",
        str(inventory_path),
    ]
    if mock:
        node_cmd.append("--mock")
    subprocess.run(node_cmd, cwd=str(REPO_ROOT), check=True)

    # 2. Research Agent
    run_research(
        metro=metro,
        run_date=run_date,
        inventory_path=inventory_path,
        out_path=briefs_path,
        seeds_path=seeds_path,
        log_path=log_path,
        max_carousels=max_carousels,
        max_videos=max_videos,
        mock=mock,
    )

    # 3. Content Agent + Brand & Fact Checker
    scripts_doc = generate_content_scripts(
        briefs_path=briefs_path,
        inventory_path=inventory_path,
        out_path=scripts_path,
        mock=mock,
    )
    posts = list(scripts_doc.get("posts") or [])

    # 4. Render carousels + short-form videos
    carousel_entries = render_growth_carousels(posts=posts, ready_dir=ready_dir)
    video_entries = render_growth_videos(
        posts=posts,
        ready_dir=ready_dir,
        broll_dir=broll_dir,
        allow_tts_network=allow_tts_network and not mock,
    )

    manifest: dict[str, Any] = {
        "run_date": run_date,
        "batch": f"growth_{metro}",
        "metro": metro,
        "weekend_range": f"{metro.upper()} Growth ({run_date})",
        "signals_summary": scripts_doc.get("signals_summary", {}),
        "carousels": carousel_entries,
        "videos": video_entries,
    }
    manifest_path = ready_dir / "manifest.json"
    manifest_path.write_text(json.dumps(manifest, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")

    # 5. Persist content_log + mark consumed seeds (skip on dry-run so seeds aren't burned)
    if not dry_run:
        now_iso = datetime.now(timezone.utc).replace(microsecond=0).isoformat()
        used_seed_ids: set[str] = set()
        for p in posts:
            used_seed_ids.update(str(sid) for sid in (p.get("seed_ids") or []) if sid)
        consumed = mark_seeds_consumed(seeds_path, used_seed_ids, now_iso)
        logged = append_content_log(log_path, run_date, metro, posts)
        print(
            f"[run_growth_pipeline] Logged {logged} post(s) to content_log.json; "
            f"marked {consumed} seed(s) consumed."
        )

    print(
        f"[run_growth_pipeline] Ready: {len(carousel_entries)} carousel(s), "
        f"{len(video_entries)} video(s) -> {manifest_path}"
    )
    return manifest_path


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Run Setnik TikTok Growth Pipeline (NYC/LA).")
    parser.add_argument("--metro", choices=["nyc", "la"], required=True)
    parser.add_argument("--date", required=True, help="Run date YYYY-MM-DD")
    parser.add_argument("--ready-dir", default=None, help="Output ready dir (default: build/growth_ready/<date>)")
    parser.add_argument("--work-dir", default=None, help="Intermediate work dir (default: build/growth/<date>/<metro>)")
    parser.add_argument("--max-carousels", type=int, default=2)
    parser.add_argument("--max-videos", type=int, default=1)
    parser.add_argument("--mock", action="store_true", help="Offline mock data + offline briefs/scripts")
    parser.add_argument("--dry-run", action="store_true", help="Do not mutate content_log.json or research_seeds.json")
    parser.add_argument("--no-tts", action="store_true", help="Disable network edge-tts calls")
    args = parser.parse_args(argv)

    ready_dir = (
        Path(args.ready_dir).resolve()
        if args.ready_dir
        else (REPO_ROOT / "build" / "growth_ready" / args.date)
    )
    work_dir = (
        Path(args.work_dir).resolve()
        if args.work_dir
        else (REPO_ROOT / "build" / "growth" / args.date / args.metro)
    )

    run_growth_pipeline(
        metro=args.metro,
        run_date=args.date,
        ready_dir=ready_dir,
        work_dir=work_dir,
        max_carousels=args.max_carousels,
        max_videos=args.max_videos,
        mock=args.mock,
        dry_run=args.dry_run,
        allow_tts_network=not args.no_tts,
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
