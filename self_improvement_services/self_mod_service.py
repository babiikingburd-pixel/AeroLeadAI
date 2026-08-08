"""
services/self_mod_service.py — LAYER 4: CONTROLLED SELF-MODIFICATION

Hard rule this whole layer exists to enforce: the AI never deploys code.
It can only reach 'queued_for_review'. A human calls approve_and_deploy()
or reject() — those are the only two functions that change a proposal's
terminal state, and deploy still requires an explicit human-supplied
deploy action (this module stops short of touching production files).

Flow:
    propose_improvement()  -> status: proposed
    run_proposal_tests()   -> status: tests_failed | queued_for_review
    approve()               -> status: approved   (human only)
    reject()                -> status: rejected    (human only)
    mark_deployed()         -> status: deployed    (call after YOU deploy it)
"""
from __future__ import annotations
from typing import Optional
from db.pool import get_pool
from sandbox import test_runner

PASS_THRESHOLD = 0.95


async def propose_improvement(
    target_component: str,
    rationale: str,
    diff: str,
    old_version_ref: Optional[str] = None,
) -> int:
    pool = await get_pool()
    row = await pool.fetchrow(
        """
        INSERT INTO improvement_proposals (target_component, rationale, diff, old_version_ref, status)
        VALUES ($1,$2,$3,$4,'proposed')
        RETURNING id
        """,
        target_component, rationale, diff, old_version_ref,
    )
    return row["id"]


async def run_proposal_tests(proposal_id: int) -> dict:
    pool = await get_pool()
    proposal = await pool.fetchrow("SELECT * FROM improvement_proposals WHERE id = $1", proposal_id)
    if not proposal:
        raise ValueError(f"No proposal with id {proposal_id}")

    await pool.execute(
        "UPDATE improvement_proposals SET status = 'tests_running' WHERE id = $1", proposal_id
    )

    report = await test_runner.run_tests(proposal["diff"], proposal["target_component"])
    pass_rate = report["pass_rate"]

    new_status = "queued_for_review" if pass_rate >= PASS_THRESHOLD else "tests_failed"

    await pool.execute(
        """
        UPDATE improvement_proposals
        SET test_pass_rate = $1, test_report = $2, status = $3
        WHERE id = $4
        """,
        pass_rate, __import__("json").dumps(report), new_status, proposal_id,
    )

    return {"proposal_id": proposal_id, "pass_rate": pass_rate, "status": new_status}


async def list_pending_review() -> list[dict]:
    pool = await get_pool()
    rows = await pool.fetch(
        "SELECT * FROM improvement_proposals WHERE status = 'queued_for_review' ORDER BY created_at"
    )
    return [dict(r) for r in rows]


# ---------------- HUMAN-ONLY ACTIONS ----------------
# Everything below this line should only ever be called from an
# authenticated admin action (e.g. a button in your dashboard) —
# never from the automated orchestrator loop.

async def approve(proposal_id: int, reviewed_by: str) -> None:
    pool = await get_pool()
    await pool.execute(
        """
        UPDATE improvement_proposals
        SET status = 'approved', reviewed_by = $1, reviewed_at = NOW()
        WHERE id = $2 AND status = 'queued_for_review'
        """,
        reviewed_by, proposal_id,
    )


async def reject(proposal_id: int, reviewed_by: str) -> None:
    pool = await get_pool()
    await pool.execute(
        """
        UPDATE improvement_proposals
        SET status = 'rejected', reviewed_by = $1, reviewed_at = NOW()
        WHERE id = $2
        """,
        reviewed_by, proposal_id,
    )


async def mark_deployed(proposal_id: int, new_version_ref: str) -> None:
    """Call this AFTER you've manually (or via your own CI) deployed an
    approved proposal. This function does not deploy anything itself."""
    pool = await get_pool()
    await pool.execute(
        """
        UPDATE improvement_proposals
        SET status = 'deployed', new_version_ref = $1
        WHERE id = $2 AND status = 'approved'
        """,
        new_version_ref, proposal_id,
    )
