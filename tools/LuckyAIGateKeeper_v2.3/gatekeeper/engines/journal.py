import json
from pathlib import Path
from datetime import datetime, timezone

def append(record: dict, path="gatekeeper/data/journal.jsonl"):
    p = Path(path)
    p.parent.mkdir(parents=True, exist_ok=True)
    with p.open("a", encoding="utf-8") as f:
        f.write(json.dumps(record, ensure_ascii=False) + "\n")

def read_all(path="gatekeeper/data/journal.jsonl"):
    p = Path(path)
    if not p.exists(): return []
    return [json.loads(line) for line in p.read_text(encoding="utf-8").splitlines() if line.strip()]
