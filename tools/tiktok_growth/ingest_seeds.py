#!/usr/bin/env python3
"""Ingest TikTok Creator Search Insights screenshots from a GitHub Issue/Comment into research_seeds.json.

Extracts image URLs from Markdown (`![...](url)` and `<img src="url">`) plus any
optional plain-text seed lines, calls Gemini Vision to extract structured search
topics, deduplicates against research_seeds.json, and writes a Markdown reply.

Usage:
    python3 tools/tiktok_growth/ingest_seeds.py \
      --body-file /tmp/comment.md \
      --source-url "https://github.com/setnikapp/setnikapp.github.io/issues/1#issuecomment-123" \
      --reply-out /tmp/reply.md
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

import httpx

REPO_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_SEEDS_PATH = REPO_ROOT / "tools" / "tiktok_growth" / "research_seeds.json"

if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from tools.tiktok_growth.gemini_client import GeminiClient  # noqa: E402

MD_IMAGE_RE = re.compile(r"!\[[^\]]*\]\((https?://[^)\s]+)\)")
HTML_IMG_RE = re.compile(r'<img\b[^>]*\bsrc=["\'](https?://[^"\']+)["\']', flags=re.IGNORECASE)
ALLOWED_IMAGE_HOSTS = {
    "github.com",
    "user-images.githubusercontent.com",
    "private-user-images.githubusercontent.com",
    "raw.githubusercontent.com",
    "objects.githubusercontent.com",
}
ALLOWED_MIME_TYPES = {"image/png", "image/jpeg", "image/webp", "image/gif"}
MAX_IMAGES_PER_COMMENT = 8
MAX_IMAGE_BYTES = 12 * 1024 * 1024

VISION_SYSTEM_INSTRUCTION = (
    "You extract search topics from TikTok Creator Search Insights screenshots "
    "for Setnik, a live-music and concert discovery app focused on NYC and LA. "
    "Return strictly valid JSON."
)

VISION_PROMPT = """Inspect the attached screenshot(s) from TikTok Creator Search Insights (or notes).
Extract every visible search query / topic relevant to live music, concerts, raves, clubs, indie/rock/punk/electronic scenes, nightlife, or city weekend plans.

Return a JSON object with this exact shape:
{
  "seeds": [
    {
      "query": "exact search term or topic phrase",
      "metro": "nyc" | "la" | "both",
      "category": "search_gap" | "trending_search" | "venue_guide" | "genre_trend" | "general",
      "signal": "brief note of any visible metric, e.g. 'Content gap', '+240% search growth', or 'High search volume'"
    }
  ]
}

