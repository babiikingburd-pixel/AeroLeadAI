"""
api/main.py — FastAPI surface for the self-improvement layer.

Mount this alongside (or behind a subpath of) your existing three-agent
AeroLeadAI FastAPI app. Starts the orchestrator loop as a background task
on startup.

Run standalone for testing:
    uvicorn api.main:app --reload --port 8100
"""
from __future__ import annotations
import asyncio
import logging
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

import orchestrator
from services import (
    memory_service,
    experiment_service,
    evaluator_service,
    ranking_service,
    planner_service,
    self_mod_service,
)

logging.basicConfig(level=logging.INFO)

app = FastAPI(title="AeroLeadAI Self-Improvement Layer")


@app.on_event("startup")
async def startup():
    asyncio.create_task(orchestrator.loop_forever())


@app.on_event("shutdown")
async def shutdown():
    orchestrator.stop()


# ---------------- STATUS ----------------
@app.get("/status")
async def status():
    return {
        "orchestrator_running": orchestrator.is_running(),
        "last_cycle": orchestrator.get_last_cycle_summary(),
    }


# ---------------- LAYER 1: MEMORY ----------------
@app.get("/memory/history")
async def memory_history(strategy: str | None = None, limit: int = 100):
    return await memory_service.get_history(strategy, limit)


@app.get("/memory/stats/{strategy}")
async def memory_stats(strategy: str, since_days: int = 7):
    return await memory_service.get_strategy_stats(strategy, since_days)


# ---------------- LAYER 2: EXPERIMENTS ----------------
@app.post("/experiments/run")
async def trigger_experiment(strategy: str | None = None):
    return await experiment_service.run_experiment(strategy)


@app.get("/experiments/strategies")
async def active_strategies():
    return await experiment_service.get_active_strategies()


# ---------------- LAYER 3: RANKING ----------------
@app.post("/ranking/run")
async def trigger_ranking():
    return await ranking_service.run_weekly_ranking()


@app.get("/ranking/candidates")
async def middle_tier_candidates():
    return await planner_service.get_middle_tier_candidates()


# ---------------- LAYER 4: SELF-MODIFICATION (human-gated) ----------------
class ProposalIn(BaseModel):
    target_component: str
    rationale: str
    diff: str
    old_version_ref: str | None = None


@app.post("/proposals")
async def create_proposal(p: ProposalIn):
    proposal_id = await self_mod_service.propose_improvement(
        p.target_component, p.rationale, p.diff, p.old_version_ref
    )
    return {"proposal_id": proposal_id}


@app.post("/proposals/{proposal_id}/test")
async def test_proposal(proposal_id: int):
    return await self_mod_service.run_proposal_tests(proposal_id)


@app.get("/proposals/pending")
async def pending_proposals():
    return await self_mod_service.list_pending_review()


class ReviewIn(BaseModel):
    reviewed_by: str


@app.post("/proposals/{proposal_id}/approve")
async def approve_proposal(proposal_id: int, body: ReviewIn):
    # HUMAN ACTION ONLY — call this from an authenticated admin route.
    await self_mod_service.approve(proposal_id, body.reviewed_by)
    return {"status": "approved"}


@app.post("/proposals/{proposal_id}/reject")
async def reject_proposal(proposal_id: int, body: ReviewIn):
    await self_mod_service.reject(proposal_id, body.reviewed_by)
    return {"status": "rejected"}


class DeployIn(BaseModel):
    new_version_ref: str


@app.post("/proposals/{proposal_id}/mark-deployed")
async def mark_deployed(proposal_id: int, body: DeployIn):
    # Call AFTER you've actually deployed the approved change yourself.
    await self_mod_service.mark_deployed(proposal_id, body.new_version_ref)
    return {"status": "deployed"}
