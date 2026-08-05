#!/usr/bin/env python3
"""External continuous driver for Aero Lead AI's Twin Cities cycle.

This keeps the loop alive outside Vercel. It calls the server-side autonomous
cycle, sleeps, and retries. The server remains the scoring/validation authority.
Use CRON_SECRET and AERO_BASE_URL environment variables.
"""
import os, time, json, urllib.request, urllib.error

BASE = os.environ["AERO_BASE_URL"].rstrip("/")
SECRET = os.environ.get("CRON_SECRET", "")
INTERVAL = int(os.environ.get("AERO_TC_INTERVAL_SECONDS", "300"))

def run_once():
    req = urllib.request.Request(
        BASE + "/api/twincities/autonomous-cycle",
        data=b"{}", method="POST",
        headers={"Content-Type":"application/json", **({"Authorization": f"Bearer {SECRET}"} if SECRET else {})},
    )
    with urllib.request.urlopen(req, timeout=70) as r:
        return json.loads(r.read().decode())

while True:
    try:
        result = run_once()
        print(json.dumps(result, separators=(",", ":")), flush=True)
    except Exception as exc:
        print(json.dumps({"ok": False, "error": str(exc)}), flush=True)
    time.sleep(INTERVAL)
