#!/usr/bin/env bash
# Pinned-harness campaign driver for the EW timing protocol.
# Default: write/print the plan and exit.
# Do NOT start the long ≥1000-pass campaign until Fable approves the protocol.
set -euo pipefail

REPO="$(cd "$(dirname "$0")/.." && pwd)"
HARNESS="$REPO/scripts/ew-frame-benchmark.mjs"
RECEIPT_DIR="${1:-$REPO/docs/ew/receipts}"
if [[ "${1:-}" == "--plan" || "${1:-}" == "--execute" ]]; then
  RECEIPT_DIR="${2:-$REPO/docs/ew/receipts}"
fi
STAMP="${EW_RECEIPT_STAMP:-campaign-pending}"
MODE="${EW_CAMPAIGN_MODE:-}"
if [[ "${1:-}" == "--plan" ]]; then MODE=plan; fi
if [[ "${1:-}" == "--execute" ]]; then MODE=execute; fi
if [[ -z "$MODE" ]]; then MODE=plan; fi

mkdir -p "$RECEIPT_DIR"

TREE_A="${TREE_A:-6958f08e73aff55efbf48bae3f9433e5acc270e8}"
TREE_B="${TREE_B:-e7aa3c594e4799c54d48e2eeac37a2a1acf36b9b}"
TREE_C1="${TREE_C1:-74caf837c7882a86e3bd7c74f083029453953c1a}"
TREE_C2="${TREE_C2:-51738caf3a1d88492c4fc48a7c0125d4a7e2a355}"
TREE_F="${TREE_F:-077a9cedaa5a6cb858b200addb115d862ab238e6}"
WITH_FREEZE="${WITH_FREEZE:-1}"
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
  PASS_SAMPLES="$PASS_SAMPLES" node --input-type=module <<'JS'
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
  echo "Re-run with: EW_CAMPAIGN_CONFIRMED=1 $0 --execute [receipt-dir]"
  echo "after Fable approves docs/ew/BENCHMARK-PROTOCOL.md."
  exit 0
fi

if [[ "${EW_CAMPAIGN_CONFIRMED:-}" != "1" ]]; then
  echo "Refusing to execute the long campaign."
  echo "Protocol is awaiting Fable review. Long campaign not started."
  echo "After approval, set EW_CAMPAIGN_CONFIRMED=1."
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

failed=0
for seq in $(seq 1 "$REPS"); do
  for label in "${ORDER[@]}"; do
    dest="$RECEIPT_DIR/${STAMP}-seq${seq}-${label}.json"
    echo "==> sequence $seq $label $(label_ref "$label")"
    set +e
    node "$HARNESS" --root "$WT_ROOT/$label" --passes \
      --tree-label "$label" --sequence "$seq" \
      --pass-warmup "$PASS_WARMUP" --pass-samples "$PASS_SAMPLES" \
      --tick-warmup "$TICK_WARMUP" --tick-samples "$TICK_SAMPLES" \
      --record-samples \
      | tee "$dest"
    rc=${PIPESTATUS[0]}
    set -e
    if [[ $rc -ne 0 ]]; then
      echo "harness exit $rc for seq $seq $label (receipts kept)"
      failed=1
    fi
  done
done

node "$REPO/scripts/ew-bench-report.mjs" "$RECEIPT_DIR" "$STAMP"
exit "$failed"
