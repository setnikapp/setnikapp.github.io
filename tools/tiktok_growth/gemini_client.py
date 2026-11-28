#!/usr/bin/env python3
"""Lightweight Gemini REST API client (text JSON + multimodal Vision) using httpx.

Designed for Gemini free-tier usage in GitHub Actions with zero heavy SDK dependencies.
"""

from __future__ import annotations

import base64
import json
import os
import re
import time
from typing import Any

import httpx

DEFAULT_GEMINI_MODEL = "gemini-3.8-flash"
DEFAULT_FALLBACK_MODELS: tuple[str, ...] = (
    "gemini-3.1-flash-lite-preview",
    "gemini-3.1-flash-lite",
    "gemini-3.6-flash",
    "gemini-3-flash-preview",
)
GEMINI_API_BASE = "https://generativelanguage.googleapis.com/v1beta/models"
RETRYABLE_STATUS_CODES = {429, 500, 502, 503, 504}
EXCLUDED_FALLBACK_SUBSTRINGS = ("omni", "live", "tts", "image", "robotics", "transcribe")


def strip_json_fences(raw_text: str) -> str:
    """Remove optional ```json ... ``` markdown fences around JSON text."""
    text = raw_text.strip()
    m = re.match(r"^```(?:json)?\s*\n?(.*?)\n?```$", text, flags=re.DOTALL | re.IGNORECASE)
    if m:
        return m.group(1).strip()
    return text


def parse_json_response(raw_text: str) -> Any:
    """Parse JSON from a Gemini text response, stripping markdown fences if present."""
    cleaned = strip_json_fences(raw_text)
    try:
        return json.loads(cleaned)
    except json.JSONDecodeError:
        # Fallback: locate outermost JSON object or array
        start_obj = cleaned.find("{")
        start_arr = cleaned.find("[")
        starts = [i for i in (start_obj, start_arr) if i != -1]
        if not starts:
            raise
        start = min(starts)
        end_char = "}" if cleaned[start] == "{" else "]"
        end = cleaned.rfind(end_char)
        if end == -1 or end <= start:
            raise
        return json.loads(cleaned[start : end + 1])


