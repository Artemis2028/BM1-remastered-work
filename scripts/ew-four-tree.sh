#!/usr/bin/env bash
# One pinned harness against the four pinned EW review trees (historical
# 300-sample helper). The ≥1000-pass interleaved campaign is specified in
# docs/ew/BENCHMARK-PROTOCOL.md and driven by scripts/ew-campaign.sh --plan.
# Do not start that campaign from this script.
# Usage: scripts/ew-four-tree.sh [receipt-dir]
set -euo pipefail

REPO="$(cd "$(dirname "$0")/.." && pwd)"
HARNESS="$REPO/scripts/ew-frame-benchmark.mjs"
RECEIPT_DIR="${1:-$REPO/docs/ew/receipts}"
STAMP="${EW_RECEIPT_STAMP:-authority-20260913}"
mkdir -p "$RECEIPT_DIR"

TREE_A="${TREE_A:-6958f08e73aff55efbf48bae3f9433e5acc270e8}"
TREE_B="${TREE_B:-e7aa3c594e4799c54d48e2eeac37a2a1acf36b9b}"
TREE_C1="${TREE_C1:-74caf837c7882a86e3bd7c74f083029453953c1a}"
TREE_C2="${TREE_C2:-$(git -C "$REPO" rev-parse HEAD)}"

HARNESS_HASH="$(sha256sum "$HARNESS" | awk '{print $1}')"
COMMANDS="$RECEIPT_DIR/${STAMP}-commands.txt"

cat > "$COMMANDS" <<EOF
# Rerunnable four-tree full-workload timing
# Host class: supplementary unless cpu matches Platinum 8573C
# Pinned harness: $HARNESS
# Harness sha256: $HARNESS_HASH
# Pinned trees:
#   A  pre-sensor / OPS     $TREE_A
#   B  sensors              $TREE_B
#   C1 noise/ECCM           $TREE_C1
#   C2 review tip           $TREE_C2
# Unchanged 2/4 gate: electronicsPass = updatePowerSystems + updateSensorSystems
#   (Platinum recorded this series as detectionPass: 2.50 / 6.90, failed)
# Also report: detection-pass, updateMs, whole-frame tick, seekerCPU
# Increments: EW−sensors and EW−pre-sensor; cumulative tick vs A <= 2ms
# Pre-sensor + --passes must report sensor-pass metrics as not applicable, never zero.

HARNESS=$HARNESS
RECEIPT_DIR=$RECEIPT_DIR
STAMP=$STAMP

git -C $REPO worktree add --detach /tmp/ew-authority-tree-a $TREE_A
node \$HARNESS --root /tmp/ew-authority-tree-a --passes > \$RECEIPT_DIR/\${STAMP}-presensor.json

git -C $REPO worktree add --detach /tmp/ew-authority-tree-b $TREE_B
node \$HARNESS --root /tmp/ew-authority-tree-b --passes > \$RECEIPT_DIR/\${STAMP}-sensors.json

git -C $REPO worktree add --detach /tmp/ew-authority-tree-c1 $TREE_C1
node \$HARNESS --root /tmp/ew-authority-tree-c1 --passes > \$RECEIPT_DIR/\${STAMP}-commit1.json

node \$HARNESS --root $REPO --passes > \$RECEIPT_DIR/\${STAMP}-ew-tip.json
EOF

echo "Wrote $COMMANDS"
echo "Harness $HARNESS_HASH"
echo "Trees A=$TREE_A B=$TREE_B C1=$TREE_C1 C2=$TREE_C2"

failed=0
run_tree() {
  local name="$1" dest="$2" ref="$3" worktree="$4"
  echo "==> $name $ref"
  if [[ "$worktree" != "$REPO" ]]; then
    git -C "$REPO" worktree remove --force "$worktree" 2>/dev/null || true
    rm -rf "$worktree"
    git -C "$REPO" worktree add --detach "$worktree" "$ref"
  fi
  set +e
  node "$HARNESS" --root "$worktree" --passes | tee "$dest"
  local rc=${PIPESTATUS[0]}
  set -e
  if [[ "$worktree" != "$REPO" ]]; then
    git -C "$REPO" worktree remove --force "$worktree"
  fi
  if [[ $rc -ne 0 ]]; then
    echo "harness exit $rc for $name (receipts kept)"
    failed=1
  fi
}

run_tree A "$RECEIPT_DIR/${STAMP}-presensor.json" "$TREE_A" /tmp/ew-authority-tree-a
run_tree B "$RECEIPT_DIR/${STAMP}-sensors.json" "$TREE_B" /tmp/ew-authority-tree-b
run_tree C1 "$RECEIPT_DIR/${STAMP}-commit1.json" "$TREE_C1" /tmp/ew-authority-tree-c1
run_tree C2 "$RECEIPT_DIR/${STAMP}-ew-tip.json" "$TREE_C2" "$REPO"

node --input-type=module - "$RECEIPT_DIR" "$STAMP" "$TREE_A" "$TREE_B" "$TREE_C1" "$TREE_C2" "$HARNESS_HASH" <<'JS'
import fs from 'node:fs';
import path from 'node:path';
const [dir, stamp, a, b, c1, c2, harness] = process.argv.slice(2);
const load = name => JSON.parse(fs.readFileSync(path.join(dir, `${stamp}-${name}.json`), 'utf8'));
const A = load('presensor'), B = load('sensors'), C1 = load('commit1'), C2 = load('ew-tip');
const rnd = n => n == null || Number.isNaN(n) ? null : Math.round(n * 100) / 100;
const tick = j => j.frameCPU || {};
const elec = j => j.electronicsPass?.applicable === false ? null : j.electronicsPass;
const summary = {
  stamp,
  harnessSha256: harness,
  trees: {A: a, B: b, C1: c1, C2: c2},
  increments: {
    tickP95: {
      ewMinusSensors: rnd((tick(C2).p95 ?? NaN) - (tick(B).p95 ?? NaN)),
      ewMinusPresensor: rnd((tick(C2).p95 ?? NaN) - (tick(A).p95 ?? NaN)),
      cumulativeLimitMs: 2
    },
    electronicsPassP95: {
      ewMinusSensors: elec(C2) && elec(B) ? rnd(elec(C2).p95 - elec(B).p95) : null,
      ewMinusPresensor: null,
      note: 'pre-sensor electronicsPass is not applicable'
    }
  },
  thisHostElectronicsPass: elec(C2) ? {p95: rnd(elec(C2).p95), p99: rnd(elec(C2).p99), passed: elec(C2).passed} : null,
  platinumAuthority: {p95: 2.5, p99: 6.9, passed: false, series: 'same power+sensors full-workload timer'},
  decisionRequired: true,
  decisionReason: 'Unchanged 2/4 full-workload gate failed on Platinum (2.50/6.90) and was not re-run there. Do not merge to main without an explicit decision.'
};
fs.writeFileSync(path.join(dir, `${stamp}-increments.json`), JSON.stringify(summary, null, 2));
console.log(JSON.stringify(summary, null, 2));
JS

echo "Four-tree receipts written under $RECEIPT_DIR/${STAMP}-*.json"
exit "$failed"
