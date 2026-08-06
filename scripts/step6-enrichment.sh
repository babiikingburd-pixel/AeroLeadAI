#!/usr/bin/env bash
# scripts/step6-enrichment.sh — CLAUDE_CODE_HANDOFF.md Step 6, run end to end.
#
# Step 6 is "call these endpoints repeatedly with modest batch sizes until they
# say they are done." Doing that by hand is where it stalls: the storm backfill
# alone is ~31 chunks at 5,000 rows against 152,203 leads, and the priority
# worker is 25 leads a call.
#
# Usage:
#   ./scripts/step6-enrichment.sh <base-url> [stage]
#
#   ./scripts/step6-enrichment.sh https://aero-lead-ai.vercel.app          # all stages
#   ./scripts/step6-enrichment.sh https://aero-lead-ai.vercel.app 6a       # dry run only
#   PERMIT_BUDGET=200 ./scripts/step6-enrichment.sh https://... 6d         # bounded drain
#
# Stages: 6a dry-run | 6b storm backfill | 6c coverage | 6d priority drain |
#         6e gap-router preview | all (default, and it stops before 6e commits)
#
# PRECONDITION: APEX 10.1 must be the deployed build. 6d spends a billed permit
# lookup per lead, and the cost guard that bounds it (lib/twincities/costGuard.js)
# only exists in 10.1. Check before running:
#     curl -s <base-url>/api/apex-status | grep -o '"version":"[^"]*"'
# Anything below 10.1 means an unbounded drain — deploy first.

set -uo pipefail

BASE="${1:-}"
STAGE="${2:-all}"
[ -z "$BASE" ] && { echo "usage: $0 <base-url> [6a|6b|6c|6d|6e|all]" >&2; exit 2; }
BASE="${BASE%/}"

STORM_YEAR="${STORM_YEAR:-2025}"
STORM_RADIUS="${STORM_RADIUS:-3}"
CHUNK="${CHUNK:-5000}"
PERMIT_BUDGET="${PERMIT_BUDGET:-100}"   # max leads to drain in 6d
PERMIT_BATCH="${PERMIT_BATCH:-25}"
PAUSE="${PAUSE:-2}"                      # seconds between calls; respects the 60/min limiter

hdr=(-H "Content-Type: application/json")
[ -n "${CRON_SECRET:-}" ] && hdr+=(-H "Authorization: Bearer ${CRON_SECRET}")

say() { printf '\n\033[1m== %s\033[0m\n' "$*"; }
post() { curl -sS --max-time 300 -X POST "${hdr[@]}" -d "$2" "$BASE$1"; }
get()  { curl -sS --max-time 120 "${hdr[@]}" "$BASE$1"; }
jqr()  { command -v jq >/dev/null && jq -r "$1" || cat; }

preflight() {
  say "Preflight"
  local v
  v=$(get /api/apex-status | jqr '.version // "unknown"')
  echo "deployed APEX version: $v"
  case "$v" in
    10.1|10.[2-9]*|1[1-9]*) echo "cost guard present — 6d is bounded." ;;
    *) echo "WARNING: deployed build is '$v', not 10.1+. 6d would spend permit"
       echo "         credits with no cost guard. Deploy 10.1 first."
       [ "$STAGE" = "6d" ] || [ "$STAGE" = "all" ] && {
         read -r -p "Continue anyway? [y/N] " a; [ "$a" = "y" ] || exit 1; } ;;
  esac
  get /api/system-health | jqr '.checks[] | select(.name|test("Supabase|Paid-lookup")) | "\(.name): \(.detail)"'
}

