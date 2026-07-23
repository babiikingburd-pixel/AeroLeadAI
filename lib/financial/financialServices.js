import { supabaseServer } from "../supabaseServer";

/**
 * #15 Financial Services
 *
 * getFinancialReport() is real and useful today — it reads your actual
 * jobs table, no Stripe needed. Everything else here (escrow, contractor
 * subscriptions, customer financing) genuinely requires a Stripe account
 * and, for financing, a separate BNPL lending partner — real money
 * movement isn't something to wire up speculatively. The `stripe` npm
 * package is deliberately NOT a dependency of this project yet; these
 * functions return `{available: false}` until STRIPE_SECRET_KEY exists,
 * at which point add the package and the real Stripe calls (shape is
 * documented inline below).
 */

const ESCROW_THRESHOLD_USD = 5000; // jobs over $5,000 would route through escrow, once Stripe is configured

export function requiresEscrow(amountUsd) {
  return amountUsd >= ESCROW_THRESHOLD_USD;
}

export async function chargeIntoEscrow({ jobId, amountUsd }) {
  if (!process.env.STRIPE_SECRET_KEY) {
    return { available: false, reason: "Stripe not configured — no charge was made. Add STRIPE_SECRET_KEY and the `stripe` package to enable." };
  }
  // Real implementation once configured:
  //   const stripe = new (await import("stripe")).default(process.env.STRIPE_SECRET_KEY);
  //   const intent = await stripe.paymentIntents.create({ amount: amountUsd * 100, currency: "usd", capture_method: "manual", metadata: { job_id: jobId } });
  //   await supabase.from("escrow_holds").insert({ job_id: jobId, payment_intent_id: intent.id, amount_cents: amountUsd * 100, status: "held" });
  throw new Error("Stripe configured but escrow charge not implemented — wire in the real Stripe call above.");
}

export async function releaseEscrow(jobId, { contractorAccountId, platformFeeUsd }) {
  if (!process.env.STRIPE_SECRET_KEY) return { available: false, reason: "Stripe not configured." };
  throw new Error("Stripe configured but escrow release not implemented — wire in the real Stripe call.");
}

export async function refundEscrow(jobId, reason) {
  if (!process.env.STRIPE_SECRET_KEY) return { available: false, reason: "Stripe not configured." };
  throw new Error("Stripe configured but escrow refund not implemented — wire in the real Stripe call.");
}

export async function createContractorSubscription({ contractorId, stripeCustomerId, priceId }) {
  if (!process.env.STRIPE_SECRET_KEY) return { available: false, reason: "Stripe not configured." };
  throw new Error("Stripe configured but subscription creation not implemented — wire in the real Stripe call.");
}

/** Customer financing — genuinely requires a BNPL/lending partner (Wisetack, Affirm, etc.). */
export async function offerFinancing({ amountUsd, customerId }) {
  if (!process.env.FINANCING_PARTNER_API_KEY) {
    return { available: false, reason: "No financing partner configured yet." };
  }
  throw new Error("Financing partner client not implemented — add your BNPL provider SDK call here once you have a merchant account.");
}

/** Financial reporting across the whole platform — real, uses jobs already in Supabase. */
export async function getFinancialReport({ startDate, endDate }) {
  const supabase = supabaseServer();
  if (!supabase) return { period: { startDate, endDate }, job_count: 0, message: "Supabase not configured." };
  const { data: jobs } = await supabase.from("jobs").select("*").gte("created_at", startDate).lte("created_at", endDate);
  const completed = (jobs || []).filter((j) => j.status === "completed");
  const grossRevenue = completed.reduce((s, j) => s + (j.revenue_actual || j.revenue_estimate || 0), 0);
  const { data: subs } = await supabase.from("subscriptions").select("*").eq("status", "active");

  return {
    period: { startDate, endDate },
    job_count: jobs?.length || 0,
    completed_job_count: completed.length,
    gross_revenue_usd: grossRevenue,
    active_subscriptions: subs?.length || 0,
  };
}
