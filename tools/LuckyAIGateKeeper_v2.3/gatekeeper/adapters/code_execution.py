"""
Code execution adapter. REAL-NOW.

Runs a Python snippet in a subprocess with a timeout and returns actual
stdout/stderr/exit code. This is a genuine execution, not a description of
one — it's what lets the Investigator (see investigator.py) test a
"smallest experiment" claim by actually running code rather than reasoning
about whether it would probably work.
"""
from __future__ import annotations
import subprocess
import sys
from typing import Any, Dict


class CodeExecutionAdapter:
    def __init__(self, timeout_seconds: float = 10.0):
        self.timeout_seconds = timeout_seconds

    def run_python(self, code: str) -> Dict[str, Any]:
        try:
            proc = subprocess.run(
                [sys.executable, "-c", code],
                capture_output=True,
                text=True,
                timeout=self.timeout_seconds,
            )
            return {
                "executed": True,
                "exit_code": proc.returncode,
                "stdout": proc.stdout,
                "stderr": proc.stderr,
                "success": proc.returncode == 0,
            }
        except subprocess.TimeoutExpired:
            return {"executed": False, "success": False, "error": "timeout"}
        except Exception as exc:  # noqa: BLE001
            return {"executed": False, "success": False, "error": f"{type(exc).__name__}: {exc}"}
