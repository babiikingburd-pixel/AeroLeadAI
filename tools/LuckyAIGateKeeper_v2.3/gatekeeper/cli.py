import argparse, json
from gatekeeper.engines.orchestrator import GateKeeperEngine
from gatekeeper.models import Evidence

p = argparse.ArgumentParser(description="GateKeeper reality-assessment engine")
p.add_argument("claim")
p.add_argument("--evidence", help="JSON file containing evidence array")
args = p.parse_args()
ev=[]
if args.evidence:
    data=json.load(open(args.evidence, encoding="utf-8"))
    ev=[Evidence(**x) for x in data]
result=GateKeeperEngine().assess(args.claim, ev)
print(json.dumps(result.to_dict(), indent=2))
