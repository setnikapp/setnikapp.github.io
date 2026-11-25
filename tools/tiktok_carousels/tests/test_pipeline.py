"""Comprehensive unit & integration tests for the Setnik weekly TikTok carousel pipeline."""

from __future__ import annotations

import hashlib
import json
import os
import re
import stat
import subprocess
import tempfile
import unittest
from datetime import date
from pathlib import Path
from typing import Any
from unittest.mock import patch

import httpx
import yaml
from PIL import Image

from tools.tiktok_carousels import (
    oauth_bootstrap,
    publish_tiktok_drafts,
    render_carousels,
    sync_pages_repo,
)

REPO_ROOT = Path(__file__).resolve().parents[3]
TOOLS_DIR = REPO_ROOT / "tools" / "tiktok_carousels"
WORKFLOW_PATH = REPO_ROOT / ".github" / "workflows" / "weekly-tiktok-carousels.yml"
CONFIG_PATH = TOOLS_DIR / "genres_config.json"


class TestGenresConfigAndWorkflow(unittest.TestCase):
    def test_genres_config_matches_src_config_mjs(self) -> None:
        cfg = json.loads(CONFIG_PATH.read_text(encoding="utf-8"))
        genres = cfg["genres"]
        self.assertEqual(len(genres), 5, "Must define exactly 5 weekly genres")
        self.assertEqual(cfg["metro_id"], "nyc")
        self.assertEqual(cfg["cards_per_genre"], 4)
        self.assertEqual(cfg["min_cards_per_genre"], 2)

        # Read canonical ALL_GENRES directly from src/config.mjs via node
        proc = subprocess.run(
            [
                "node",
                "--input-type=module",
                "-e",
                "import { ALL_GENRES } from './src/config.mjs'; console.log(JSON.stringify(ALL_GENRES));",
            ],
            cwd=str(REPO_ROOT),
            check=True,
            capture_output=True,
            text=True,
        )
        canonical_genres = set(json.loads(proc.stdout))

        seen_slugs: set[str] = set()
        for g in genres:
            self.assertNotIn(g["slug"], seen_slugs)
            seen_slugs.add(g["slug"])
            self.assertIn(
                g["filter_label"],
                canonical_genres,
                f"Genre filter_label {g['filter_label']!r} not in src/config.mjs ALL_GENRES",
            )
            self.assertLessEqual(len(g["hashtags"]), 5, f"Too many hashtags for {g['slug']}")
            for tag in g["hashtags"]:
                self.assertTrue(tag.startswith("#"), f"Hashtag must start with #: {tag}")

    def test_workflow_yaml_valid_zero_artifacts_and_sha_pinned(self) -> None:
        raw = WORKFLOW_PATH.read_text(encoding="utf-8")
        self.assertNotIn(
            "actions/upload-artifact",
            raw,
            "Workflow must contain zero references to actions/upload-artifact",
        )

        parsed = yaml.safe_load(raw)
        self.assertIsInstance(parsed, dict)
        # YAML 1.1 parses bare `on` as boolean True
        triggers = parsed.get("on", parsed.get(True))
        self.assertIsInstance(triggers, dict)
        self.assertEqual(triggers["schedule"][0]["cron"], "0 19 * * 4")
        self.assertIn("dry_run", triggers["workflow_dispatch"]["inputs"])
        self.assertIn("use_mock", triggers["workflow_dispatch"]["inputs"])

        steps = parsed["jobs"]["carousels"]["steps"]
        sha_rx = re.compile(r"^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+@[0-9a-f]{40}$")
        checkout_seen = False
        for step in steps:
            if "uses" in step:
                self.assertRegex(
                    step["uses"],
                    sha_rx,
                    f"Action must be pinned to a full 40-char commit SHA: {step['uses']}",
                )
                if step["uses"].startswith("actions/checkout@"):
                    checkout_seen = True
                    self.assertIs(
                        step.get("with", {}).get("persist-credentials"),
                        False,
                        "actions/checkout must set persist-credentials: false",
                    )
            if "run" in step:
                self.assertNotIn(
                    "${{",
                    step["run"],
                    f"Never interpolate ${{{{ ... }}}} directly inside run: step {step.get('name')}",
                )
        self.assertTrue(checkout_seen)


