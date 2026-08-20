"""
Evidence provenance graph.

v1-v1.3 record evidence as a flat list attached to one assessment. There
was no way to answer "where did this evidence actually come from, and what
did it depend on" across multiple runs. This is a real, in-memory (and
journal-persisted) directed graph: nodes are evidence/assessment IDs, edges
are "derived_from" / "supports" / "contradicts" relationships.

Fully local, stdlib only, no external dependency — REAL-NOW, not a stub.
"""
from __future__ import annotations
import json
from pathlib import Path
from typing import Any, Dict, List, Optional


class ProvenanceGraph:
    def __init__(self):
        self.nodes: Dict[str, Dict[str, Any]] = {}
        self.edges: List[Dict[str, str]] = []

    def add_node(self, node_id: str, kind: str, **attrs: Any) -> None:
        self.nodes[node_id] = {"id": node_id, "kind": kind, **attrs}

    def add_edge(self, src: str, dst: str, relation: str) -> None:
        if relation not in {"derived_from", "supports", "contradicts"}:
            raise ValueError(f"unknown relation: {relation}")
        self.edges.append({"src": src, "dst": dst, "relation": relation})

    def contradictions_for(self, node_id: str) -> List[Dict[str, str]]:
        return [e for e in self.edges if e["relation"] == "contradicts" and node_id in (e["src"], e["dst"])]

    def chain(self, node_id: str) -> List[Dict[str, str]]:
        """All edges reachable by following derived_from/supports forward from node_id."""
        seen: List[Dict[str, str]] = []
        frontier = [node_id]
        visited = set()
        while frontier:
            cur = frontier.pop()
            if cur in visited:
                continue
            visited.add(cur)
            for e in self.edges:
                if e["src"] == cur and e["relation"] in {"derived_from", "supports"}:
                    seen.append(e)
                    frontier.append(e["dst"])
        return seen

    def to_dict(self) -> Dict[str, Any]:
        return {"nodes": self.nodes, "edges": self.edges}

    def save(self, path: str) -> None:
        p = Path(path)
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(json.dumps(self.to_dict(), indent=2), encoding="utf-8")

    @classmethod
    def load(cls, path: str) -> "ProvenanceGraph":
        g = cls()
        p = Path(path)
        if p.exists():
            data = json.loads(p.read_text(encoding="utf-8"))
            g.nodes = data.get("nodes", {})
            g.edges = data.get("edges", [])
        return g
