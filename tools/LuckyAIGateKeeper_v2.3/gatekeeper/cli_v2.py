import argparse
import json
from gatekeeper.engines.orchestrator_v2 import GateKeeperEngineV2
from gatekeeper.engines.llm_adapter import ManualOpinionProvider, get_default_provider
from gatekeeper.models import Evidence


def main():
    p = argparse.ArgumentParser(description="GateKeeper v2 — semantic + optional LLM reality-assessment engine")
    p.add_argument("claim")
    p.add_argument("--evidence", help="JSON file containing evidence array")
    p.add_argument(
        "--llm-opinion",
        help=(
            "JSON file with a pre-computed opinion "
            '{"classification":..,"barrier":..,"confidence":..,"rationale":[..]} '
            "supplied by the AI agent currently running this tool. No API key needed — "
            "use this when Claude (or another agent) is the one invoking the CLI and has "
            "already reasoned about the claim directly."
        ),
    )
    p.add_argument("--no-persist", action="store_true", help="Don't write to the journal")
    args = p.parse_args()

    ev = []
    if args.evidence:
        data = json.load(open(args.evidence, encoding="utf-8"))
        ev = [Evidence(**x) for x in data]

    if args.llm_opinion:
        opinion = json.load(open(args.llm_opinion, encoding="utf-8"))
        provider = ManualOpinionProvider(opinion)
    else:
        provider = get_default_provider()

    result = GateKeeperEngineV2(llm_provider=provider).assess(args.claim, ev, persist=not args.no_persist)
    print(json.dumps(result, indent=2, default=str))


if __name__ == "__main__":
    main()
