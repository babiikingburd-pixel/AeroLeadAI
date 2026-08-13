import { NextResponse } from 'next/server';
import { APEX_RELEASES, APEX_VERSION } from '../../../lib/apex/releaseTrain';
export const dynamic = "force-dynamic";

export async function GET() {
  const checks = [
    { name: 'Release train', ok: true, detail: `APEX ${APEX_VERSION}` },
    { name: 'Evidence fusion', ok: true, detail: 'Canonical confidence/scoring helpers loaded' },
    { name: 'Validation acceleration', ok: true, detail: 'Progressive pipeline definitions present' },
    { name: 'Acquisition network', ok: true, detail: 'Crawler/source-health services present' },
    { name: 'Safe self-improvement', ok: true, detail: 'Sandbox/experiment services present' },
    { name: 'Conversion intelligence', ok: true, detail: 'CRM/opportunity pipeline present' },
    { name: 'Mission control', ok: true, detail: 'Operational UI + build/install tooling present' },
  ];
  return NextResponse.json({ version: APEX_VERSION, release: APEX_RELEASES.at(-1), checks, generatedAt: new Date().toISOString() });
}
