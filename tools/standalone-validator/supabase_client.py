"""
Minimal direct Supabase REST client. No supabase-py dependency -- just
`requests`, so this tool has almost nothing that can break on install.

This is genuinely "outside the system" -- it talks straight to Postgres via
PostgREST, the same way the Next.js app does, but as a completely separate
process that doesn't depend on Vercel being up at all.
"""

from __future__ import annotations

import requests


class SupabaseClient:
    def __init__(self, url: str, key: str):
        self.base = url.rstrip("/") + "/rest/v1"
        self.headers = {
            "apikey": key,
            "Authorization": f"Bearer {key}",
            "Content-Type": "application/json",
        }

    def select(self, table: str, params: dict, timeout: int = 20) -> list[dict]:
        resp = requests.get(f"{self.base}/{table}", headers=self.headers, params=params, timeout=timeout)
        resp.raise_for_status()
        return resp.json()

    def update(self, table: str, match: dict, patch: dict, timeout: int = 20) -> list[dict]:
        params = {f"{k}": f"eq.{v}" for k, v in match.items()}
        headers = {**self.headers, "Prefer": "return=representation"}
        resp = requests.patch(f"{self.base}/{table}", headers=headers, params=params, json=patch, timeout=timeout)
        resp.raise_for_status()
        return resp.json()

    def insert(self, table: str, rows: list[dict] | dict, timeout: int = 20) -> list[dict]:
        headers = {**self.headers, "Prefer": "return=representation"}
        resp = requests.post(f"{self.base}/{table}", headers=headers, json=rows, timeout=timeout)
        resp.raise_for_status()
        return resp.json()

    def conditional_update(self, table: str, match: dict, only_if: dict, patch: dict, timeout: int = 20) -> list[dict]:
        """UPDATE ... WHERE match AND only_if -- used for atomic job claiming
        (matches the JS priority-worker's claim pattern: only succeeds if
        the row is still in the expected state, so two workers racing on the
        same lead can't both win)."""
        params = {}
        for k, v in match.items():
            params[k] = f"eq.{v}"
        for k, v in only_if.items():
            params[k] = f"eq.{v}"
        headers = {**self.headers, "Prefer": "return=representation"}
        resp = requests.patch(f"{self.base}/{table}", headers=headers, params=params, json=patch, timeout=timeout)
        resp.raise_for_status()
        return resp.json()