Rules:
- Keep queries concise and faithful to the screenshot text.
- If a query mentions NYC/Brooklyn/Manhattan/Bushwick, set metro="nyc".
- If a query mentions LA/Los Angeles/Silver Lake/Echo Park/Hollywood, set metro="la".
- Otherwise set metro="both".
- Ignore UI chrome (battery, clock, navigation tabs, 'Creator Search Insights' header).
- If no relevant music/nightlife topics appear, return {"seeds": []}.
"""


def extract_image_urls(markdown_body: str) -> list[str]:
    """Extract unique HTTP(S) image URLs from GitHub issue/comment Markdown."""
    urls: list[str] = []
    seen: set[str] = set()
    for pattern in (MD_IMAGE_RE, HTML_IMG_RE):
        for match in pattern.finditer(markdown_body or ""):
            url = match.group(1).strip()
            if url and url not in seen:
                seen.add(url)
                urls.append(url)
    return urls[:MAX_IMAGES_PER_COMMENT]


def extract_manual_text_seeds(markdown_body: str, has_images: bool = False) -> list[str]:
    """Extract optional plain-text seed lines (ignoring image tags, headings, and intro lines).

    When screenshots are attached, only explicit bullet items (- / * / •) are treated
    as additional manual seeds so conversational intros aren't ingested as queries.
    """
    cleaned = MD_IMAGE_RE.sub("", markdown_body or "")
    cleaned = re.sub(r"<[^>]+>", "", cleaned)
    lines: list[str] = []
    for raw in cleaned.splitlines():
        stripped = raw.strip()
        if not stripped or stripped.startswith("#") or stripped.endswith(":"):
            continue
        is_bullet = bool(re.match(r"^[-*•]\s+", stripped))
        if has_images and not is_bullet:
            continue
        line = re.sub(r"^[-*•]\s+", "", stripped).strip()
        if len(line) < 4 or line.startswith("http://") or line.startswith("https://"):
            continue
        lines.append(line)
    return lines[:15]


def _infer_mime_type(url: str, content_type: str | None) -> str:
    if content_type:
        base = content_type.split(";")[0].strip().lower()
        if base in ALLOWED_MIME_TYPES:
            return base
    lower = urlparse(url).path.lower()
    if lower.endswith(".jpg") or lower.endswith(".jpeg"):
        return "image/jpeg"
    if lower.endswith(".webp"):
        return "image/webp"
    return "image/png"


def download_image(
    url: str,
    github_token: str | None = None,
    http_client: httpx.Client | None = None,
    allow_any_host: bool = False,
) -> tuple[bytes, str]:
    """Download an image attachment safely with optional GitHub auth for GitHub hosts."""
    parsed = urlparse(url)
    host = (parsed.hostname or "").lower()
    if parsed.scheme not in {"http", "https"}:
        raise ValueError(f"Unsupported image URL scheme: {url}")
    if not allow_any_host and host not in ALLOWED_IMAGE_HOSTS:
        raise ValueError(f"Disallowed image host '{host}' in URL: {url}")

    headers: dict[str, str] = {"User-Agent": "SetnikGrowthSeedIngest/1.0"}
    if github_token and host in {"github.com", "private-user-images.githubusercontent.com"}:
        headers["Authorization"] = f"Bearer {github_token}"

    if http_client is not None:
        resp = http_client.get(url, headers=headers, follow_redirects=True)
    else:
        with httpx.Client(timeout=30.0, follow_redirects=True) as client:
            resp = client.get(url, headers=headers)

    if resp.status_code >= 400:
        raise RuntimeError(f"Failed to download image ({resp.status_code}): {url}")
    content = resp.content
    if not content or len(content) > MAX_IMAGE_BYTES:
        raise ValueError(f"Image size out of bounds ({len(content)} bytes): {url}")
    mime = _infer_mime_type(url, resp.headers.get("content-type"))
    return optimize_screenshot_for_vision(content, mime)


def optimize_screenshot_for_vision(
    img_bytes: bytes,
    mime_type: str,
    max_dim: int = 1280,
) -> tuple[bytes, str]:
    """Downscale large phone screenshots to a compact JPEG (<=1280px) when Pillow is available."""
    try:
        from io import BytesIO
        from PIL import Image

        with Image.open(BytesIO(img_bytes)) as img:
            w, h = img.size
            if max(w, h) > max_dim or len(img_bytes) > 400_000:
                img.thumbnail((max_dim, max_dim))
                buf = BytesIO()
                img.convert("RGB").save(buf, format="JPEG", quality=82, optimize=True)
                return buf.getvalue(), "image/jpeg"
    except Exception:
        pass
    return img_bytes, mime_type


def normalize_query_key(query: str) -> str:
    """Return canonical lowercase dedupe key for a seed query."""
    return re.sub(r"\s+", " ", query.strip().lower())


def make_seed_id(query: str, metro: str) -> str:
    """Deterministic short ID for a seed entry."""
    digest = hashlib.sha256(f"{normalize_query_key(query)}|{metro}".encode("utf-8")).hexdigest()
    return f"seed-{digest[:10]}"


def infer_metro_from_text(text: str) -> str:
    low = text.lower()
    is_nyc = any(tok in low for tok in ("nyc", "new york", "brooklyn", "manhattan", "bushwick", "queens"))
    is_la = any(tok in low for tok in (" los angeles", "la ", " la", "silver lake", "echo park", "hollywood", "dtla"))
    if is_nyc and not is_la:
        return "nyc"
    if is_la and not is_nyc:
        return "la"
    return "both"


def load_seeds_file(path: Path) -> dict[str, Any]:
    if not path.exists():
        return {"seeds": []}
    data = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(data, dict) or not isinstance(data.get("seeds"), list):
        return {"seeds": []}
    return data


def save_seeds_file(path: Path, data: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


def ingest_from_comment(
    body: str,
    seeds_path: Path = DEFAULT_SEEDS_PATH,
    source_url: str = "",
    gemini_client: GeminiClient | None = None,
    github_token: str | None = None,
    http_client: httpx.Client | None = None,
    allow_any_host: bool = False,
    now_iso: str | None = None,
) -> tuple[list[dict[str, Any]], str]:
    """Extract seeds from screenshots and/or text lines, append to seeds_path, return (added, reply_md)."""
    timestamp = now_iso or datetime.now(timezone.utc).replace(microsecond=0).isoformat()
    image_urls = extract_image_urls(body)
    manual_lines = extract_manual_text_seeds(body, has_images=bool(image_urls))

    extracted: list[dict[str, Any]] = []
    warnings: list[str] = []

    if image_urls:
        downloaded: list[tuple[bytes, str]] = []
        for url in image_urls:
            try:
                downloaded.append(
                    download_image(
                        url,
                        github_token=github_token,
                        http_client=http_client,
                        allow_any_host=allow_any_host,
                    )
                )
            except Exception as exc:
                warnings.append(f"Skipped image `{url}`: {exc}")

        if downloaded:
            client = gemini_client or GeminiClient()
            for idx, img_tuple in enumerate(downloaded, start=1):
                try:
                    vision_res = client.generate_json_from_images(
                        prompt=VISION_PROMPT,
                        images=[img_tuple],
                        system_instruction=VISION_SYSTEM_INSTRUCTION,
                    )
                except Exception as exc:
                    warnings.append(f"Gemini Vision failed on screenshot #{idx}: {exc}")
                    continue
                raw_seeds = vision_res.get("seeds") if isinstance(vision_res, dict) else []
                for item in raw_seeds or []:
                    if not isinstance(item, dict):
                        continue
                    query = str(item.get("query") or "").strip()
                    if len(query) < 3:
                        continue
                    metro = str(item.get("metro") or "").strip().lower()
                    if metro not in {"nyc", "la", "both"}:
                        metro = infer_metro_from_text(query)
                    category = str(item.get("category") or "search_gap").strip().lower()
                    signal = str(item.get("signal") or "Creator Search Insights screenshot").strip()
                    extracted.append(
                        {
                            "query": query,
                            "metro": metro,
                            "category": category,
                            "signal": signal,
                            "source": source_url or "github_issue_screenshot",
                        }
                    )

    for line in manual_lines:
        extracted.append(
            {
                "query": line,
                "metro": infer_metro_from_text(line),
                "category": "manual_seed",
                "signal": "Direct text seed",
                "source": source_url or "github_issue_text",
            }
        )

    store = load_seeds_file(seeds_path)
    existing_keys = {
        normalize_query_key(str(s.get("query") or ""))
        for s in store["seeds"]
        if isinstance(s, dict)
    }

    added: list[dict[str, Any]] = []
    skipped_dupes = 0
    for item in extracted:
        key = normalize_query_key(item["query"])
        if key in existing_keys:
            skipped_dupes += 1
            continue
        existing_keys.add(key)
        record = {
            "id": make_seed_id(item["query"], item["metro"]),
            "query": item["query"],
            "metro": item["metro"],
            "category": item["category"],
            "signal": item["signal"],
            "source": item["source"],
            "added_at": timestamp,
            "consumed_at": None,
        }
        store["seeds"].append(record)
        added.append(record)

    if added:
        save_seeds_file(seeds_path, store)

    reply_lines: list[str] = []
    if added:
        reply_lines.append(f"Added **{len(added)}** new research seed(s) to `tools/tiktok_growth/research_seeds.json`:")
        reply_lines.append("")
        reply_lines.append("| Query | Metro | Category | Signal |")
        reply_lines.append("| --- | --- | --- | --- |")
        for s in added:
            reply_lines.append(
                f"| `{s['query']}` | `{s['metro']}` | `{s['category']}` | {s['signal']} |"
            )
    else:
        reply_lines.append("No new research seeds were added from this comment.")

    if skipped_dupes:
        reply_lines.append("")
        reply_lines.append(f"_Skipped {skipped_dupes} duplicate seed(s) already in the queue._")
    if warnings:
        reply_lines.append("")
        reply_lines.append("Warnings:")
        for w in warnings:
            reply_lines.append(f"- {w}")

    return added, "\n".join(reply_lines).strip() + "\n"


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Extract Creator Search Insights seeds from GitHub issue/comment screenshots."
    )
    parser.add_argument("--body-file", required=True, help="Path to file containing issue/comment Markdown body")
    parser.add_argument("--seeds-path", default=str(DEFAULT_SEEDS_PATH), help="Path to research_seeds.json")
    parser.add_argument("--source-url", default="", help="GitHub issue or comment URL")
    parser.add_argument("--reply-out", default="", help="Optional path to write Markdown reply comment")
    args = parser.parse_args(argv)

    body = Path(args.body_file).read_text(encoding="utf-8")
    github_token = os.environ.get("GITHUB_TOKEN", "").strip() or None
    added, reply_md = ingest_from_comment(
        body=body,
        seeds_path=Path(args.seeds_path).resolve(),
        source_url=args.source_url,
        github_token=github_token,
    )
    if args.reply_out:
        out_path = Path(args.reply_out).resolve()
        out_path.parent.mkdir(parents=True, exist_ok=True)
        out_path.write_text(reply_md, encoding="utf-8")
    print(f"[ingest_seeds] Added {len(added)} new seed(s).")
    return 0


if __name__ == "__main__":
    sys.exit(main())
