#!/usr/bin/env bash
# Pinned-harness campaign driver for the EW timing protocol.
# Default: write/print the plan and exit.
# Finite campaign: 3 × A→B→C1→C2. Forced GC is never passed here (acceptance).
# Do NOT start the campaign until Fable approves the protocol.
# After approval, one sequence at a time; existing raw files are kept/skipped.
set -euo pipefail

REPO="$(cd "$(dirname "$0")/.." && pwd)"
HARNESS="$REPO/scripts/ew-frame-benchmark.mjs"
RECEIPT_DIR="$REPO/docs/ew/receipts"
STAMP="${EW_RECEIPT_STAMP:-campaign-pending}"
MODE=plan
SEQ_FILTER="${EW_CAMPAIGN_SEQUENCE:-}"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --plan) MODE=plan; shift ;;
    --execute) MODE=execute; shift ;;
    --sequence) SEQ_FILTER="${2:-}"; shift 2 ;;
    --) shift; break ;;
    -*) echo "unknown flag $1" >&2; exit 2 ;;
    *) RECEIPT_DIR="$1"; shift ;;
  esac
done

mkdir -p "$RECEIPT_DIR"

TREE_A="${TREE_A:-6958f08e73aff55efbf48bae3f9433e5acc270e8}"
TREE_B="${TREE_B:-e7aa3c594e4799c54d48e2eeac37a2a1acf36b9b}"
TREE_C1="${TREE_C1:-74caf837c7882a86e3bd7c74f083029453953c1a}"
TREE_C2="${TREE_C2:-51738caf3a1d88492c4fc48a7c0125d4a7e2a355}"
TREE_F="${TREE_F:-077a9cedaa5a6cb858b200addb115d862ab238e6}"
WITH_FREEZE="${WITH_FREEZE:-0}"
REPS="${EW_CAMPAIGN_REPS:-3}"
PASS_SAMPLES="${EW_PASS_SAMPLES:-1000}"
PASS_WARMUP="${EW_PASS_WARMUP:-50}"
TICK_SAMPLES="${EW_TICK_SAMPLES:-3600}"
TICK_WARMUP="${EW_TICK_WARMUP:-600}"

HARNESS_HASH="$(sha256sum "$HARNESS" | awk '{print $1}')"
LIB_HASH="$(sha256sum "$REPO/scripts/ew-bench-lib.mjs" | awk '{print $1}')"

PLAN_JSON="$(
  cd "$REPO"
  WITH_FREEZE="$WITH_FREEZE" REPS="$REPS" HARNESS_HASH="$HARNESS_HASH" LIB_HASH="$LIB_HASH" \
  TREE_A="$TREE_A" TREE_B="$TREE_B" TREE_C1="$TREE_C1" TREE_C2="$TREE_C2" TREE_F="$TREE_F" \
  PASS_SAMPLES="$PASS_SAMPLES" SEQ_FILTER="$SEQ_FILTER" STAMP="$STAMP" node --input-type=module <<'JS'
import {campaignPlan, PROTOCOL} from './scripts/ew-bench-lib.mjs';
const plan = campaignPlan({withFreeze: process.env.WITH_FREEZE !== '0', repetitions: Number(process.env.REPS)});
plan.trees = {
  A: process.env.TREE_A,
  B: process.env.TREE_B,
  C1: process.env.TREE_C1,
  C2: process.env.TREE_C2,
  F: process.env.TREE_F
};
plan.measured.passSamples = Number(process.env.PASS_SAMPLES);
plan.harness = {file: PROTOCOL.harnessFile, sha256: process.env.HARNESS_HASH, libSha256: process.env.LIB_HASH};
plan.freezeTag = PROTOCOL.freezeTag;
plan.freezeMoved = false;
plan.previousHarness = PROTOCOL.previousHarness;
plan.duration = PROTOCOL.duration;
plan.resume = {
  flag: '--sequence N',
  env: 'EW_CAMPAIGN_SEQUENCE',
  selected: process.env.SEQ_FILTER || null,
  keepEveryRawFile: true,
  skipExistingReceipts: true,
  interruptionsLog: `${process.env.STAMP || 'campaign-pending'}-interruptions.jsonl`,
  note: 'Resume the same --sequence N after a stop. Existing seqN-*.json files are kept and skipped. Append interruptions to the JSONL log. Do not pass --diagnostics on acceptance.'
};
plan.acceptanceNeverPassesDiagnostics = true;
console.log(JSON.stringify(plan, null, 2));
JS
)"

echo "$PLAN_JSON" > "$RECEIPT_DIR/${STAMP}-plan.json"
echo "Wrote $RECEIPT_DIR/${STAMP}-plan.json"
echo "Harness sha256 $HARNESS_HASH"
echo "Lib sha256 $LIB_HASH"

