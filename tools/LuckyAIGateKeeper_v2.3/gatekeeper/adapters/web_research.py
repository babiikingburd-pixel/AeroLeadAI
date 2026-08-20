"""
Web research adapter. REAL-NOW when the running environment has outbound
network access; fails soft (never fabricates a page) when it doesn't.

Deliberately stdlib-only (urllib) so this has zero install requirements
wherever the package runs. In a network-restricted sandbox, only allow-
listed domains will succeed — that restriction is the sandbox's, not this
adapter pretending the fetch happened.
"""
from __future__ import annotations
import urllib.request
import urllib.error
from typing import Any, Dict


class WebResearchAdapter:
    def __init__(self, timeout_seconds: float = 10.0):
        self.timeout_seconds = timeout_seconds

    def fetch(self, url: str) -> Dict[str, Any]:
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "GateKeeper-Investigator/1.4"})
            with urllib.request.urlopen(req, timeout=self.timeout_seconds) as resp:
                body = resp.read(4096)  # sample, not the whole page — this is a verification probe
                return {
                    "success": True,
                    "status_code": resp.status,
                    "content_length_sampled": len(body),
                    "content_type": resp.headers.get("Content-Type", ""),
                }
        except urllib.error.HTTPError as exc:
            return {"success": False, "status_code": exc.code, "error": str(exc)}
        except urllib.error.URLError as exc:
            return {"success": False, "error": f"network unreachable or blocked: {exc.reason}"}
        except Exception as exc:  # noqa: BLE001
            return {"success": False, "error": f"{type(exc).__name__}: {exc}"}
