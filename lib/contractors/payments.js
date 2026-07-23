import { supabaseServer } from "../supabaseServer";

// Real Stripe Connect charge + payout for a completed job: charges the
// homeowner's saved payment method, transfers the payout (minus the 12%
// platform fee) to the contractor's connected account, and logs it in
// escrow_holds (reused as a payment audit trail, not literally held funds
// here — status "released" records straight-through payment). Gated behind
// STRIPE_SECRET_KEY, same {available:false, reason} pattern as
// lib/financial/financialServices.js. `stripe` is a real dependency here
// (unlike financialServices.js's stubs) since this is the one payment path
// meant to actually run.
//
// Honest gap: nothing in this build collects the homeowner's card or walks
// a contractor through Connect onboarding — that's a Stripe Checkout /
// Connect onboarding flow you still need to wire up and point at
// jobs.stripe_customer_id / jobs.stripe_payment_method_id and
// contractors.stripe_account_id. Without those set, this returns a plain
// English reason instead of charging anything.
const PLATFORM_FEE_PCT = 0.12;

async function getStripe() {
  const { default: Stripe } = await import("stripe");
  return new Stripe(process.env.STRIPE_SECRET_KEY);
}

export async function chargeAndPayout(lead) {
  if (!process.env.STRIPE_SECRET_KEY) {
    return { available: false, reason: "Stripe not configured — add STRIPE_SECRET_KEY to enable payments." };
  }
  const supabase = supabaseServer();
  if (!supabase) return { available: false, reason: "Supabase not configured." };
  if (!lead.job_id) return { available: false, reason: "Lead has no linked job." };

  const { data: job } = await supabase.from("jobs").select("*, contractors(id, stripe_account_id, name)").eq("id", lead.job_id).maybeSingle();
  if (!job) return { available: false, reason: "Job not found." };

  const amountUsd = job.revenue_actual || job.revenue_estimate || lead.estimate_usd;
  if (!amountUsd || amountUsd <= 0) return { available: true, success: false, error: "No revenue amount set on the job." };
  if (!job.stripe_customer_id || !job.stripe_payment_method_id) {
    return { available: true, success: false, error: "No payment method on file for the homeowner — collect one (Stripe Checkout/SetupIntent) before PAY can run." };
  }
  const contractor = job.contractors;
  if (!contractor?.stripe_account_id) {
    return { available: true, success: false, error: "Contractor hasn't completed Stripe Connect onboarding yet." };
  }

  const amountCents = Math.round(amountUsd * 100);
  const feeCents = Math.round(amountCents * PLATFORM_FEE_PCT);
  const payoutCents = amountCents - feeCents;

  try {
    const stripe = await getStripe();
    const intent = await stripe.paymentIntents.create({
      amount: amountCents,
      currency: "usd",
      customer: job.stripe_customer_id,
      payment_method: job.stripe_payment_method_id,
      off_session: true,
      confirm: true,
      metadata: { job_id: job.id, lead_id: lead.id },
    });

    const transfer = await stripe.transfers.create({
      amount: payoutCents,
      currency: "usd",
      destination: contractor.stripe_account_id,
      transfer_group: `job_${job.id}`,
      metadata: { job_id: job.id, contractor_id: contractor.id },
    });

    await supabase.from("escrow_holds").insert({
      job_id: job.id,
      payment_intent_id: intent.id,
      amount_cents: amountCents,
      status: "released",
      transfer_id: transfer.id,
      released_at: new Date().toISOString(),
    });
    await supabase.from("jobs").update({ revenue_actual: amountUsd }).eq("id", job.id);

    return {
      available: true, success: true,
      payment_intent_id: intent.id, transfer_id: transfer.id,
      amount_usd: amountUsd, platform_fee_usd: feeCents / 100, contractor_payout_usd: payoutCents / 100,
    };
  } catch (e) {
    return { available: true, success: false, error: e?.message || "Stripe charge/payout failed." };
  }
}