stage_6a() {
  say "6a — storm backfill DRY RUN (year=$STORM_YEAR)"
  local out found
  out=$(post /api/enrich/storm-backfill \
    "{\"year\":$STORM_YEAR,\"dryRun\":true,\"radiusMiles\":$STORM_RADIUS,\"limit\":$CHUNK,\"offset\":0}")
  echo "$out" | jqr '{ok,eventsFound,matched,note}'
  found=$(echo "$out" | jqr '.eventsFound // 0')
  if [ "$found" = "0" ] || [ "$found" = "null" ]; then
    echo "eventsFound=0 for $STORM_YEAR — retrying $((STORM_YEAR-1)) per the handoff."
    STORM_YEAR=$((STORM_YEAR-1))
    post /api/enrich/storm-backfill \
      "{\"year\":$STORM_YEAR,\"dryRun\":true,\"radiusMiles\":$STORM_RADIUS,\"limit\":$CHUNK,\"offset\":0}" \
      | jqr '{ok,eventsFound,matched,note}'
  fi
  echo "storm year for 6b: $STORM_YEAR"
}

stage_6b() {
  say "6b — storm backfill, chunked (year=$STORM_YEAR, chunk=$CHUNK)"
  local offset=0 n=0 out note next
  while :; do
    n=$((n+1))
    out=$(post /api/enrich/storm-backfill \
      "{\"year\":$STORM_YEAR,\"radiusMiles\":$STORM_RADIUS,\"limit\":$CHUNK,\"offset\":$offset}")
    note=$(echo "$out" | jqr '.note // ""')
    next=$(echo "$out" | jqr '.nextOffset // empty')
    printf 'chunk %-3s offset=%-7s %s\n' "$n" "$offset" \
      "$(echo "$out" | jqr '"matched=\(.matched // 0) updated=\(.updated // 0)"')"
    case "$note" in *"Reached end of table"*) echo "done: $note"; break ;; esac
    [ -z "$next" ] || [ "$next" = "null" ] && { echo "no nextOffset — stopping. Last response:"; echo "$out" | head -c 600; break; }
    [ "$next" = "$offset" ] && { echo "nextOffset did not advance — stopping to avoid a loop."; break; }
    offset="$next"
    sleep "$PAUSE"
  done
}

stage_6c() {
  say "6c — coverage check"
  get /api/data-coverage | jqr '.'
  echo
  echo "hail/wind/storm_date must be non-zero here. If they are still 0 after 6b,"
  echo "stop and investigate before spending permit credits in 6d."
}

stage_6d() {
  say "6d — priority worker drain (budget=$PERMIT_BUDGET leads, batch=$PERMIT_BATCH)"
  local done_n=0 out halted
  while [ "$done_n" -lt "$PERMIT_BUDGET" ]; do
    out=$(post /api/enrich/priority-worker "{\"limit\":$PERMIT_BATCH}")
    halted=$(echo "$out" | jqr '.halted // false')
    if [ "$halted" = "true" ]; then
      echo "COST GUARD TRIPPED — worker refused: $(echo "$out" | jqr '.reason')"
      echo "Clear it deliberately once you understand the cause; it does not self-reset."
      break
    fi
    echo "$out" | jqr '"processed=\(.results|length // 0) gated_out=\(.summary.gated_out_before_imagery // 0) dropped=\(.summary.dropped_after_permit_check // 0)"'
    [ "$(echo "$out" | jqr '.results|length // 0')" = "0" ] && { echo "queue empty."; break; }
    done_n=$((done_n+PERMIT_BATCH))
    sleep "$PAUSE"
  done
  echo "leads attempted: $done_n"
  echo "Leads dropping on a recent roof permit is CORRECT — not a bug."
}

stage_6e() {
  say "6e — gap router PREVIEW (no commit)"
  get "/api/enrich/gap-router?limit=500" | jqr '.'
  echo
  echo "Review the routing above. To apply it, run deliberately:"
  echo "  curl -X POST ${hdr[*]} -d '{\"commit\":true,\"limit\":500}' $BASE/api/enrich/gap-router"
}

preflight
case "$STAGE" in
  6a) stage_6a ;;
  6b) stage_6b ;;
  6c) stage_6c ;;
  6d) stage_6d ;;
  6e) stage_6e ;;
  all) stage_6a; stage_6b; stage_6c; stage_6d; stage_6e ;;
  *) echo "unknown stage: $STAGE" >&2; exit 2 ;;
esac
say "Step 6 finished (stage: $STAGE)"
