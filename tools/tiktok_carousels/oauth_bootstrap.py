#!/usr/bin/env python3
"""One-time local OAuth v2 bootstrap helper for TikTok Content Posting API.

Generates a PKCE code_verifier and lowercase hex SHA-256 code_challenge (as
required by TikTok OAuth v2 S256), opens/prints the authorization URL with
scope=video.upload, verifies the returned state parameter, exchanges the
authorization code at POST https://open.tiktokapis.com/v2/oauth/token/, and
prints the resulting TIKTOK_REFRESH_TOKEN for GitHub Secrets.

Usage:
    TIKTOK_CLIENT_KEY=... TIKTOK_CLIENT_SECRET=... \
      python3 tools/tiktok_carousels/oauth_bootstrap.py \
      --redirect-uri https://setnikapp.github.io/
"""

from __future__ import annotations

import argparse
import hashlib
import os
import secrets
import sys
from typing import Any
from urllib.parse import parse_qs, urlencode, urlparse

import httpx

TIKTOK_AUTH_URL = "https://www.tiktok.com/v2/auth/authorize/"
TIKTOK_TOKEN_URL = "https://open.tiktokapis.com/v2/oauth/token/"
DEFAULT_SCOPE = "video.upload"
PKCE_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~"


def generate_code_verifier(length: int = 64) -> str:
    """Generate an RFC 7636 / TikTok-compliant PKCE code_verifier (43-128 chars)."""
    if not (43 <= length <= 128):
        raise ValueError("PKCE code_verifier length must be between 43 and 128")
    return "".join(secrets.choice(PKCE_ALPHABET) for _ in range(length))


def compute_pkce_challenge_hex(code_verifier: str) -> str:
    """Compute TikTok OAuth v2 S256 PKCE code_challenge as lowercase hex SHA-256."""
    digest = hashlib.sha256(code_verifier.encode("ascii")).hexdigest()
    return digest.lower()


def build_authorize_url(
    client_key: str,
    redirect_uri: str,
    state: str,
    code_challenge: str,
    scope: str = DEFAULT_SCOPE,
) -> str:
    """Construct the TikTok OAuth v2 authorize URL with PKCE S256."""
    params = {
        "client_key": client_key,
        "response_type": "code",
        "scope": scope,
        "redirect_uri": redirect_uri,
        "state": state,
        "code_challenge": code_challenge,
        "code_challenge_method": "S256",
    }
    return f"{TIKTOK_AUTH_URL}?{urlencode(params)}"


def extract_callback_params(callback_input: str) -> tuple[str, str]:
    """Extract (code, state) from a full callback URL or raw query string."""
    raw = callback_input.strip()
    if not raw:
        raise ValueError("Callback URL or query string is empty")
    parsed = urlparse(raw)
    query_str = parsed.query if parsed.scheme else raw.lstrip("?")
    qs = parse_qs(query_str)
    error = qs.get("error", [""])[0]
    if error:
        desc = qs.get("error_description", [""])[0]
        raise RuntimeError(f"TikTok OAuth returned error={error}: {desc}")
    code = qs.get("code", [""])[0].strip()
    state = qs.get("state", [""])[0].strip()
    if not code:
        raise ValueError("No 'code' query parameter found in callback URL")
    return code, state


def verify_state(expected_state: str, returned_state: str) -> None:
    """Verify OAuth CSRF state parameter using constant-time comparison."""
    if not returned_state or not secrets.compare_digest(expected_state, returned_state):
        raise ValueError("OAuth state mismatch — aborting token exchange to prevent CSRF")


def exchange_code_for_tokens(
    client_key: str,
    client_secret: str,
    code: str,
    redirect_uri: str,
    code_verifier: str,
    http_client: httpx.Client | None = None,
) -> dict[str, Any]:
    """Exchange authorization code for access_token + refresh_token."""
    form_data = {
        "client_key": client_key,
        "client_secret": client_secret,
        "code": code,
        "grant_type": "authorization_code",
        "redirect_uri": redirect_uri,
        "code_verifier": code_verifier,
    }
    headers = {"Content-Type": "application/x-www-form-urlencoded"}
    if http_client is not None:
        resp = http_client.post(TIKTOK_TOKEN_URL, data=form_data, headers=headers)
    else:
        with httpx.Client(timeout=30.0) as client:
            resp = client.post(TIKTOK_TOKEN_URL, data=form_data, headers=headers)

    payload: dict[str, Any] = resp.json()
    if resp.status_code >= 400 or payload.get("error"):
        err_code = payload.get("error", f"HTTP_{resp.status_code}")
        err_desc = payload.get("error_description", resp.text)
        raise RuntimeError(f"TikTok token exchange failed ({err_code}): {err_desc}")
    return payload


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="One-time local TikTok OAuth v2 PKCE bootstrap to obtain TIKTOK_REFRESH_TOKEN."
    )
    parser.add_argument(
        "--client-key",
        default=os.environ.get("TIKTOK_CLIENT_KEY", ""),
        help="TikTok App Client Key (or set TIKTOK_CLIENT_KEY)",
    )
    parser.add_argument(
        "--client-secret",
        default=os.environ.get("TIKTOK_CLIENT_SECRET", ""),
        help="TikTok App Client Secret (or set TIKTOK_CLIENT_SECRET)",
    )
    parser.add_argument(
        "--redirect-uri",
        required=True,
        help="Exact Redirect URI registered in TikTok Developer Portal",
    )
    parser.add_argument(
        "--scope",
        default=DEFAULT_SCOPE,
        help=f"OAuth scope (default: {DEFAULT_SCOPE})",
    )
    args = parser.parse_args(argv)

    if not args.client_key or not args.client_secret:
        print("Error: --client-key / TIKTOK_CLIENT_KEY and --client-secret / TIKTOK_CLIENT_SECRET are required.", file=sys.stderr)
        return 1

    state = secrets.token_urlsafe(24)
    code_verifier = generate_code_verifier(64)
    code_challenge = compute_pkce_challenge_hex(code_verifier)
    auth_url = build_authorize_url(
        client_key=args.client_key,
        redirect_uri=args.redirect_uri,
        state=state,
        code_challenge=code_challenge,
        scope=args.scope,
    )

    print("\n1. Open this TikTok OAuth URL in your browser and approve video.upload:\n")
    print(auth_url)
    print("\n2. After TikTok redirects to your redirect_uri, paste the FULL callback URL below:\n")
    callback_url = input("Callback URL: ").strip()

    code, returned_state = extract_callback_params(callback_url)
    verify_state(state, returned_state)

    tokens = exchange_code_for_tokens(
        client_key=args.client_key,
        client_secret=args.client_secret,
        code=code,
        redirect_uri=args.redirect_uri,
        code_verifier=code_verifier,
    )

    refresh_token = str(tokens.get("refresh_token", "")).strip()
    scope_granted = str(tokens.get("scope", ""))
    expires_in = tokens.get("refresh_expires_in")

    print("\n=== TikTok OAuth Bootstrap Complete ===")
    print(f"Granted scope:        {scope_granted}")
    print(f"Refresh expires in:   {expires_in}s")
    print(f"TIKTOK_REFRESH_TOKEN: {refresh_token}")
    print("\nSave TIKTOK_REFRESH_TOKEN as a GitHub Actions Repository Secret.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
