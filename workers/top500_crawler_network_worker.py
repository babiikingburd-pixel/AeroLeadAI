#!/usr/bin/env python3
"""APEX 14.1 Top-500 crawler-network driver.

Runs a shared pool of logical slot crawlers. Each HTTP request claims work
atomically in Supabase, so multiple processes can run at once without
duplicating a slot investigation.

Environment:
  AERO_BASE_URL          deployed AeroLeadAI URL
  CRON_SECRET            optional route secret
  AERO_TOP500_WORKERS    concurrent claimers (default 6)
  AERO_TOP500_INTERVAL_SECONDS  pause between rounds (default 30)
"""
import os, time, json, urllib.request, urllib.error
from concurrent.futures import ThreadPoolExecutor, as_completed

BASE = os.environ["AERO_BASE_URL"].rstrip("/")
SECRET = os.environ.get("CRON_SECRET", "")
WORKERS = max(1, min(int(os.environ.get("AERO_TOP500_WORKERS", "6")), 20))
INTERVAL = max(5, int(os.environ.get("AERO_TOP500_INTERVAL_SECONDS", "30")))

def work(worker_id):
    body = json.dumps({
        "mode": "work",
        "limit": 1,
        "workerId": worker_id,
    }).encode()
    headers = {"Content-Type": "application/json"}
    if SECRET:
        headers["Authorization"] = f"Bearer {SECRET}"
    req = urllib.request.Request(BASE + "/api/twincities/top500-network",
                                 data=body, method="POST", headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=65) as r:
            return json.loads(r.read().decode())
    except Exception as exc:
        return {"ok": False, "workerId": worker_id, "error": str(exc)}

def round_once():
    results = []
    with ThreadPoolExecutor(max_workers=WORKERS) as pool:
        futures = [pool.submit(work, f"slot-pool-{i}") for i in range(WORKERS)]
        for f in as_completed(futures):
            results.append(f.result())
    claimed = sum(int(r.get("claimed", 0)) for r in results if isinstance(r, dict))
    return {"workers": WORKERS, "claimed": claimed, "results": results}

while True:
    started = time.time()
    try:
        print(json.dumps(round_once(), separators=(",", ":")), flush=True)
    except Exception as exc:
        print(json.dumps({"ok": False, "error": str(exc)}), flush=True)
    time.sleep(max(0, INTERVAL - (time.time() - started)))
