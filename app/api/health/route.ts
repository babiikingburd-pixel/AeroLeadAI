import { NextResponse } from "next/server";
import { createServiceClient } from "@/utils/supabase/server";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const supabase = createServiceClient();
    const { count, error } = await supabase
      .from("batch_leads")
      .select("*", { count: "exact", head: true });

    if (error) {
      return NextResponse.json({ status: "degraded", error: error.message }, { status: 503 });
    }

    return NextResponse.json({
      status: "ok",
      engine: "APEX 20.4",
      lead_count: count,
      checked_at: new Date().toISOString(),
    });
  } catch (err) {
    return NextResponse.json(
      { status: "down", error: (err as Error).message },
      { status: 503 }
    );
  }
}
