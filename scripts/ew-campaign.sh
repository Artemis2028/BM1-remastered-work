#!/usr/bin/env bash
# Pinned-harness campaign driver for the EW timing protocol.
# Default: write/print the plan and exit.
# Finite campaign: 3 × A→B→C1→C2. Forced GC is never passed here (acceptance).
# Do NOT start the campaign until Fable authorizes it after the tagged review.
# After approval, one sequence at a time. Resume skips only complete valid
# receipts; dirty/unexpected worktrees and malformed receipts stop (no deletes).
set -euo pipefail

REPO="$(cd "$(dirname "$0")/.." && pwd)"
HARNESS="$REPO/scripts/ew-frame-benchmark.mjs"
LIB="$REPO/scripts/ew-bench-lib.mjs"
RESUME_CHECK="$REPO/scripts/ew-resume-check.mjs"
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
LIB_HASH="$(sha256sum "$LIB" | awk '{print $1}')"

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
plan.harness = {file: PROTOCOL.harnessFile, sha256: process.env.HARNESS_HASH, helperSha256: process.env.LIB_HASH, libSha256: process.env.LIB_HASH};
plan.freezeTag = PROTOCOL.freezeTag;
plan.freezeMoved = false;
plan.previousHarness = PROTOCOL.previousHarness;
plan.duration = PROTOCOL.duration;
plan.resume = {
  ...plan.resume,
  flag: '--sequence N',
  env: 'EW_CAMPAIGN_SEQUENCE',
  selected: process.env.SEQ_FILTER || null,
  interruptionsLog: `${process.env.STAMP || 'campaign-pending'}-interruptions.jsonl`
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
  echo "frozen for Fable final diff review — long campaign not started"
  echo "After authorization, one sequence: EW_CAMPAIGN_CONFIRMED=1 $0 --execute --sequence 1 [receipt-dir]"
  echo "Finite campaign is 3 × A→B→C1→C2 (~30 min timed sensor passes). Do not start it from this PR."
  exit 0
fi

if [[ "${EW_CAMPAIGN_CONFIRMED:-}" != "1" ]]; then
  echo "Refusing to execute the long campaign."
  echo "Protocol is frozen for Fable final diff review. Long campaign not started."
  echo "After authorization, set EW_CAMPAIGN_CONFIRMED=1 and pass --sequence N to run one sequence."
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

json_field() {
  python3 -c 'import json,sys; print(json.load(sys.stdin).get(sys.argv[1], ""))' "$1"
}

prepare_tree() {
  local label="$1" ref wt check action
  ref="$(label_ref "$label")"
  wt="$WT_ROOT/$label"
  set +e
  check="$(node "$RESUME_CHECK" worktree --path "$wt" --expected-sha "$ref")"
  local rc=$?
  set -e
  action="$(printf '%s\n' "$check" | json_field action)"
  if [[ "$action" == "reuse" ]]; then
    echo "reusing clean worktree $wt at $ref"
    return 0
  fi
  if [[ "$action" == "create" ]]; then
    git -C "$REPO" worktree add --detach "$wt" "$ref"
    return 0
  fi
  echo "$check" >&2
  echo "Stopping: worktree $wt is not reusable (dirty or unexpected SHA). Not force-deleting." >&2
  exit 3
}

# Leave worktrees in place for resume. Never git worktree remove --force / rm -rf.

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

expected_json() {
  local seq="$1" label="$2"
  python3 - "$seq" "$label" "$(label_ref "$label")" "$HARNESS_HASH" "$LIB_HASH" \
    "$PASS_WARMUP" "$PASS_SAMPLES" "$TICK_WARMUP" "$TICK_SAMPLES" <<'PY'
import json, sys
seq, label, sha, harness, helper, pw, ps, tw, ts = sys.argv[1:10]
print(json.dumps({
  "sequence": int(seq),
  "label": label,
  "treeSha": sha,
  "harnessSha256": harness,
  "helperSha256": helper,
  "passWarmup": int(pw),
  "passSamples": int(ps),
  "tickWarmup": int(tw),
  "tickSamples": int(ts),
  "passCadenceMs": 200,
  "diagnostics": False,
  "profiled": False,
  "starved": False,
  "gcPlacement": "none",
  "extraArgs": []
}))
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
    expected="$(expected_json "$seq" "$label")"
    if [[ -e "$dest" ]]; then
      set +e
      classify="$(node "$RESUME_CHECK" receipt --file "$dest" --expected "$expected")"
      local_rc=$?
      set -e
      action="$(printf '%s\n' "$classify" | json_field action)"
      status="$(printf '%s\n' "$classify" | json_field status)"
      if [[ "$action" == "skip" ]]; then
        echo "==> resume skip complete-valid $dest ($status)"
        log_event "$(python3 -c 'import json,sys; print(json.dumps({"event":"resume-skip","sequence":int(sys.argv[1]),"label":sys.argv[2],"file":sys.argv[3],"status":sys.argv[4],"classification":json.loads(sys.argv[5])}))' "$seq" "$label" "$dest" "$status" "$classify")"
        if [[ "$(printf '%s\n' "$classify" | json_field electronicsPassed)" == "False" ]]; then
          failed=1
        fi
        continue
      fi
      echo "$classify" >&2
      echo "Stopping: existing receipt $dest is $status. File preserved; not rerolling." >&2
      log_event "$(python3 -c 'import json,sys; print(json.dumps({"event":"resume-stop","sequence":int(sys.argv[1]),"label":sys.argv[2],"file":sys.argv[3],"status":sys.argv[4],"classification":json.loads(sys.argv[5])}))' "$seq" "$label" "$dest" "$status" "$classify")"
      exit 3
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
summary="$RECEIPT_DIR/${STAMP}-summary.json"
if [[ -f "$summary" ]]; then
  passed="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1])).get("campaignPassed"))' "$summary")"
  if [[ "$passed" != "True" ]]; then
    echo "campaignPassed is not true (missing/invalid/gate/cumulative)."
    failed=1
  fi
fi
exit "$failed"