class TestUrlBuilderAndPoller(unittest.TestCase):
    def test_url_builder_normal_dry_run_and_traversal_rejection(self) -> None:
        self.assertEqual(
            publish_tiktok_drafts.build_carousel_slide_url("2026-11-26", "punk", "01_cover.jpg"),
            "https://setnikapp.github.io/carousels/2026-11-26/punk/01_cover.jpg",
        )
        self.assertEqual(
            publish_tiktok_drafts.build_carousel_slide_url("dry-run-2026-11-26", "indie", "02_show.jpg"),
            "https://setnikapp.github.io/carousels/dry-run-2026-11-26/indie/02_show.jpg",
        )

        bad_cases = [
            ("../2026-11-26", "punk", "01_cover.jpg"),
            ("2026-11-26/..", "punk", "01_cover.jpg"),
            ("2026-11-26", "../punk", "01_cover.jpg"),
            ("2026-11-26", "punk", "../01_cover.jpg"),
            ("2026-11-26", "punk", "/etc/passwd.jpg"),
            ("2026-11-26", "punk", "01_cover.png"),
        ]
        for folder, genre, fname in bad_cases:
            with self.assertRaises(ValueError, msg=f"Should reject {(folder, genre, fname)}"):
                publish_tiktok_drafts.build_carousel_slide_url(folder, genre, fname)

    def test_poller_waits_for_200_and_rejects_redirects(self) -> None:
        calls: dict[str, int] = {"n": 0}

        def handler_eventual_200(request: httpx.Request) -> httpx.Response:
            calls["n"] += 1
            if calls["n"] == 1:
                return httpx.Response(404)
            return httpx.Response(200)

        with httpx.Client(transport=httpx.MockTransport(handler_eventual_200)) as client:
            res = publish_tiktok_drafts.poll_urls_ready(
                ["https://setnikapp.github.io/carousels/2026-11-26/punk/01_cover.jpg"],
                timeout_seconds=10.0,
                interval_seconds=0.01,
                http_client=client,
                sleep_fn=lambda _s: None,
            )
            self.assertEqual(res["https://setnikapp.github.io/carousels/2026-11-26/punk/01_cover.jpg"], 200)
            self.assertEqual(calls["n"], 2)

        def handler_redirect(_request: httpx.Request) -> httpx.Response:
            return httpx.Response(301, headers={"Location": "https://example.com/other.jpg"})

        with httpx.Client(transport=httpx.MockTransport(handler_redirect)) as client:
            with self.assertRaises(RuntimeError) as ctx:
                publish_tiktok_drafts.poll_urls_ready(
                    ["https://setnikapp.github.io/carousels/2026-11-26/punk/01_cover.jpg"],
                    timeout_seconds=5.0,
                    interval_seconds=0.01,
                    http_client=client,
                    sleep_fn=lambda _s: None,
                )
            self.assertIn("redirect", str(ctx.exception).lower())


class TestMediaUploadPayloadAndDiagnostics(unittest.TestCase):
    def test_strict_media_upload_schema_forbids_direct_post_keys(self) -> None:
        payload = publish_tiktok_drafts.build_media_upload_payload(
            title="NYC / NJ Punk Shows · Fri, Nov 27 – Sun, Nov 29",
            description="Great shows this weekend #nycpunk #setnik",
            photo_urls=["https://setnikapp.github.io/carousels/2026-11-26/punk/01_cover.jpg"],
        )
        self.assertEqual(payload["post_mode"], "MEDIA_UPLOAD")
        self.assertEqual(payload["media_type"], "PHOTO")
        self.assertEqual(payload["source_info"]["source"], "PULL_FROM_URL")
        self.assertEqual(set(payload["post_info"].keys()), {"title", "description"})

        for forbidden_key in ("privacy_level", "auto_add_music", "disable_comment", "disable_duet"):
            bad = json.loads(json.dumps(payload))
            bad["post_info"][forbidden_key] = True
            with self.assertRaises(ValueError, msg=f"Must reject {forbidden_key}"):
                publish_tiktok_drafts.validate_media_upload_payload(bad)

    def test_actionable_diagnostics(self) -> None:
        for code in (
            "url_ownership_unverified",
            "spam_risk_too_many_pending_share",
            "app_version_check_failed",
            "access_token_invalid",
            "scope_not_authorized",
        ):
            diag = publish_tiktok_drafts.diagnose_tiktok_error(code, "boom")
            self.assertIn(code, diag)
            self.assertIn("Action:", diag)