class GeminiClient:
    """Minimal REST client for Gemini generateContent (text + vision + JSON mode)."""

    def __init__(
        self,
        api_key: str | None = None,
        model: str | None = None,
        fallback_models: tuple[str, ...] | list[str] | None = None,
        timeout: float = 90.0,
        max_retries: int = 2,
        http_client: httpx.Client | None = None,
        sleep_fn: Any = time.sleep,
    ) -> None:
        self.api_key = (api_key if api_key is not None else os.environ.get("GEMINI_API_KEY", "")).strip()
        self.model = (model or os.environ.get("GEMINI_MODEL", "") or DEFAULT_GEMINI_MODEL).strip()
        if fallback_models is not None:
            raw_fb = [m.strip() for m in fallback_models if m and m.strip()]
        else:
            env_fb = os.environ.get("GEMINI_FALLBACK_MODELS", "").strip()
            raw_fb = (
                [m.strip() for m in env_fb.split(",") if m.strip()]
                if env_fb
                else list(DEFAULT_FALLBACK_MODELS)
            )
        self.fallback_models = [m for m in raw_fb if m != self.model]
        self._discovered_fallbacks: list[str] | None = None
        self.timeout = timeout
        self.max_retries = max_retries
        self._http_client = http_client
        self._sleep = sleep_fn

    def _endpoint(self, model_name: str | None = None) -> str:
        target = model_name or self.model
        return f"{GEMINI_API_BASE}/{target}:generateContent"

    def _discover_flash_fallbacks(self) -> list[str]:
        """Query /v1beta/models once to find active Gemini 3.x Flash models if primary hits 503."""
        if self._discovered_fallbacks is not None:
            return self._discovered_fallbacks
        if self._http_client is not None:
            self._discovered_fallbacks = []
            return []
        found: list[str] = []
        try:
            headers = {"x-goog-api-key": self.api_key}
            with httpx.Client(timeout=15.0) as client:
                resp = client.get(GEMINI_API_BASE, headers=headers)
            if resp.status_code == 200:
                for m in (resp.json().get("models") or []):
                    name = str(m.get("name") or "").removeprefix("models/")
                    low = name.lower()
                    methods = m.get("supportedGenerationMethods") or []
                    if (
                        "generateContent" in methods
                        and low.startswith("gemini-3")
                        and "flash" in low
                        and not any(bad in low for bad in EXCLUDED_FALLBACK_SUBSTRINGS)
                        and name != self.model
                    ):
                        found.append(name)
        except Exception:
            pass
        # Prefer flash-lite first (500 RPD on free tier), then newest 3.x flash
        found.sort(key=lambda n: (0 if "lite" in n.lower() else 1, n), reverse=False)
        self._discovered_fallbacks = found[:4]
        return self._discovered_fallbacks

    def _post(self, payload: dict[str, Any]) -> dict[str, Any]:
        if not self.api_key:
            raise RuntimeError("GEMINI_API_KEY is not set")

        headers = {
            "Content-Type": "application/json",
            "x-goog-api-key": self.api_key,
        }

        tried: set[str] = set()
        queue: list[str] = [self.model, *self.fallback_models]
        discovered = False
        last_err: Exception | None = None

        while queue:
            model_name = queue.pop(0)
            if model_name in tried:
                continue
            tried.add(model_name)
            url = self._endpoint(model_name)

            for attempt in range(self.max_retries):
                try:
                    if self._http_client is not None:
                        resp = self._http_client.post(url, json=payload, headers=headers)
                    else:
                        with httpx.Client(timeout=self.timeout) as client:
                            resp = client.post(url, json=payload, headers=headers)

                    if resp.status_code == 404:
                        last_err = RuntimeError(f"Gemini API HTTP 404 ({model_name}): {resp.text[:300]}")
                        break

                    if resp.status_code in RETRYABLE_STATUS_CODES:
                        last_err = RuntimeError(
                            f"Gemini API HTTP {resp.status_code} ({model_name}): {resp.text[:300]}"
                        )
                        if attempt < self.max_retries - 1:
                            self._sleep(min(15.0, 3.0 * (attempt + 1)))
                            continue
                        break

                    if resp.status_code >= 400:
                        raise RuntimeError(
                            f"Gemini API HTTP {resp.status_code} ({model_name}): {resp.text[:500]}"
                        )
                    return resp.json()
                except httpx.HTTPError as exc:
                    last_err = RuntimeError(f"Gemini API request failed ({model_name}): {exc}")
                    if attempt < self.max_retries - 1:
                        self._sleep(min(15.0, 3.0 * (attempt + 1)))
                        continue
                    break

            if not queue and not discovered:
                discovered = True
                queue.extend(m for m in self._discover_flash_fallbacks() if m not in tried)

        raise RuntimeError(str(last_err or "Gemini API failed across all models"))

    @staticmethod
    def _extract_text(response_json: dict[str, Any]) -> str:
        candidates = response_json.get("candidates") or []
        if not candidates:
            raise RuntimeError(f"Gemini returned no candidates: {response_json}")
        parts = ((candidates[0].get("content") or {}).get("parts")) or []
        texts = [str(p.get("text") or "") for p in parts if isinstance(p, dict) and p.get("text")]
        combined = "\n".join(texts).strip()
        if not combined:
            raise RuntimeError(f"Gemini returned empty text parts: {response_json}")
        return combined

    def generate_json(
        self,
        prompt: str,
        system_instruction: str | None = None,
        temperature: float = 0.6,
    ) -> Any:
        """Generate structured JSON from a text prompt."""
        payload: dict[str, Any] = {
            "contents": [{"role": "user", "parts": [{"text": prompt}]}],
            "generationConfig": {
                "temperature": temperature,
                "responseMimeType": "application/json",
            },
        }
        if system_instruction:
            payload["systemInstruction"] = {"parts": [{"text": system_instruction}]}

        data = self._post(payload)
        return parse_json_response(self._extract_text(data))

    def generate_json_from_images(
        self,
        prompt: str,
        images: list[tuple[bytes, str]],
        system_instruction: str | None = None,
        temperature: float = 0.2,
    ) -> Any:
        """Generate structured JSON from one or more (image_bytes, mime_type) inputs."""
        if not images:
            raise ValueError("images must contain at least one (bytes, mime_type) tuple")

        parts: list[dict[str, Any]] = [{"text": prompt}]
        for img_bytes, mime_type in images:
            parts.append(
                {
                    "inline_data": {
                        "mime_type": mime_type,
                        "data": base64.b64encode(img_bytes).decode("ascii"),
                    }
                }
            )

        payload: dict[str, Any] = {
            "contents": [{"role": "user", "parts": parts}],
            "generationConfig": {
                "temperature": temperature,
                "responseMimeType": "application/json",
            },
        }
        if system_instruction:
            payload["systemInstruction"] = {"parts": [{"text": system_instruction}]}

        data = self._post(payload)
        return parse_json_response(self._extract_text(data))
