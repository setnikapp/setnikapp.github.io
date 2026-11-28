#!/usr/bin/env python3
"""Unit and end-to-end tests for Setnik's TikTok Growth Pipeline (NYC & LA)."""

from __future__ import annotations

import json
import os
import re
import subprocess
import tempfile
import unittest
from pathlib import Path
from typing import Any

import httpx
import yaml
from PIL import Image

REPO_ROOT = Path(__file__).resolve().parents[3]

from tools.tiktok_carousels.publish_tiktok_drafts import (
    TIKTOK_CONTENT_INIT_URL,
    TIKTOK_TOKEN_URL,
    TIKTOK_VIDEO_INBOX_INIT_URL,
    build_video_inbox_upload_payload,
    publish_pipeline,
)
from tools.tiktok_growth.content_agent import (
    strip_ai_cliches,
    validate_and_sanitize_post,
)
from tools.tiktok_growth.gemini_client import GeminiClient, parse_json_response
from tools.tiktok_growth.ingest_seeds import (
    extract_image_urls,
    ingest_from_comment,
)
from tools.tiktok_growth.run_growth_pipeline import run_growth_pipeline

SHA_PIN_RE = re.compile(r"^[^@]+@[0-9a-f]{40}$")


class TestGeminiClientAndSeedIngest(unittest.TestCase):
    def test_parse_json_response_strips_markdown_fences(self) -> None:
        raw = '```json\n{"seeds": [{"query": "nyc indie shows"}]}\n```'
        parsed = parse_json_response(raw)
        self.assertEqual(parsed["seeds"][0]["query"], "nyc indie shows")

    def test_gemini_client_retries_429_and_parses_json(self) -> None:
        attempts = {"n": 0}

        def handler(request: httpx.Request) -> httpx.Response:
            attempts["n"] += 1
            if attempts["n"] == 1:
                return httpx.Response(429, text="rate limited")
            return httpx.Response(
                200,
                json={"candidates": [{"content": {"parts": [{"text": '{"ok": true}'}]}}]},
            )

        client = GeminiClient(
            api_key="test-key",
            http_client=httpx.Client(transport=httpx.MockTransport(handler)),
            sleep_fn=lambda _: None,
        )
        res = client.generate_json("hello")
        self.assertEqual(res, {"ok": True})
        self.assertEqual(attempts["n"], 2)

    def test_ingest_seeds_from_markdown_screenshots_and_dedupes(self) -> None:
        md = (
            "Here are this week's Creator Search Insights:\n"
            "![insights](https://user-images.githubusercontent.com/1/shot1.png)\n"
            '<img width="400" src="https://github.com/user-attachments/assets/abc-123" />\n'
            "- underground techno la\n"
        )
        urls = extract_image_urls(md)
        self.assertEqual(len(urls), 2)

        def img_handler(request: httpx.Request) -> httpx.Response:
            return httpx.Response(200, content=b"\x89PNG\r\n\x1a\nfake", headers={"content-type": "image/png"})

        def gemini_handler(request: httpx.Request) -> httpx.Response:
            payload = {
                "seeds": [
                    {
                        "query": "best small concert venues brooklyn",
                        "metro": "nyc",
                        "category": "search_gap",
                        "signal": "Content gap +180%",
                    },
                    {
                        "query": "cheap concerts los angeles this weekend",
                        "metro": "la",
                        "category": "trending_search",
                        "signal": "+120% search growth",
                    },
                ]
            }
            return httpx.Response(
                200,
                json={"candidates": [{"content": {"parts": [{"text": json.dumps(payload)}]}}]},
            )

        with tempfile.TemporaryDirectory() as tmp:
            seeds_path = Path(tmp) / "research_seeds.json"
            g_client = GeminiClient(
                api_key="test-key",
                http_client=httpx.Client(transport=httpx.MockTransport(gemini_handler)),
                sleep_fn=lambda _: None,
            )
            http_client = httpx.Client(transport=httpx.MockTransport(img_handler))

            added, reply = ingest_from_comment(
                body=md,
                seeds_path=seeds_path,
                source_url="https://github.com/setnikapp/setnikapp.github.io/issues/1#issuecomment-1",
                gemini_client=g_client,
                http_client=http_client,
            )
            self.assertEqual(len(added), 3)
            self.assertIn("best small concert venues brooklyn", reply)
            self.assertIn("underground techno la", reply)

            # Re-running same comment must deduplicate all 3
            added_again, reply_again = ingest_from_comment(
                body=md,
                seeds_path=seeds_path,
                gemini_client=g_client,
                http_client=http_client,
            )
            self.assertEqual(len(added_again), 0)
            self.assertIn("Skipped 5 duplicate", reply_again)


