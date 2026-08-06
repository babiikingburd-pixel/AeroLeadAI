// lib/twincities/costGuard.js
//
// PAID-CALL BUDGET ENFORCEMENT
//
// The permit lookup is billed per request (Shovels.ai) and imagery is billed
// per tile on Nearmap. Before 10.1 nothing counted either one. Combined with a
// validation worker that retried failures forever, a single bad job could bill
// four lookups an hour indefinitely, and the only way to find out was the
// invoice.
//
// This module is the single gate every paid call goes through:
//
//   1. reserve()  — ask before spending. Returns { allowed } and the reason if
//                   not. Refuses when the provider is disabled, the daily cap
//                   is reached, or the global kill switch has tripped.
//   2. record()   — log what was actually spent, to worker_cost_events.
//   3. trip()     — flip the kill switch, automatically, the moment a cap is
//                   crossed. It stays tripped until a human clears it; a
//                   runaway that resets itself at midnight is still a runaway.
//
// Caps live in twincities_apex_controls so they are changeable without a
// redeploy, with env vars as the bootstrap default.

export const PAID_PROVIDERS = Object.freeze({
  PERMIT: "permit_lookup",
  IMAGERY: "imagery",
});

const DEFAULT_CAPS = Object.freeze({
  [PAID_PROVIDERS.PERMIT]: Number(process.env.PERMIT_DAILY_CALL_CAP ?? 500),
  [PAID_PROVIDERS.IMAGERY]: Number(process.env.IMAGERY_DAILY_CALL_CAP ?? 2000),
});

// Indicative unit costs, used only to report spend alongside call counts. Set
// from your actual contract; wrong numbers here never change enforcement,
// which counts calls.
const UNIT_COST_USD = Object.freeze({
  [PAID_PROVIDERS.PERMIT]: Number(process.env.PERMIT_UNIT_COST_USD ?? 0.05),
  [PAID_PROVIDERS.IMAGERY]: Number(process.env.IMAGERY_UNIT_COST_USD ?? 0.01),
});

function startOfUtcDay(now = new Date()) {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())).toISOString();
}

/** The controls row, with env defaults when the table has not been seeded. */
export async function loadControls(supabase) {
  const { data, error } = await supabase
    .from("twincities_apex_controls")
    .select("*")
    .eq("id", 1)
    .maybeSingle();
  if (error || !data) {
    return {
      enabled: true,
      paid_lookups_enabled: true,
      paid_lookups_disabled_at: null,
      paid_lookups_disabled_reason: null,
      permit_daily_call_cap: DEFAULT_CAPS[PAID_PROVIDERS.PERMIT],
      imagery_daily_call_cap: DEFAULT_CAPS[PAID_PROVIDERS.IMAGERY],
      _source: "defaults",
    };
  }
  return { ...data, _source: "database" };
}

function capFor(controls, provider) {
  const column =
    provider === PAID_PROVIDERS.PERMIT ? "permit_daily_call_cap" : "imagery_daily_call_cap";
  const configured = Number(controls?.[column]);
  return Number.isFinite(configured) && configured >= 0 ? configured : DEFAULT_CAPS[provider];
}

/** Calls already made today (UTC) for one provider. */
export async function spendToday(supabase, provider, since = startOfUtcDay()) {
  const { count, error } = await supabase
    .from("worker_cost_events")
    .select("id", { count: "exact", head: true })
    .eq("provider", provider)
    .eq("billable", true)
    .gte("created_at", since);
  if (error) throw new Error(`cost ledger unavailable: ${error.message}`);
  return Number(count || 0);
}

/**
 * Ask permission to make one paid call.
 *
 * Fails CLOSED: if the ledger cannot be read we refuse rather than spend blind.
 * That is the whole point — an unobservable spend is the failure mode this
 * exists to prevent.
 */
export async function reserve(supabase, provider, { controls = null, cost = 1 } = {}) {
  const cfg = controls ?? (await loadControls(supabase));

  if (cfg.paid_lookups_enabled === false) {
    return {
      allowed: false,
      reason: cfg.paid_lookups_disabled_reason || "paid lookups disabled",
      trippedAt: cfg.paid_lookups_disabled_at ?? null,
      cap: capFor(cfg, provider),
    };
  }

  const cap = capFor(cfg, provider);
  if (cap === 0) return { allowed: false, reason: `${provider} daily cap is 0`, cap, used: 0 };

  let used;
  try {
    used = await spendToday(supabase, provider);
  } catch (e) {
    return { allowed: false, reason: `refusing to spend without a ledger: ${e.message}`, cap };
  }

  if (used + cost > cap) {
    // Crossing the cap trips the switch for everything, not just this provider:
    // the caps exist to bound total spend, and a worker that has burned one
    // budget is exactly the worker about to burn the next.
    await trip(supabase, `${provider} daily cap reached (${used}/${cap})`);
    return { allowed: false, reason: `${provider} daily cap reached (${used}/${cap})`, cap, used };
  }

  return { allowed: true, cap, used, remaining: cap - used - cost };
}

/** Write one call to the ledger. Never throws — losing a log line must not fail the job. */
export async function record(supabase, provider, { worker, leadId, billable = true, ok = true, detail = null, units = 1 } = {}) {
  try {
    await supabase.from("worker_cost_events").insert({
      provider,
      worker_id: worker ?? null,
      lead_id: leadId != null ? String(leadId) : null,
      units,
      billable,
      ok,
      estimated_cost_usd: billable ? Number((UNIT_COST_USD[provider] ?? 0) * units) : 0,
      detail,
    });
  } catch {
    // Intentionally swallowed.
  }
}

/** Trip the global kill switch. Idempotent — an already-tripped switch keeps its original reason. */
export async function trip(supabase, reason) {
  try {
    await supabase
      .from("twincities_apex_controls")
      .update({
        paid_lookups_enabled: false,
        paid_lookups_disabled_at: new Date().toISOString(),
        paid_lookups_disabled_reason: reason,
        updated_at: new Date().toISOString(),
      })
      .eq("id", 1)
      .eq("paid_lookups_enabled", true);
  } catch {
    // Intentionally swallowed.
  }
}

/** Clear the kill switch. Deliberately has no automatic caller. */
export async function reset(supabase) {
  const { error } = await supabase
    .from("twincities_apex_controls")
    .update({
      paid_lookups_enabled: true,
      paid_lookups_disabled_at: null,
      paid_lookups_disabled_reason: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", 1);
  if (error) throw new Error(error.message);
}

/** Spend summary for /api/system-health. */
export async function costStatus(supabase) {
  const controls = await loadControls(supabase);
  const out = {
    paidLookupsEnabled: controls.paid_lookups_enabled !== false,
    disabledAt: controls.paid_lookups_disabled_at ?? null,
    disabledReason: controls.paid_lookups_disabled_reason ?? null,
    configSource: controls._source,
    providers: {},
  };
  for (const provider of Object.values(PAID_PROVIDERS)) {
    const cap = capFor(controls, provider);
    try {
      const used = await spendToday(supabase, provider);
      out.providers[provider] = {
        used,
        cap,
        remaining: Math.max(0, cap - used),
        estimatedCostUsd: Number((used * (UNIT_COST_USD[provider] ?? 0)).toFixed(2)),
      };
    } catch (e) {
      out.providers[provider] = { error: e.message, cap };
    }
  }
  return out;
}
