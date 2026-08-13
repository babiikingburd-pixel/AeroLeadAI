from typing import Dict, List

KEYWORDS = {
    "web": ["web", "browser", "research", "internet", "website"],
    "vision": ["image", "video", "visual", "camera", "screen"],
    "language": ["text", "document", "chat", "language", "write"],
    "data": ["database", "data", "csv", "spreadsheet", "records"],
    "automation": ["automate", "workflow", "execute", "agent", "autonomous"],
    "physical": ["robot", "machine", "vehicle", "physical", "sensor"],
    "identity": ["login", "identity", "account", "permission", "credential"],
    "api": ["api", "integration", "service", "endpoint"],
    "reasoning": ["reason", "plan", "decide", "analyze", "predict"],
}

def decompose(claim: str) -> Dict[str, List[str]]:
    text = claim.lower()
    existing, missing = [], []
    for component, words in KEYWORDS.items():
        if any(w in text for w in words):
            existing.append(component)
    if not existing:
        missing.append("capability primitives not yet identified")
    return {"existing_components": existing, "missing_components": missing}