class TestBrandCheckAndVideoPayload(unittest.TestCase):
    def test_strip_cliches_and_ground_hallucinated_show(self) -> None:
        self.assertEqual(strip_ai_cliches("This app is a game-changer to elevate your night"), "This app is a must-have to upgrade your night")
        inventory = {
            "metro": "nyc",
            "shows": [
                {
                    "headliner": "Model/Actriz",
                    "venue": "Market Hotel",
                    "neighborhood": "Bushwick",
                    "weekday": "Fri",
                    "short_date": "Nov 30",
                    "time": "8:00 PM",
                    "price_text": "$20",
                    "genres": ["Post-Punk"],
                }
            ],
        }
        brief = {"slug": "nyc-test", "metro": "nyc", "format": "carousel", "topic": "NYC venues", "hook": "A game-changer guide"}
        raw_post = {
            "format": "carousel",
            "title": "A" * 120,
            "caption": "Dive into NYC live music.",
            "hashtags": ["#nyc", "#brooklyn", "#indie", "#rock", "#live", "#extra1", "#extra2"],
            "slides": [
                {"role": "cover", "headline": "Cover", "body": "Body"},
                {"role": "show", "headline": "Fake Band", "show_ref": "Totally Fake Band"},
            ],
        }
        sanitized = validate_and_sanitize_post(raw_post, brief, inventory)
        self.assertLessEqual(len(sanitized["title"]), 90)
        self.assertEqual(len(sanitized["hashtags"]), 5)
        self.assertEqual(sanitized["slides"][1]["grounded_show"]["headliner"], "Model/Actriz")
        self.assertTrue(any("replaced unverified show" in n for n in sanitized["brand_check_notes"]))

    def test_video_inbox_upload_payload_single_and_multi_chunk(self) -> None:
        small = build_video_inbox_upload_payload(2_500_000)
        self.assertEqual(small["source_info"]["source"], "FILE_UPLOAD")
        self.assertEqual(small["source_info"]["total_chunk_count"], 1)
        self.assertEqual(small["source_info"]["chunk_size"], 2_500_000)

        large = build_video_inbox_upload_payload(75_000_000)
        self.assertGreater(large["source_info"]["total_chunk_count"], 1)


