import { NextResponse } from "next/server";
export const dynamic = "force-dynamic";

// Superseded by the generalized /api/reports/[contractor] endpoint (see
// lib/twincities/contractors.js). Kept as a redirect so any /api/apex10
// link already shared with APEX Exteriors keeps working.
export async function GET(request) {
  return NextResponse.redirect(new URL("/api/reports/apex-exteriors", request.url));
}