if [[ "$MODE" != "execute" ]]; then
  echo
  echo "awaiting Fable protocol review — long campaign not started"
  echo "After approval, one sequence: EW_CAMPAIGN_CONFIRMED=1 $0 --execute --sequence 1 [receipt-dir]"
  echo "Finite campaign is 3 × A→B→C1→C2 (~30 min timed sensor passes). Do not start it from this PR."
  exit 0
fi

if [[ "${EW_CAMPAIGN_CONFIRMED:-}" != "1" ]]; then
  echo "Refusing to execute the long campaign."
  echo "Protocol is awaiting Fable review. Long campaign not started."
  echo "After approval, set EW_CAMPAIGN_CONFIRMED=1 and pass --sequence N to run one sequence."
  exit 2
fi

label_ref() {
  case "$1" in
    A) echo "$TREE_A" ;;
    B) echo "$TREE_B" ;;
    C1) echo "$TREE_C1" ;;
    C2) echo "$TREE_C2" ;;
    F) echo "$TREE_F" ;;
    *) echo "unknown label $1" >&2; return 1 ;;
  esac
}

WT_ROOT="${EW_WORKTREE_ROOT:-/tmp/ew-campaign-trees}"
mkdir -p "$WT_ROOT"

prepare_tree() {
  local label="$1" ref
  ref="$(label_ref "$label")"
  local wt="$WT_ROOT/$label"
  git -C "$REPO" worktree remove --force "$wt" 2>/dev/null || true
  rm -rf "$wt"
  git -C "$REPO" worktree add --detach "$wt" "$ref"
}

cleanup_trees() {
  for label in A B C1 C2 F; do
    git -C "$REPO" worktree remove --force "$WT_ROOT/$label" 2>/dev/null || true
  done
}

trap cleanup_trees EXIT

ORDER=(A B C1 C2)
if [[ "$WITH_FREEZE" != "0" ]]; then ORDER+=(F); fi
for label in "${ORDER[@]}"; do prepare_tree "$label"; done

log_event() {
  python3 - "$RECEIPT_DIR/${STAMP}-interruptions.jsonl" "$1" <<'PY'
import json, sys, datetime
path, payload = sys.argv[1], json.loads(sys.argv[2])
payload["at"] = datetime.datetime.now(datetime.timezone.utc).isoformat()
with open(path, "a", encoding="utf-8") as f:
    f.write(json.dumps(payload) + "\n")
PY
}

failed=0
for seq in $(seq 1 "$REPS"); do
  if [[ -n "$SEQ_FILTER" && "$seq" != "$SEQ_FILTER" ]]; then
    echo "==> skip sequence $seq (running --sequence $SEQ_FILTER only; prior/other raw files kept)"
    log_event "{\"event\":\"skip-sequence\",\"sequence\":$seq,\"reason\":\"filter\"}"
    continue
  fi
  log_event "{\"event\":\"sequence-start\",\"sequence\":$seq,\"order\":$(printf '%s\n' "${ORDER[@]}" | python3 -c 'import json,sys; print(json.dumps([l.strip() for l in sys.stdin if l.strip()]))')}"
  for label in "${ORDER[@]}"; do
    dest="$RECEIPT_DIR/${STAMP}-seq${seq}-${label}.json"
    if [[ -s "$dest" ]]; then
      echo "==> resume keep $dest"
      log_event "{\"event\":\"resume-keep\",\"sequence\":$seq,\"label\":\"$label\",\"file\":\"$dest\"}"
      continue
    fi
    echo "==> sequence $seq $label $(label_ref "$label") -> $dest"
    log_event "{\"event\":\"run-start\",\"sequence\":$seq,\"label\":\"$label\",\"file\":\"$dest\"}"
    set +e
    # Acceptance only: never --diagnostics, never --gc-placement, never expose-gc.
    node "$HARNESS" --root "$WT_ROOT/$label" --passes \
      --tree-label "$label" --sequence "$seq" \
      --pass-warmup "$PASS_WARMUP" --pass-samples "$PASS_SAMPLES" \
      --tick-warmup "$TICK_WARMUP" --tick-samples "$TICK_SAMPLES" \
      | tee "$dest"
    rc=${PIPESTATUS[0]}
    set -e
    if [[ $rc -ne 0 ]]; then
      echo "harness exit $rc for seq $seq $label (receipts kept)"
      log_event "{\"event\":\"run-fail\",\"sequence\":$seq,\"label\":\"$label\",\"file\":\"$dest\",\"exit\":$rc}"
      failed=1
    else
      log_event "{\"event\":\"run-complete\",\"sequence\":$seq,\"label\":\"$label\",\"file\":\"$dest\"}"
    fi
  done
  log_event "{\"event\":\"sequence-end\",\"sequence\":$seq}"
done

node "$REPO/scripts/ew-bench-report.mjs" "$RECEIPT_DIR" "$STAMP"
exit "$failed"
