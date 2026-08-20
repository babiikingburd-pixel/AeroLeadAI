"""Optional real browser adapter.

Playwright support is available but opt-in via GATEKEEPER_ENABLE_BROWSER=1.
Without that flag, GateKeeper reports an honest infrastructure boundary and
never starts a browser unexpectedly during ordinary assessments/tests.
"""
from __future__ import annotations
import os
from typing import Any, Dict

class BrowserAdapter:
    def __init__(self, headless: bool=True):
        self.headless=headless
        self.enabled=os.getenv("GATEKEEPER_ENABLE_BROWSER","0").lower() in {"1","true","yes"}
        self._pw=None; self._browser=None; self._page=None

    def _ensure(self):
        if not self.enabled:
            raise RuntimeError("browser runtime disabled; set GATEKEEPER_ENABLE_BROWSER=1 to enable Playwright")
        if self._page is not None: return
        try:
            from playwright.sync_api import sync_playwright
            self._pw=sync_playwright().start()
            self._browser=self._pw.chromium.launch(headless=self.headless)
            self._page=self._browser.new_page()
        except Exception as exc:
            self.close()
            raise RuntimeError(f"browser runtime unavailable: {type(exc).__name__}: {exc}")

    def capability_status(self):
        if not self.enabled:
            return {"success":False,"implemented":False,"error":"browser runtime disabled; set GATEKEEPER_ENABLE_BROWSER=1","status":"RUNTIME-NOT-ATTACHED"}
        try:
            self._ensure()
            return {"success":True,"implemented":True,"runtime":"playwright"}
        except Exception as exc:
            return {"success":False,"implemented":False,"error":str(exc),"status":"RUNTIME-NOT-ATTACHED"}

    def navigate(self, url: str) -> Dict[str, Any]:
        try:
            self._ensure()
            response=self._page.goto(url, wait_until="domcontentloaded", timeout=15000)
            return {"success":True,"status_code":response.status if response else None,"url":self._page.url,"title":self._page.title()}
        except Exception as exc:
            return {"success":False,"implemented":False,"error":f"{type(exc).__name__}: {exc}"}

    def close(self):
        try:
            if self._browser: self._browser.close()
        finally:
            if self._pw: self._pw.stop()
            self._browser=None; self._pw=None; self._page=None
