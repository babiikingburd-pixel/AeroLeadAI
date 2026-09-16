import type { SupabaseClient } from "@supabase/supabase-js";
import { runNativeRequirement, supportsNativeRequirement } from "./nativeWorkers";

export { supportsNativeRequirement };

type Context = {
  db: SupabaseClient;
  origin: string;
  profile: any;
  structure?: any;
  requirement: string;
};

type Result = {
  satisfied: boolean;
  provider: string;
  detail?: Record<string, unknown>;
};

async function resolvedImageryDate(ctx: Context): Promise<Result> {
  let dateResult = await runNativeRequirement({ ...ctx, requirement: "imagery_date" });
  if (dateResult.satisfied) return dateResult;
  const capture = await runNativeRequirement({ ...ctx, requirement: "imagery_capture" });
  if (!capture.satisfied) return capture;
  dateResult = await runNativeRequirement({ ...ctx, requirement: "imagery_date" });
  return dateResult;
}
export async function runSuperbRequirement(ctx: Context): Promise<Result> {
  if (ctx.requirement === "weather_history") {
    return runNativeRequirement({ ...ctx, requirement: "weather_history" });
  }
  if (ctx.requirement === "imagery_date") return resolvedImageryDate(ctx);
  if (ctx.requirement === "imagery_analysis") {
    const dateResult = await resolvedImageryDate(ctx);
    if (!dateResult.satisfied) return dateResult;
    return runNativeRequirement({ ...ctx, requirement: "imagery_analysis" });
  }
  return runNativeRequirement(ctx);
}
