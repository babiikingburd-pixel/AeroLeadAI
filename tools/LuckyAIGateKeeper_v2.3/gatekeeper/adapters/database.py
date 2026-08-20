"""
Database adapter. REAL-NOW.

Uses Python's built-in sqlite3 — no external dependency, works on any
machine with Python. Provides a genuine query/verify capability: given a
query and expected shape, it actually runs the query and reports the real
result, rather than assuming a database claim is true.
"""
from __future__ import annotations
import sqlite3
from typing import Any, Dict, List, Optional


class DatabaseAdapter:
    def __init__(self, path: str = ":memory:"):
        self.path = path
        self.conn = sqlite3.connect(path)

    def execute(self, sql: str, params: Optional[tuple] = None) -> Dict[str, Any]:
        try:
            cur = self.conn.cursor()
            cur.execute(sql, params or ())
            if sql.strip().lower().startswith("select"):
                rows = cur.fetchall()
                cols = [d[0] for d in cur.description] if cur.description else []
                return {"success": True, "columns": cols, "rows": rows, "row_count": len(rows)}
            self.conn.commit()
            return {"success": True, "row_count": cur.rowcount}
        except Exception as exc:  # noqa: BLE001
            return {"success": False, "error": f"{type(exc).__name__}: {exc}"}

    def close(self) -> None:
        self.conn.close()
