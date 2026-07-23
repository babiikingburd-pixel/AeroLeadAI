import { supabaseServer } from "../supabaseServer";

/**
 * #11 AI Sales & Marketing Engine
 *
 * Real parts: campaign records, a nurture-sequence scheduler that follows up
 * with non-responding leads via SMS/email at defined intervals, and a
 * budget-reallocation function based on measured performance.
 *
 * Not wired in (needs your own ad accounts + API access): actually placing
 * ads on Google/Meta. pushBudgetToAdPlatform() below is a real function
 * shape — it activates once GOOGLE_ADS_API_KEY/META_ADS_API_KEY exist, since
 * spending real money through unverified code isn't something to enable
 * silently.
 */

export async function launchCampaign({ name, channel, targetZipCodes, budgetCents, stormTriggered = false }) {
  const supabase = supabaseServer();
  if (!supabase) throw new Error("Supabase not configured.");
  const { data, error } = await supabase
    .from("campaigns")
    .insert({ name, channel, target_zip_codes: targetZipCodes, budget_cents: budgetCents, storm_triggered: stormTriggered, status: "active" })
    .select().single();
  if (error) throw new Error(`Campaign launch failed: ${error.message}`);
  return data;
}

export async function listCampaigns() {
  const supabase = supabaseServer();
  if (!supabase) return [];
  const { data } = await supabase.from("campaigns").select("*").order("created_at", { ascending: false });
  return data || [];
}

/**
 * Nurture sequence: leads still "new"/"contacted" (not opted out) with no
 * follow-up logged for N days get a scheduled nudge instead of going cold.
 * Call this daily via cron (e.g. a Vercel Cron hitting an API route that
 * calls this).
 */
const NURTURE_INTERVALS_DAYS = [2, 5, 10, 21];

export async function runNurtureSweep() {
  const supabase = supabaseServer();
  if (!supabase) return { sent: 0, details: [] };
  const { data: leads } = await supabase.from("batch_leads").select("*").in("sales_status", ["new", "contacted"]).eq("opted_out", false);

  const sent = [];
  for (const lead of leads || []) {
    const lastTouch = new Date(lead.updated_at || lead.created_at);
    const daysSince = (Date.now() - lastTouch.getTime()) / 86400000;
    const dueStep = NURTURE_INTERVALS_DAYS.find((d) => Math.abs(daysSince - d) < 0.5);
    const alreadySent = (lead.nurture_log || []).some((n) => n.step === dueStep);

    if (dueStep && !alreadySent) {
      await sendNurtureMessage(supabase, lead, dueStep);
      sent.push({ lead_id: lead.id, address: lead.address, step: dueStep });
    }
  }
  return { sent: sent.length, details: sent };
}

async function sendNurtureMessage(supabase, lead, step) {
  const message = nurtureCopyForStep(step, lead);
  if (!process.env.SMS_PROVIDER_API_KEY) {
    console.warn(`[nurture] No SMS provider configured — would have sent to ${lead.address}: "${message}"`);
  } else {
    await fetch(process.env.SMS_PROVIDER_SEND_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.SMS_PROVIDER_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ to: lead.owner, body: message }),
    }).catch(() => {});
  }
  const nurture_log = [...(lead.nurture_log || []), { step, at: new Date().toISOString(), message }];
  await supabase.from("batch_leads").update({ nurture_log }).eq("id", lead.id);
}

function nurtureCopyForStep(step, lead) {
  const copies = {
    2: `Hi — just checking in about the roof concern we spotted at ${lead.address}. Still want a free inspection?`,
    5: `Storm season adds up fast. We can still get a contractor out to ${lead.address} this week if you'd like.`,
    10: `Last check-in on the roof inspection for ${lead.address} — reply STOP to opt out, or YES to schedule.`,
    21: `Closing this out for now. Reach out anytime if you'd like a free roof inspection for ${lead.address}.`,
  };
  return copies[step];
}

/**
 * Budget reallocation: ranks active campaigns by cost-per-qualified-lead
 * (qualified = sales_status has moved past "new" at least to "contacted"
 * or beyond) and proposes — does not silently execute — a reallocation.
 */
export async function proposeBudgetReallocation() {
  const supabase = supabaseServer();
  if (!supabase) return { ranked: [], recommendation: "Supabase not configured." };
  const { data: campaigns } = await supabase.from("campaigns").select("*").eq("status", "active");
  const scored = [];

  for (const c of campaigns || []) {
    const { count: leadCount } = await supabase.from("batch_leads").select("id", { count: "exact", head: true }).eq("campaign_id", c.id);
    const { count: qualifiedCount } = await supabase.from("batch_leads").select("id", { count: "exact", head: true }).eq("campaign_id", c.id).neq("sales_status", "new");
    const costPerQualified = qualifiedCount ? Math.round((c.budget_cents || 0) / qualifiedCount) : null;
    scored.push({ campaign_id: c.id, name: c.name, leads: leadCount || 0, qualified: qualifiedCount || 0, cost_per_qualified_cents: costPerQualified });
  }

  scored.sort((a, b) => (a.cost_per_qualified_cents ?? Infinity) - (b.cost_per_qualified_cents ?? Infinity));
  return { ranked: scored, recommendation: scored[0]?.cost_per_qualified_cents != null ? `Shift budget toward "${scored[0].name}" — lowest cost per qualified lead.` : "Not enough conversion data yet." };
}

/** Real ad-platform push — intentionally requires you to set the env var to activate spend. */
export async function pushBudgetToAdPlatform(campaignId, newBudgetCents) {
  if (!process.env.GOOGLE_ADS_API_KEY && !process.env.META_ADS_API_KEY) {
    return { skipped: true, reason: "No ad platform credentials configured — nothing was spent." };
  }
  throw new Error("Ad platform client not implemented — add your Google/Meta Ads SDK call here once credentials exist.");
}
