"""
V2 lexicon — additive only. Does not modify or import from decomposer.py's
KEYWORDS; the v1 decomposer remains byte-for-byte untouched so the original
CLI/tests/behavior are preserved exactly.

This lexicon is intentionally broader than the v1 keyword table:
- weighted terms (some words are stronger domain signals than others)
- multi-word phrases, not just single tokens
- domain vocabulary specific to Lucky AI Solutions' own project ecosystem
  (AeroLeadAI, Dial-A-Trade, The Commander) so claims phrased in the
  portfolio's own language decompose correctly instead of falling through
  to UNKNOWN.
- negation / qualifier phrases that shift a claim toward INTEGRATION-LIMITED,
  FUTURE-INFRASTRUCTURE, or UNKNOWN even when domain keywords are present.
"""
from typing import Dict, List, Tuple

# component -> list of (phrase, weight 0-1)
DOMAIN_LEXICON: Dict[str, List[Tuple[str, float]]] = {
    "web": [
        ("web", .6), ("browser", .7), ("research", .5), ("internet", .6),
        ("website", .8), ("crawl", .7), ("scrape", .7), ("search engine", .6),
    ],
    "vision": [
        ("image", .7), ("video", .7), ("visual", .6), ("camera", .7),
        ("screen", .5), ("satellite imagery", .9), ("aerial imagery", .9),
        ("photo", .6), ("ocr", .8),
    ],
    "language": [
        ("text", .5), ("document", .6), ("chat", .5), ("language", .5),
        ("write", .5), ("summarize", .6), ("draft", .5), ("letter", .6),
    ],
    "data": [
        ("database", .7), ("data", .4), ("csv", .7), ("spreadsheet", .7),
        ("records", .6), ("dataset", .6), ("etl", .7),
    ],
    "automation": [
        ("automate", .7), ("workflow", .6), ("execute", .5), ("agent", .6),
        ("autonomous", .7), ("orchestrate", .7), ("pipeline", .6),
        ("dispatch", .7), ("schedule", .6),
    ],
    "physical": [
        ("robot", .8), ("machine", .5), ("vehicle", .6), ("physical", .6),
        ("sensor", .7), ("drone", .8), ("hardware", .6), ("magnetometer", .8),
    ],
    "identity": [
        ("login", .6), ("identity", .5), ("account", .5), ("permission", .6),
        ("credential", .7), ("auth", .6), ("oauth", .7),
    ],
    "api": [
        ("api", .7), ("integration", .6), ("service", .4), ("endpoint", .6),
        ("webhook", .6), ("sdk", .6),
    ],
    "reasoning": [
        ("reason", .5), ("plan", .4), ("decide", .5), ("analyze", .5),
        ("predict", .6), ("score", .5), ("classify", .5),
    ],
    # --- Lucky AI Solutions project-specific vocabulary ---
    "property_intel": [
        ("property", .7), ("parcel", .8), ("permit", .8), ("zoning", .8),
        ("storm", .7), ("hail", .8), ("roof", .7), ("lead scoring", .8),
        ("opportunity generation", .6), ("aeroleadai", .9),
    ],
    "trade_fulfillment": [
        ("technician", .7), ("contractor", .7), ("work order", .8),
        ("capacity", .6), ("trade", .5), ("fulfillment", .6),
        ("dial-a-trade", .9), ("dial a trade", .9),
    ],
    "supervision": [
        ("supervise", .6), ("escalate", .7), ("authorize", .7),
        ("kill switch", .8), ("audit log", .7), ("the commander", .9),
        ("boardroom", .7), ("governance", .6),
    ],
    "economic": [
        ("cost", .5), ("price", .5), ("budget", .5), ("roi", .6),
        ("revenue", .5), ("investor", .6), ("funding", .6),
    ],
    "legal": [
        ("license", .7), ("regulation", .7), ("compliance", .7),
        ("faa", .9), ("hipaa", .9), ("gdpr", .8), ("liability", .6),
    ],
}

# Phrases that signal the claim is being described as currently unavailable,
# access-gated, or explicitly speculative — these push classification away
# from REAL-NOW / BUILDABLE-NOW even when domain keywords are present.
NEGATION_PATTERNS: List[Tuple[str, str]] = [
    ("not yet", "temporal_gap"),
    ("no access to", "access_gap"),
    ("don't have access", "access_gap"),
    ("requires approval", "authorization_gap"),
    ("requires a license", "legal_gap"),
    ("requires regulatory", "legal_gap"),
    ("hasn't been built", "build_gap"),
    ("has not been built", "build_gap"),
    ("theoretically", "speculative"),
    ("in theory", "speculative"),
    ("someday", "speculative"),
    ("future infrastructure", "future_gap"),
    ("requires new science", "scientific_gap"),
    ("not yet invented", "scientific_gap"),
    ("simulated only", "simulation_flag"),
    ("mock", "simulation_flag"),
    ("prototype only", "simulation_flag"),
    # Real-world "tool is rate-limited / temporarily down" signals — this is
    # a genuinely different barrier than access/legal/scientific gaps: the
    # capability exists and normally works, it's just unavailable right now.
    ("please try again later", "availability_gap"),
    ("try again later", "availability_gap"),
    ("can't do", "availability_gap"),
    ("cannot do", "availability_gap"),
    ("not available right now", "availability_gap"),
    ("temporarily unavailable", "availability_gap"),
    ("currently unable", "availability_gap"),
]
