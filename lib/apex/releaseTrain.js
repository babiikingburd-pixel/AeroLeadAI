export const APEX_RELEASES = [
  { version: '9.0', name: 'Foundation', status: 'baseline', capabilities: ['Android/Termux builder', 'Windows installer', 'doctor + production build gates', 'existing property intelligence stack'] },
  { version: '9.1', name: 'Evidence Fusion', status: 'active', capabilities: ['canonical evidence records', 'confidence + freshness', 'source provenance', 'explainable score contributions'] },
  { version: '9.2', name: 'Validation Accelerator', status: 'active', capabilities: ['progressive validation', 'deduplication fingerprints', 'batch prioritization', 'throughput/latency telemetry'] },
  { version: '9.3', name: 'Acquisition Network', status: 'active', capabilities: ['source registry', 'source health', 'crawler jobs', 'retry/backoff + provenance'] },
  { version: '9.4', name: 'Safe Self-Improvement', status: 'active', capabilities: ['sandbox experiments', 'baseline vs candidate evaluation', 'approval gates', 'audit trail'] },
  { version: '9.5', name: 'Conversion Intelligence', status: 'active', capabilities: ['opportunity scoring', 'contactability', 'conversion outcomes', 'lead feedback loop'] },
  { version: '9.6', name: 'Mission Control', status: 'active', capabilities: ['unified operating dashboard', 'release health', 'pipeline telemetry', 'self-install/build controls', 'closed-loop learning visibility'] },
  { version: '9.7', name: 'Evidence Gate', status: 'active', capabilities: ['retrieval vs. review separated', 'per-dimension evidence status', 'validation job queue', 'score history ledger'] },
  { version: '9.9', name: 'Evidence Fusion', status: 'active', capabilities: ['corroboration-gated fusion score', 'evidence quality vs. lead quality split', 'challenger promotion queue', 'fusion event audit trail'] },
  { version: '10.0', name: 'Autonomous Governance', status: 'release', capabilities: ['server-side global ranking over all leads', 'promotion streak stability gate', 'promote/demote/hold decision log', 'cycle telemetry'] },
];

// Read by /apex and /api/apex-status. Kept in step with package.json —
// scripts/apex-release-check.mjs asserts the package version, and Mission
// Control was reporting 9.6 against a 1.10.0-apex10.0 build.
export const APEX_VERSION = '10.0';

export function scoreOpportunity({ damageProbability=0, propertyValue=0, serviceFit=0, contactability=0, conversionProbability=0, confidence=0, freshness=0 } = {}) {
  const values = [damageProbability, propertyValue, serviceFit, contactability, conversionProbability, confidence, freshness].map(v => Math.max(0, Math.min(100, Number(v) || 0)));
  const [d, v, s, c, x, q, f] = values;
  return Math.round((d*.25)+(v*.15)+(s*.10)+(c*.15)+(x*.15)+(q*.10)+(f*.10));
}

export function evidenceConfidence({ sourceQuality=0, freshness=0, completeness=0, agreement=0 } = {}) {
  return Math.round((Math.max(0,Math.min(100,sourceQuality))*.30)+(Math.max(0,Math.min(100,freshness))*.20)+(Math.max(0,Math.min(100,completeness))*.30)+(Math.max(0,Math.min(100,agreement))*.20));
}