class TestOAuthPkce(unittest.TestCase):
    def test_pkce_hex_challenge_and_authorize_url(self) -> None:
        verifier = oauth_bootstrap.generate_code_verifier(64)
        self.assertEqual(len(verifier), 64)
        challenge = oauth_bootstrap.compute_pkce_challenge_hex(verifier)
        expected = hashlib.sha256(verifier.encode("ascii")).hexdigest().lower()
        self.assertEqual(challenge, expected)
        self.assertEqual(len(challenge), 64)
        self.assertRegex(challenge, r"^[0-9a-f]{64}$")

        url = oauth_bootstrap.build_authorize_url(
            client_key="ck_123",
            redirect_uri="https://setnikapp.github.io/",
            state="state_xyz",
            code_challenge=challenge,
        )
        self.assertIn("scope=video.upload", url)
        self.assertIn("code_challenge_method=S256", url)
        self.assertIn(f"code_challenge={challenge}", url)

        oauth_bootstrap.verify_state("state_xyz", "state_xyz")
        with self.assertRaises(ValueError):
            oauth_bootstrap.verify_state("state_xyz", "wrong_state")


class TestPagesSyncAndPruning(unittest.TestCase):
    def test_sync_and_30_day_pruning(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            tmp_path = Path(tmp)
            ready = tmp_path / "ready"
            (ready / "punk").mkdir(parents=True)
            (ready / "punk" / "01_cover.jpg").write_bytes(b"fake-jpg")

            carousels_root = tmp_path / "static_carousels"
            # Old folders (>30 days before 2026-11-26 -> cutoff 2026-10-27)
            (carousels_root / "2026-10-01" / "punk").mkdir(parents=True)
            (carousels_root / "dry-run-2026-10-20" / "indie").mkdir(parents=True)
            # Recent folder (within 30 days)
            (carousels_root / "2026-11-10" / "punk").mkdir(parents=True)
            # Non-date verification file (must be preserved)
            (carousels_root / "tiktok_verify.txt").write_text("verify", encoding="utf-8")

            copied, pruned = sync_pages_repo.sync_carousels(
                ready_dir=ready,
                carousels_root=carousels_root,
                pages_folder="2026-11-26",
                reference_date=date(2026, 11, 26),
            )
            self.assertEqual(len(copied), 1)
            self.assertTrue((carousels_root / "2026-11-26" / "punk" / "01_cover.jpg").is_file())
            self.assertEqual(sorted(pruned), ["2026-10-01", "dry-run-2026-10-20"])
            self.assertFalse((carousels_root / "2026-10-01").exists())
            self.assertFalse((carousels_root / "dry-run-2026-10-20").exists())
            self.assertTrue((carousels_root / "2026-11-10").is_dir())
            self.assertTrue((carousels_root / "tiktok_verify.txt").is_file())


class TestEndToEndMockRenderAndPublish(unittest.TestCase):
    def test_e2e_mock_selection_playwright_render_dry_run_and_live_rotation(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            tmp_path = Path(tmp)
            selected_path = tmp_path / "selected.json"
            ready_dir = tmp_path / "ready"

            # 1. Run select_shows.mjs --mock
            subprocess.run(
                [
                    "node",
                    str(TOOLS_DIR / "select_shows.mjs"),
                    "--date",
                    "2026-11-26",
                    "--mock",
                    "--out",
                    str(selected_path),
                ],
                cwd=str(REPO_ROOT),
                check=True,
                capture_output=True,
                text=True,
            )
            selected = json.loads(selected_path.read_text(encoding="utf-8"))
            self.assertGreaterEqual(len(selected["genres"]), 2)

            # 2. Render live JPEGs via Playwright Chromium
            manifest_path = render_carousels.render_carousels(selected_path, out_dir=ready_dir)
            manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
            self.assertGreaterEqual(len(manifest["carousels"]), 2)

            for carousel in manifest["carousels"]:
                self.assertLessEqual(render_carousels.utf16_len(carousel["title"]), 90)
                self.assertLessEqual(len(carousel["hashtags"]), 5)
                self.assertTrue(carousel["headliner_sound_query"])
                for slide_name in carousel["slides"]:
                    slide_path = ready_dir / carousel["slug"] / slide_name
                    self.assertTrue(slide_path.is_file())
                    self.assertLess(slide_path.stat().st_size, 20 * 1024 * 1024)
                    with Image.open(slide_path) as img:
                        self.assertEqual(img.format, "JPEG")
                        self.assertEqual(img.size, (1080, 1920))

            # 3. Dry-run publish (no TikTok calls, emits job_summary.md with inline previews)
            summary_dry = publish_tiktok_drafts.publish_pipeline(
                ready_dir=ready_dir,
                pages_folder="dry-run-2026-11-26",
                dry_run=True,
                skip_url_poll=True,
            )
            dry_md = summary_dry.read_text(encoding="utf-8")
            self.assertIn("DRY RUN", dry_md)
            self.assertIn("Headliner Song to Pick in TikTok", dry_md)
            self.assertIn("https://setnikapp.github.io/carousels/dry-run-2026-11-26/", dry_md)

            # 4. Live publish with mocked TikTok HTTP transport + token rotation (0600)
            captured_payloads: list[dict[str, Any]] = []
            token_out = tmp_path / "rotated_refresh_token.txt"

            def mock_tiktok_handler(request: httpx.Request) -> httpx.Response:
                url = str(request.url)
                if url == publish_tiktok_drafts.TIKTOK_TOKEN_URL:
                    return httpx.Response(
                        200,
                        json={
                            "access_token": "act_mock_123",
                            "refresh_token": "rft_rotated_999",
                            "expires_in": 86400,
                        },
                    )
                if url == publish_tiktok_drafts.TIKTOK_CONTENT_INIT_URL:
                    body = json.loads(request.content.decode("utf-8"))
                    publish_tiktok_drafts.validate_media_upload_payload(body)
                    captured_payloads.append(body)
                    return httpx.Response(
                        200,
                        json={
                            "data": {"publish_id": f"p_pub_{len(captured_payloads)}"},
                            "error": {"code": "ok", "message": ""},
                        },
                    )
                # GitHub Pages slide HEAD/GET poll
                return httpx.Response(200)

            env_patch = {
                "TIKTOK_CLIENT_KEY": "ck_test",
                "TIKTOK_CLIENT_SECRET": "cs_test",
                "TIKTOK_REFRESH_TOKEN": "rft_old",
            }
            with patch.dict(os.environ, env_patch, clear=False):
                with httpx.Client(transport=httpx.MockTransport(mock_tiktok_handler)) as client:
                    summary_live = publish_tiktok_drafts.publish_pipeline(
                        ready_dir=ready_dir,
                        pages_folder="2026-11-26",
                        dry_run=False,
                        token_out=token_out,
                        http_client=client,
                    )

            self.assertEqual(len(captured_payloads), len(manifest["carousels"]))
            self.assertTrue(token_out.is_file())
            self.assertEqual(token_out.read_text(encoding="utf-8").strip(), "rft_rotated_999")
            mode = stat.S_IMODE(token_out.stat().st_mode)
            self.assertEqual(mode, 0o600, f"Expected 0600 permissions on token file, got {oct(mode)}")

            live_md = summary_live.read_text(encoding="utf-8")
            self.assertIn("LIVE DRAFT UPLOAD", live_md)
            self.assertIn("p_pub_1", live_md)
            self.assertIn("Refresh token rotated:** Yes", live_md)


if __name__ == "__main__":
    unittest.main()
