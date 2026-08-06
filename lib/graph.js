// Item #3: property knowledge graph. Nodes are opaque "<type>:<key>" strings
// (see schema comment) so we don't need a rigid entity table per node type
// yet — that's the natural v2 once there's enough volume to justify real
// entity resolution (fuzzy-matching "John Smith" to "J. Smith LLC" etc.).

import { supabaseGet, supabasePost } from "./supabaseRest";

export function ownerNode(name) { return `owner:${name.trim().toLowerCase()}`; }
export function llcNode(name) { return `llc:${name.trim().toLowerCase()}`; }
export function neighborhoodNode(slug) { return `neighborhood:${slug}`; }
export function contractorNode(name) { return `contractor:${name.trim().toLowerCase()}`; }
export function propertyNode(propertyId) { return `property:${propertyId}`; }

export async function linkNodes({ fromNode, fromType, toNode, toType, relationshipType, propertyId, confidence = 1.0, source = "manual" }) {
  return supabasePost("property_relationships", [{
    from_node: fromNode, from_type: fromType, to_node: toNode, to_type: toType,
    relationship_type: relationshipType, property_id: propertyId ?? null,
    confidence, source,
  }], { headers: { Prefer: "return=representation,resolution=merge-duplicates" } });
}

// Convenience: property -> owner -> (optionally) LLC, in one call. This is
// the most common edge set to create whenever a property record gets an
// owner_name.
export async function linkOwnership({ propertyId, ownerName, isLlc = false, source = "manual" }) {
  if (!propertyId || !ownerName) return { ok: false, error: "propertyId and ownerName required" };
  const pNode = propertyNode(propertyId);
  const oNode = isLlc ? llcNode(ownerName) : ownerNode(ownerName);
  return linkNodes({
    fromNode: oNode, fromType: isLlc ? "llc" : "owner",
    toNode: pNode, toType: "property",
    relationshipType: "owns", propertyId, source,
  });
}

export async function linkContractorToPermit({ propertyId, contractorName, source = "crawler:permits" }) {
  if (!propertyId || !contractorName) return { ok: false, error: "propertyId and contractorName required" };
  return linkNodes({
    fromNode: contractorNode(contractorName), fromType: "contractor",
    toNode: propertyNode(propertyId), toType: "property",
    relationshipType: "performed_work_on", propertyId, source,
  });
}

// Pulls every edge touching a property (as either side) plus one hop out —
// e.g. property -> owner -> that owner's OTHER properties. This is what
// makes "find every property this LLC owns" a single query instead of a
// manual cross-reference.
export async function getPropertyGraph(propertyId) {
  const pNode = propertyNode(propertyId);
  const direct = await supabaseGet(
    `property_relationships?or=(from_node.eq.${encodeURIComponent(pNode)},to_node.eq.${encodeURIComponent(pNode)})&select=*`
  );
  if (!direct.ok) return direct;

  const neighborNodes = new Set();
  for (const edge of direct.data) {
    if (edge.from_node !== pNode) neighborNodes.add(edge.from_node);
    if (edge.to_node !== pNode) neighborNodes.add(edge.to_node);
  }

  let secondHop = [];
  if (neighborNodes.size) {
    const orClause = [...neighborNodes].map((n) => `from_node.eq.${encodeURIComponent(n)},to_node.eq.${encodeURIComponent(n)}`).join(",");
    const hop2 = await supabaseGet(`property_relationships?or=(${orClause})&select=*`);
    if (hop2.ok) secondHop = hop2.data.filter((e) => e.from_node !== pNode && e.to_node !== pNode);
  }

  return { ok: true, directEdges: direct.data, secondHopEdges: secondHop };
}
