import argparse, json
from .engine import GateKeeper20

def main():
    p=argparse.ArgumentParser(description="GateKeeper 2.0")
    p.add_argument("claim", nargs="+")
    p.add_argument("--json",action="store_true")
    a=p.parse_args()
    r=GateKeeper20().investigate(" ".join(a.claim))
    print(json.dumps(r,indent=2,default=str) if a.json else f"GateKeeper {r['version']} | {r['decision']} | confidence={r['confidence']} | score={r['score']} | reproducibility={r['reproducibility']}")
if __name__=="__main__": main()