class TestEndToEndGrowthPipelineAndWorkflows(unittest.TestCase):
    def test_e2e_mock_growth_pipeline_carousels_video_and_publish(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            tmp_path = Path(tmp)
            ready_dir = tmp_path / "ready"
            work_dir = tmp_path / "work"
            seeds_path = tmp_path / "research_seeds.json"
            log_path = tmp_path / "content_log.json"
            broll_dir = tmp_path / "broll"
            broll_dir.mkdir()

            # Create a tiny synthetic 2-second vertical B-roll clip to exercise broll_overlay mode
            broll_mp4 = broll_dir / "swipe_demo.mp4"
            subprocess.run(
                [
                    "ffmpeg",
                    "-y",
                    "-hide_banner",
                    "-loglevel",
                    "error",
                    "-f",
                    "lavfi",
                    "-i",
                    "color=c=0x171416:s=540x960:d=2:r=30",
                    "-c:v",
                    "libx264",
                    "-pix_fmt",
                    "yuv420p",
                    str(broll_mp4),
                ],
                check=True,
            )

            seeds_path.write_text(
                json.dumps(
                    {
                        "seeds": [
                            {
                                "id": "seed-nyc-001",
                                "query": "underground shows brooklyn this weekend",
                                "metro": "nyc",
                                "category": "search_gap",
                                "signal": "Content gap",
                                "source": "test",
                                "added_at": "2026-11-28T00:00:00+00:00",
                                "consumed_at": None,
                            }
                        ]
                    }
                ),
                encoding="utf-8",
            )

            manifest_path = run_growth_pipeline(
                metro="nyc",
                run_date="2026-11-30",
                ready_dir=ready_dir,
                work_dir=work_dir,
                seeds_path=seeds_path,
                log_path=log_path,
                broll_dir=broll_dir,
                max_carousels=1,
                max_videos=1,
                mock=True,
                dry_run=False,
                allow_tts_network=False,
            )
            self.assertTrue(manifest_path.is_file())
            manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
            self.assertEqual(len(manifest["carousels"]), 1)
            self.assertEqual(len(manifest["videos"]), 1)

            # Verify carousel JPEG dimensions
            car = manifest["carousels"][0]
            first_jpg = ready_dir / car["slug"] / car["slides"][0]
            with Image.open(first_jpg) as img:
                self.assertEqual(img.size, (1080, 1920))

            # Verify video MP4 & cover JPEG exist and used broll_overlay
            vid = manifest["videos"][0]
            self.assertEqual(vid["visual_mode"], "broll_overlay")
            mp4_path = ready_dir / vid["slug"] / vid["video_file"]
            self.assertTrue(mp4_path.is_file())
            self.assertGreater(mp4_path.stat().st_size, 10_000)

            # Verify seed was marked consumed and content_log was updated
            seeds_after = json.loads(seeds_path.read_text(encoding="utf-8"))
            self.assertIsNotNone(seeds_after["seeds"][0]["consumed_at"])
            log_after = json.loads(log_path.read_text(encoding="utf-8"))
            self.assertEqual(len(log_after["entries"]), 2)

            # Verify mocked live publish (both photo PULL_FROM_URL and video FILE_UPLOAD)
            upload_calls: list[str] = []

            def tiktok_handler(request: httpx.Request) -> httpx.Response:
                url = str(request.url)
                if url == TIKTOK_TOKEN_URL:
                    return httpx.Response(200, json={"access_token": "tok_live", "refresh_token": "rot_tok"})
                if url == TIKTOK_CONTENT_INIT_URL:
                    upload_calls.append("photo")
                    return httpx.Response(200, json={"data": {"publish_id": "p_photo_1"}, "error": {"code": "ok"}})
                if url == TIKTOK_VIDEO_INBOX_INIT_URL:
                    upload_calls.append("video_init")
                    return httpx.Response(
                        200,
                        json={
                            "data": {"publish_id": "v_inbox_1", "upload_url": "https://upload.tiktok.test/bin"},
                            "error": {"code": "ok"},
                        },
                    )
                if url == "https://upload.tiktok.test/bin" and request.method == "PUT":
                    upload_calls.append("video_put")
                    return httpx.Response(201)
                return httpx.Response(200)

            old_env = {k: os.environ.get(k) for k in ("TIKTOK_CLIENT_KEY", "TIKTOK_CLIENT_SECRET", "TIKTOK_REFRESH_TOKEN")}
            try:
                os.environ["TIKTOK_CLIENT_KEY"] = "ck"
                os.environ["TIKTOK_CLIENT_SECRET"] = "cs"
                os.environ["TIKTOK_REFRESH_TOKEN"] = "rt"
                token_out = tmp_path / "rotated.txt"
                summary_path = publish_pipeline(
                    ready_dir=ready_dir,
                    pages_folder="2026-11-30",
                    dry_run=False,
                    token_out=token_out,
                    skip_url_poll=True,
                    http_client=httpx.Client(transport=httpx.MockTransport(tiktok_handler)),
                )
            finally:
                for k, v in old_env.items():
                    if v is None:
                        os.environ.pop(k, None)
                    else:
                        os.environ[k] = v

            self.assertEqual(upload_calls, ["photo", "video_init", "video_put"])
            self.assertEqual(token_out.read_text(encoding="utf-8").strip(), "rot_tok")
            summary_md = summary_path.read_text(encoding="utf-8")
            self.assertIn("p_photo_1", summary_md)
            self.assertIn("v_inbox_1", summary_md)

    def test_growth_workflows_valid_yaml_and_sha_pinned(self) -> None:
        for wf_name in ("tiktok-growth-pipeline.yml", "ingest-research-seeds.yml"):
            wf_path = REPO_ROOT / ".github" / "workflows" / wf_name
            self.assertTrue(wf_path.is_file(), f"Missing workflow {wf_name}")
            doc = yaml.safe_load(wf_path.read_text(encoding="utf-8"))
            self.assertIsInstance(doc, dict)
            for job in (doc.get("jobs") or {}).values():
                for step in job.get("steps") or []:
                    uses = step.get("uses")
                    if uses:
                        self.assertRegex(uses, SHA_PIN_RE, f"Action not SHA-pinned in {wf_name}: {uses}")


if __name__ == "__main__":
    unittest.main()
