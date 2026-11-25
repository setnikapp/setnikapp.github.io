#!/usr/bin/env python3
"""Publish rendered Setnik photo carousels as drafts to TikTok Creator Inbox.

Polls live GitHub Pages URLs until every JPEG returns HTTP 200 with zero
redirects, refreshes & rotates TIKTOK_REFRESH_TOKEN, uploads up to 5
MEDIA_UPLOAD + PULL_FROM_URL photo drafts, and writes job_summary.md for
$GITHUB_STEP_SUMMARY.

Usage:
    python3 tools/tiktok_carousels/publish_tiktok_drafts.py \
      --date 2026-11-26 \
      --pages-folder dry-run-2026-11-26 \
      --dry-run
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
import time
from pathlib import Path
from typing import Any

import httpx
from PIL import Image

REPO_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_BASE_URL = "https://setnikapp.github.io"
TIKTOK_TOKEN_URL = "https://open.tiktokapis.com/v2/oauth/token/"
TIKTOK_CONTENT_INIT_URL = "https://open.tiktokapis.com/v2/post/publish/content/init/"

MAX_DRAFTS_PER_RUN = 5
MAX_SLIDE_WIDTH = 1080
MAX_SLIDE_HEIGHT = 1920
MAX_JPEG_BYTES = 20 * 1024 * 1024
MAX_TITLE_UTF16 = 90
MAX_DESC_UTF16 = 4000

PAGES_FOLDER_RE = re.compile(r"^(?:dry-run-)?\d{4}-\d{2}-\d{2}$")
GENRE_SLUG_RE = re.compile(r"^[a-z0-9][a-z0-9_-]*$")
FILENAME_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]*\.jpg$")

FORBIDDEN_DIRECT_POST_KEYS: frozenset[str] = frozenset(
    {
        "privacy_level",
        "auto_add_music",
        "disable_comment",
        "disable_duet",
        "disable_stitch",
        "brand_content_toggle",
        "brand_organic_toggle",
        "video_cover_timestamp_ms",
        "is_aigc",
    }
)

TIKTOK_ERROR_DIAGNOSTICS: dict[str, str] = {
    "url_ownership_unverified": (
        "TikTok could not verify ownership of https://setnikapp.github.io/carousels/. "
        "Verify the URL prefix in TikTok Developer Portal -> Manage Apps -> Content Posting API -> URL properties."
    ),
    "spam_risk_too_many_pending_share": (
        "TikTok's 5-pending-drafts-per-24-hour Creator Inbox limit was reached. "
        "Open the TikTok mobile app, publish or delete pending inbox drafts, then retry."
    ),
    "app_version_check_failed": (
        "TikTok rejected the draft due to app version / audit state. "
        "Confirm the Content Posting API product is enabled and target account is added as a sandbox/live creator."
    ),
    "access_token_invalid": (
        "The TikTok OAuth access_token is invalid or expired. "
        "Re-run oauth_bootstrap.py and update the TIKTOK_REFRESH_TOKEN GitHub Secret."
    ),
    "scope_not_authorized": (
        "The token is missing the required 'video.upload' scope. "
        "Re-authorize via oauth_bootstrap.py with scope=video.upload."
    ),
}


def utf16_len(text: str) -> int:
    """Return UTF-16 code unit count."""
    return len(text.encode("utf-16-le")) // 2


def build_carousel_slide_url(
    pages_folder: str,
    genre_slug: str,
    filename: str,
    base_url: str = DEFAULT_BASE_URL,
) -> str:
    """Build a verified, path-traversal-safe GitHub Pages JPEG URL."""
    if not PAGES_FOLDER_RE.match(pages_folder):
        raise ValueError(f"Unsafe pages_folder: {pages_folder!r}")
    if not GENRE_SLUG_RE.match(genre_slug):
        raise ValueError(f"Unsafe genre_slug: {genre_slug!r}")
    if not FILENAME_RE.match(filename) or ".." in filename:
        raise ValueError(f"Unsafe filename: {filename!r}")
    clean_base = base_url.rstrip("/")
    return f"{clean_base}/carousels/{pages_folder}/{genre_slug}/{filename}"


def validate_local_jpeg(path: Path) -> None:
    """Validate that a local file is a JPEG <= 1080x1920 and < 20 MB."""
    if not path.is_file():
        raise FileNotFoundError(f"Missing slide JPEG: {path}")
    size = path.stat().st_size
    if size <= 0 or size >= MAX_JPEG_BYTES:
        raise ValueError(f"Slide {path} size {size} bytes is out of bounds (< 20 MB required)")
    with Image.open(path) as img:
        if img.format != "JPEG":
            raise ValueError(f"Slide {path} must be JPEG, got {img.format}")
        w, h = img.size
        if w > MAX_SLIDE_WIDTH or h > MAX_SLIDE_HEIGHT:
            raise ValueError(
                f"Slide {path} dimensions {w}x{h} exceed {MAX_SLIDE_WIDTH}x{MAX_SLIDE_HEIGHT}"
            )


def build_media_upload_payload(
    title: str,
    description: str,
    photo_urls: list[str],
    photo_cover_index: int = 0,
) -> dict[str, Any]:
    """Build and strictly validate a TikTok MEDIA_UPLOAD + PULL_FROM_URL photo payload."""
    if not photo_urls:
        raise ValueError("photo_urls must contain at least one image URL")
    if not (0 <= photo_cover_index < len(photo_urls)):
        raise ValueError("photo_cover_index out of range")
    if utf16_len(title) > MAX_TITLE_UTF16:
        raise ValueError(f"TikTok title exceeds {MAX_TITLE_UTF16} UTF-16 code units")
    if utf16_len(description) > MAX_DESC_UTF16:
        raise ValueError(f"TikTok description exceeds {MAX_DESC_UTF16} UTF-16 code units")

    payload: dict[str, Any] = {
        "post_info": {
            "title": title,
            "description": description,
        },
        "source_info": {
            "source": "PULL_FROM_URL",
            "photo_cover_index": photo_cover_index,
            "photo_images": list(photo_urls),
        },
        "post_mode": "MEDIA_UPLOAD",
        "media_type": "PHOTO",
    }
    validate_media_upload_payload(payload)
    return payload


def validate_media_upload_payload(payload: dict[str, Any]) -> None:
    """Strictly verify payload conforms to MEDIA_UPLOAD schema with zero Direct Post-only keys."""
    if payload.get("post_mode") != "MEDIA_UPLOAD":
        raise ValueError(f"Expected post_mode='MEDIA_UPLOAD', got {payload.get('post_mode')!r}")
    if payload.get("media_type") != "PHOTO":
        raise ValueError(f"Expected media_type='PHOTO', got {payload.get('media_type')!r}")

    post_info = payload.get("post_info")
    if not isinstance(post_info, dict):
        raise ValueError("post_info must be a dict")
    forbidden_found = set(post_info.keys()) & FORBIDDEN_DIRECT_POST_KEYS
    if forbidden_found:
        raise ValueError(
            f"Forbidden Direct Post keys found in MEDIA_UPLOAD post_info: {sorted(forbidden_found)}"
        )
    allowed_post_info = {"title", "description"}
    extra_keys = set(post_info.keys()) - allowed_post_info
    if extra_keys:
        raise ValueError(f"Unexpected keys in MEDIA_UPLOAD post_info: {sorted(extra_keys)}")

    source_info = payload.get("source_info")
    if not isinstance(source_info, dict):
        raise ValueError("source_info must be a dict")
    if source_info.get("source") != "PULL_FROM_URL":
        raise ValueError(f"Expected source='PULL_FROM_URL', got {source_info.get('source')!r}")
    images = source_info.get("photo_images")
    if not isinstance(images, list) or not images:
        raise ValueError("source_info.photo_images must be a non-empty list")


def diagnose_tiktok_error(error_code: str, message: str = "") -> str:
    """Return actionable diagnostic guidance for known TikTok Content Posting API errors."""
    hint = TIKTOK_ERROR_DIAGNOSTICS.get(error_code)
    if hint:
        return f"[{error_code}] {message} — Action: {hint}".strip()
    return f"[{error_code}] {message}".strip()


def poll_urls_ready(
    urls: list[str],
    timeout_seconds: float = 180.0,
    interval_seconds: float = 10.0,
    http_client: httpx.Client | None = None,
    sleep_fn: Any = time.sleep,
) -> dict[str, int]:
    """Poll all URLs with follow_redirects=False until every URL returns HTTP 200.

    Explicitly rejects 301/302/3xx redirects because TikTok's PULL_FROM_URL
    crawler requires direct HTTP 200 responses on the verified URL prefix.
    """
    if not urls:
        return {}

    deadline = time.monotonic() + timeout_seconds
    statuses: dict[str, int] = {}
    own_client = http_client is None
    client = http_client or httpx.Client(timeout=15.0, follow_redirects=False)

    try:
        while True:
            pending: list[str] = []
            redirected: list[tuple[str, int]] = []
            for url in urls:
                if statuses.get(url) == 200:
                    continue
                try:
                    resp = client.head(url, follow_redirects=False)
                    if resp.status_code == 405:
                        resp = client.get(url, follow_redirects=False)
                    code = resp.status_code
                except httpx.HTTPError:
                    code = 0

                statuses[url] = code
                if 300 <= code < 400:
                    redirected.append((url, code))
                elif code != 200:
                    pending.append(url)

            if redirected:
                detail = ", ".join(f"{u} (HTTP {c})" for u, c in redirected[:3])
                raise RuntimeError(
                    f"Slide URL returned HTTP redirect instead of direct 200: {detail}"
                )
            if not pending:
                return statuses

            now = time.monotonic()
            if now >= deadline:
                detail = ", ".join(f"{u} (HTTP {statuses.get(u, 0)})" for u in pending[:5])
                raise TimeoutError(
                    f"Timed out after {timeout_seconds:.0f}s waiting for {len(pending)} slide URL(s) to return HTTP 200: {detail}"
                )
            sleep_fn(min(interval_seconds, max(0.0, deadline - now)))
    finally:
        if own_client:
            client.close()


def write_secret_file_0600(path: Path, secret_value: str) -> None:
    """Write a rotated token file with strict 0600 permissions."""
    path.parent.mkdir(parents=True, exist_ok=True)
    fd = os.open(str(path), os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    try:
        os.write(fd, f"{secret_value.strip()}\n".encode("utf-8"))
    finally:
        os.close(fd)
    os.chmod(path, 0o600)


def refresh_access_token(
    client_key: str,
    client_secret: str,
    refresh_token: str,
    token_out: Path | None = None,
    http_client: httpx.Client | None = None,
) -> tuple[str, str | None]:
    """Refresh TikTok OAuth access_token and persist any rotated refresh_token (0600)."""
    form_data = {
        "client_key": client_key,
        "client_secret": client_secret,
        "grant_type": "refresh_token",
        "refresh_token": refresh_token,
    }
    headers = {"Content-Type": "application/x-www-form-urlencoded"}
    if http_client is not None:
        resp = http_client.post(TIKTOK_TOKEN_URL, data=form_data, headers=headers)
    else:
        with httpx.Client(timeout=30.0) as client:
            resp = client.post(TIKTOK_TOKEN_URL, data=form_data, headers=headers)

    data: dict[str, Any] = resp.json()
    if resp.status_code >= 400 or data.get("error"):
        err_code = str(data.get("error") or f"HTTP_{resp.status_code}")
        err_msg = str(data.get("error_description") or resp.text)
        raise RuntimeError(f"TikTok token refresh failed: {diagnose_tiktok_error(err_code, err_msg)}")

    access_token = str(data.get("access_token") or "").strip()
    if not access_token:
        raise RuntimeError("TikTok token refresh succeeded but returned empty access_token")

    new_refresh = str(data.get("refresh_token") or "").strip() or None
    if new_refresh and token_out is not None:
        write_secret_file_0600(token_out, new_refresh)
    return access_token, new_refresh


def upload_photo_carousel_draft(
    access_token: str,
    payload: dict[str, Any],
    http_client: httpx.Client | None = None,
) -> str:
    """POST a MEDIA_UPLOAD photo carousel draft to TikTok Creator Inbox."""
    validate_media_upload_payload(payload)
    headers = {
        "Authorization": f"Bearer {access_token}",
        "Content-Type": "application/json; charset=UTF-8",
    }
    if http_client is not None:
        resp = http_client.post(TIKTOK_CONTENT_INIT_URL, json=payload, headers=headers)
    else:
        with httpx.Client(timeout=30.0) as client:
            resp = client.post(TIKTOK_CONTENT_INIT_URL, json=payload, headers=headers)

    body: dict[str, Any] = resp.json()
    err = body.get("error") or {}
    err_code = str(err.get("code") or "ok")
    err_msg = str(err.get("message") or "")
    if resp.status_code >= 400 or err_code != "ok":
        raise RuntimeError(f"TikTok draft upload failed: {diagnose_tiktok_error(err_code, err_msg)}")

    publish_id = str((body.get("data") or {}).get("publish_id") or "").strip()
    if not publish_id:
        raise RuntimeError("TikTok draft upload returned ok without publish_id")
    return publish_id


def build_job_summary_markdown(
    manifest: dict[str, Any],
    pages_folder: str,
    results: list[dict[str, Any]],
    dry_run: bool,
    token_rotated: bool,
) -> str:
    """Generate rich Markdown for $GITHUB_STEP_SUMMARY with inline preview images & sound queries."""
    run_date = manifest.get("run_date", "")
    weekend_range = manifest.get("weekend_range", "")
    mode_badge = "DRY RUN" if dry_run else "LIVE DRAFT UPLOAD"

    lines: list[str] = [
        f"## Setnik Weekly TikTok Carousels — {run_date} ({mode_badge})",
        "",
        f"- **Weekend:** {weekend_range}",
        f"- **Pages folder:** `static/carousels/{pages_folder}/`",
        f"- **Carousels processed:** {len(results)}",
        f"- **Refresh token rotated:** {'Yes' if token_rotated else 'No'}",
        "",
        "| Genre | Slides | Headliner Song to Pick in TikTok | Status / Publish ID |",
        "| --- | ---: | --- | --- |",
    ]
    for item in results:
        sound = item.get("headliner_sound_query") or "—"
        status = item.get("status_label") or "—"
        lines.append(
            f"| **{item['display_name']}** (`{item['slug']}`) | {len(item['slide_urls'])} | `{sound}` | {status} |"
        )

    lines.append("")
    for item in results:
        lines.extend(
            [
                f"### {item['display_name']} — `{item['title']}`",
                "",
                f"- **TikTok Sound Search:** `{item.get('headliner_sound_query') or '—'}`",
                f"- **Status:** {item.get('status_label')}",
                "",
                "<details><summary>Caption & Hashtags</summary>",
                "",
                "```text",
                str(item.get("description", "")),
                "```",
                "",
                "</details>",
                "",
            ]
        )
        for idx, url in enumerate(item["slide_urls"], start=1):
            lines.append(f"![{item['display_name']} Slide {idx}]({url})")
        lines.append("")

    return "\n".join(lines).rstrip() + "\n"


def publish_pipeline(
    ready_dir: Path,
    pages_folder: str,
    dry_run: bool = False,
    poll_timeout: float = 180.0,
    poll_interval: float = 10.0,
    token_out: Path | None = None,
    base_url: str = DEFAULT_BASE_URL,
    skip_url_poll: bool = False,
    http_client: httpx.Client | None = None,
) -> Path:
    """Validate JPEGs, poll live URLs, upload drafts (unless dry-run), and write job_summary.md."""
    manifest_path = ready_dir / "manifest.json"
    manifest: dict[str, Any] = json.loads(manifest_path.read_text(encoding="utf-8"))
    carousels: list[dict[str, Any]] = list(manifest.get("carousels") or [])[:MAX_DRAFTS_PER_RUN]

    # 1. Validate local JPEGs and build slide URLs + strict MEDIA_UPLOAD payloads
    prepared: list[dict[str, Any]] = []
    all_urls: list[str] = []
    for carousel in carousels:
        slug = str(carousel["slug"])
        slides: list[str] = list(carousel.get("slides") or [])
        slide_urls: list[str] = []
        for filename in slides:
            local_jpg = ready_dir / slug / filename
            validate_local_jpeg(local_jpg)
            url = build_carousel_slide_url(pages_folder, slug, filename, base_url=base_url)
            slide_urls.append(url)
            all_urls.append(url)

        payload = build_media_upload_payload(
            title=str(carousel.get("title") or ""),
            description=str(carousel.get("description") or ""),
            photo_urls=slide_urls,
            photo_cover_index=0,
        )
        prepared.append(
            {
                "slug": slug,
                "display_name": str(carousel.get("display_name") or slug.title()),
                "title": payload["post_info"]["title"],
                "description": payload["post_info"]["description"],
                "headliner_sound_query": str(carousel.get("headliner_sound_query") or ""),
                "slide_urls": slide_urls,
                "payload": payload,
            }
        )

    # 2. Live URL readiness poll
    if all_urls and not skip_url_poll:
        poll_urls_ready(
            all_urls,
            timeout_seconds=poll_timeout,
            interval_seconds=poll_interval,
            http_client=http_client,
        )

    # 3. Determine effective dry-run mode (auto-fallback if TikTok secrets are absent)
    client_key = os.environ.get("TIKTOK_CLIENT_KEY", "").strip()
    client_secret = os.environ.get("TIKTOK_CLIENT_SECRET", "").strip()
    refresh_token = os.environ.get("TIKTOK_REFRESH_TOKEN", "").strip()
    has_secrets = bool(client_key and client_secret and refresh_token)
    effective_dry_run = dry_run or not has_secrets
    if not dry_run and not has_secrets:
        print(
            "[publish_tiktok_drafts] TikTok secrets not configured; falling back to --dry-run.",
            file=sys.stderr,
        )

    access_token: str | None = None
    token_rotated = False
    if not effective_dry_run and prepared:
        access_token, new_refresh = refresh_access_token(
            client_key=client_key,
            client_secret=client_secret,
            refresh_token=refresh_token,
            token_out=token_out,
            http_client=http_client,
        )
        token_rotated = bool(new_refresh)

    # 4. Upload up to 5 photo carousel drafts (or record dry-run status)
    results: list[dict[str, Any]] = []
    errors: list[str] = []
    for item in prepared:
        entry = dict(item)
        if effective_dry_run:
            entry["publish_id"] = None
            entry["status_label"] = "Dry run (validated, not uploaded)"
        else:
            assert access_token is not None
            try:
                publish_id = upload_photo_carousel_draft(
                    access_token=access_token,
                    payload=item["payload"],
                    http_client=http_client,
                )
                entry["publish_id"] = publish_id
                entry["status_label"] = f"Uploaded (`{publish_id}`)"
            except Exception as exc:
                entry["publish_id"] = None
                entry["status_label"] = f"Failed: {exc}"
                errors.append(f"{item['slug']}: {exc}")
        results.append(entry)

    # 5. Emit job_summary.md
    summary_md = build_job_summary_markdown(
        manifest=manifest,
        pages_folder=pages_folder,
        results=results,
        dry_run=effective_dry_run,
        token_rotated=token_rotated,
    )
    summary_path = ready_dir / "job_summary.md"
    summary_path.write_text(summary_md, encoding="utf-8")
    print(f"[publish_tiktok_drafts] Summary written to {summary_path}")

    if errors:
        raise RuntimeError("One or more TikTok draft uploads failed:\n" + "\n".join(errors))
    return summary_path


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Validate, poll, and publish Setnik TikTok photo carousel drafts."
    )
    parser.add_argument("--date", required=True, help="Run date YYYY-MM-DD")
    parser.add_argument(
        "--pages-folder",
        required=True,
        help="Pages subfolder under static/carousels/ (YYYY-MM-DD or dry-run-YYYY-MM-DD)",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Validate JPEGs, payloads, and live URLs without calling TikTok API",
    )
    parser.add_argument(
        "--poll-timeout",
        type=float,
        default=180.0,
        help="Seconds to poll GitHub Pages URLs for HTTP 200 (default: 180)",
    )
    parser.add_argument(
        "--poll-interval",
        type=float,
        default=10.0,
        help="Seconds between poll attempts (default: 10)",
    )
    parser.add_argument(
        "--token-out",
        default=os.environ.get("TIKTOK_NEW_REFRESH_TOKEN_FILE", ""),
        help="File path to write rotated TIKTOK_REFRESH_TOKEN (0600)",
    )
    parser.add_argument(
        "--ready-dir",
        default=None,
        help="Override ready directory (defaults to build/carousel_ready/<date>)",
    )
    parser.add_argument(
        "--base-url",
        default=DEFAULT_BASE_URL,
        help=f"GitHub Pages base URL (default: {DEFAULT_BASE_URL})",
    )
    parser.add_argument(
        "--skip-url-poll",
        action="store_true",
        help="Skip live HTTP 200 URL readiness polling (for offline local dry-runs)",
    )
    args = parser.parse_args(argv)

    ready_dir = (
        Path(args.ready_dir).resolve()
        if args.ready_dir
        else (REPO_ROOT / "build" / "carousel_ready" / args.date)
    )
    token_out = Path(args.token_out).resolve() if args.token_out else None

    publish_pipeline(
        ready_dir=ready_dir,
        pages_folder=args.pages_folder,
        dry_run=args.dry_run,
        poll_timeout=args.poll_timeout,
        poll_interval=args.poll_interval,
        token_out=token_out,
        base_url=args.base_url,
        skip_url_poll=args.skip_url_poll,
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
