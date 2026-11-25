#!/usr/bin/env python3
"""Sync rendered carousel JPEGs into static/carousels/<pages_folder>/<genre>/ and prune >30d folders.

Usage:
    python3 tools/tiktok_carousels/sync_pages_repo.py \
      --date 2026-11-26 \
      --pages-folder 2026-11-26
"""

from __future__ import annotations

import argparse
import re
import shutil
import sys
from datetime import date, timedelta
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
PAGES_FOLDER_RE = re.compile(r"^(?:dry-run-)?(\d{4}-\d{2}-\d{2})$")
SAFE_SEGMENT_RE = re.compile(r"^[a-z0-9][a-z0-9_-]*$")
DEFAULT_RETENTION_DAYS = 30


def parse_pages_folder_date(folder_name: str) -> date | None:
    """Parse the YYYY-MM-DD date embedded in <YYYY-MM-DD> or dry-run-<YYYY-MM-DD>."""
    m = PAGES_FOLDER_RE.match(folder_name)
    if not m:
        return None
    try:
        return date.fromisoformat(m.group(1))
    except ValueError:
        return None


def validate_pages_folder(pages_folder: str) -> str:
    """Validate pages_folder matches YYYY-MM-DD or dry-run-YYYY-MM-DD (prevents path traversal)."""
    if parse_pages_folder_date(pages_folder) is None:
        raise ValueError(
            f"Invalid pages_folder '{pages_folder}': expected YYYY-MM-DD or dry-run-YYYY-MM-DD"
        )
    return pages_folder


def prune_old_carousels(
    carousels_root: Path,
    reference_date: date,
    retention_days: int = DEFAULT_RETENTION_DAYS,
) -> list[str]:
    """Delete <YYYY-MM-DD> or dry-run-<YYYY-MM-DD> folders older than retention_days."""
    if not carousels_root.exists():
        return []
    cutoff = reference_date - timedelta(days=retention_days)
    pruned: list[str] = []
    for entry in sorted(carousels_root.iterdir()):
        if not entry.is_dir():
            continue
        folder_date = parse_pages_folder_date(entry.name)
        if folder_date is not None and folder_date < cutoff:
            shutil.rmtree(entry)
            pruned.append(entry.name)
    return pruned


def sync_carousels(
    ready_dir: Path,
    carousels_root: Path,
    pages_folder: str,
    reference_date: date,
    retention_days: int = DEFAULT_RETENTION_DAYS,
) -> tuple[list[Path], list[str]]:
    """Copy rendered genre JPEGs into static/carousels/<pages_folder>/<genre>/ and prune old runs."""
    validate_pages_folder(pages_folder)
    if not ready_dir.is_dir():
        raise FileNotFoundError(f"Rendered carousel directory not found: {ready_dir}")

    dest_folder = carousels_root / pages_folder
    if dest_folder.exists():
        shutil.rmtree(dest_folder)
    dest_folder.mkdir(parents=True, exist_ok=True)

    copied: list[Path] = []
    for genre_dir in sorted(ready_dir.iterdir()):
        if not genre_dir.is_dir():
            continue
        if not SAFE_SEGMENT_RE.match(genre_dir.name):
            continue
        jpgs = sorted(genre_dir.glob("*.jpg"))
        if not jpgs:
            continue
        dest_genre = dest_folder / genre_dir.name
        dest_genre.mkdir(parents=True, exist_ok=True)
        for src in jpgs:
            dst = dest_genre / src.name
            shutil.copy2(src, dst)
            copied.append(dst)

    pruned = prune_old_carousels(carousels_root, reference_date, retention_days=retention_days)
    return copied, pruned


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Sync rendered carousel JPEGs into static/carousels/<pages_folder>/ and prune >30d folders."
    )
    parser.add_argument("--date", required=True, help="Run date YYYY-MM-DD")
    parser.add_argument(
        "--pages-folder",
        default=None,
        help="Destination folder under static/carousels/ (defaults to --date)",
    )
    parser.add_argument(
        "--ready-dir",
        default=None,
        help="Override source directory (defaults to build/carousel_ready/<date>)",
    )
    parser.add_argument(
        "--carousels-root",
        default=str(REPO_ROOT / "static" / "carousels"),
        help="Target static/carousels root directory",
    )
    parser.add_argument(
        "--retention-days",
        type=int,
        default=DEFAULT_RETENTION_DAYS,
        help="Days to retain old carousel folders (default: 30)",
    )
    args = parser.parse_args(argv)

    ref_date = date.fromisoformat(args.date)
    pages_folder = args.pages_folder or args.date
    ready_dir = Path(args.ready_dir).resolve() if args.ready_dir else (REPO_ROOT / "build" / "carousel_ready" / args.date)
    carousels_root = Path(args.carousels_root).resolve()

    copied, pruned = sync_carousels(
        ready_dir=ready_dir,
        carousels_root=carousels_root,
        pages_folder=pages_folder,
        reference_date=ref_date,
        retention_days=args.retention_days,
    )
    print(
        f"[sync_pages_repo] Copied {len(copied)} JPEGs to {carousels_root / pages_folder}; "
        f"pruned {len(pruned)} expired folder(s): {pruned}"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
