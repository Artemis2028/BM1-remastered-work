#!/usr/bin/env bash
# One pinned harness against the four pinned EW review trees.
# Usage: scripts/ew-four-tree.sh [receipt-dir]
set -euo pipefail

REPO="$(cd "$(dirname "$0")/.." && pwd)"
HARNESS="$REPO/scripts/ew-frame-benchmark.mjs"
RECEIPT_DIR="${1:-$REPO/docs/ew/receipts}"
STAMP="${EW_RECEIPT_STAMP:-passms-20260913}"
mkdir -p "$RECEIPT_DIR"

TREE_A="${TREE_A:-6958f08e73aff55efbf48bae3f9433e5acc270e8}"
TREE_B="${TREE_B:-e7aa3c594e4799c54d48e2eeac37a2a1acf36b9b}"
TREE_C1="${TREE_C1:-74caf837c7882a86e3bd7c74f083029453953c1a}"
TREE_C2="${TREE_C2:-$(git -C "$REPO" rev-parse HEAD)}"

HARNESS_HASH="$(sha256sum "$HARNESS" | awk '{print $1}')"
COMMANDS="$RECEIPT_DIR/${STAMP}-commands.txt"

cat > "$COMMANDS" <<EOF
# Rerunnable four-tree passMs timing
# Host class: supplementary unless cpu matches Platinum 8573C
# Pinned harness: $HARNESS
# Harness sha256: $HARNESS_HASH
# Pinned trees:
#   A  pre-sensor / OPS     $TREE_A
#   B  sensors              $TREE_B
#   C1 noise/ECCM           $TREE_C1
#   C2 review tip           $TREE_C2
# Gate: passMs p95<=2ms p99<=4ms
# Cumulative frame: tick p95(C2) - tick p95(A) <= 2ms
# Pre-sensor + --passes must report sensor-pass metrics as not applicable, never zero.

HARNESS=$HARNESS
RECEIPT_DIR=$RECEIPT_DIR
STAMP=$STAMP

# A — frame baseline; sensor-pass series are N/A
git -C $REPO worktree add --detach /tmp/ew-passms-tree-a $TREE_A
node \$HARNESS --root /tmp/ew-passms-tree-a --passes > \$RECEIPT_DIR/\${STAMP}-presensor.json

# B — sensors, ordinary torpedoes
git -C $REPO worktree add --detach /tmp/ew-passms-tree-b $TREE_B
node \$HARNESS --root /tmp/ew-passms-tree-b --passes > \$RECEIPT_DIR/\${STAMP}-sensors.json

# C1 — paid noise/ECCM, ordinary torpedoes
git -C $REPO worktree add --detach /tmp/ew-passms-tree-c1 $TREE_C1
node \$HARNESS --root /tmp/ew-passms-tree-c1 --passes > \$RECEIPT_DIR/\${STAMP}-commit1.json

# C2 — current review tip (this checkout)
node \$HARNESS --root $REPO --passes > \$RECEIPT_DIR/\${STAMP}-ew-tip.json

git -C $REPO worktree remove --force /tmp/ew-passms-tree-a /tmp/ew-passms-tree-b /tmp/ew-passms-tree-c1
EOF

echo "Wrote $COMMANDS"
echo "Harness $HARNESS_HASH"
echo "Trees A=$TREE_A B=$TREE_B C1=$TREE_C1 C2=$TREE_C2"

run_tree() {
  local name="$1" dest="$2" ref="$3" worktree="$4"
  echo "==> $name $ref"
  if [[ "$worktree" != "$REPO" ]]; then
    git -C "$REPO" worktree remove --force "$worktree" 2>/dev/null || true
    rm -rf "$worktree"
    git -C "$REPO" worktree add --detach "$worktree" "$ref"
  fi
  node "$HARNESS" --root "$worktree" --passes | tee "$dest"
  if [[ "$worktree" != "$REPO" ]]; then
    git -C "$REPO" worktree remove --force "$worktree"
  fi
}

run_tree A "$RECEIPT_DIR/${STAMP}-presensor.json" "$TREE_A" /tmp/ew-passms-tree-a
run_tree B "$RECEIPT_DIR/${STAMP}-sensors.json" "$TREE_B" /tmp/ew-passms-tree-b
run_tree C1 "$RECEIPT_DIR/${STAMP}-commit1.json" "$TREE_C1" /tmp/ew-passms-tree-c1
run_tree C2 "$RECEIPT_DIR/${STAMP}-ew-tip.json" "$TREE_C2" "$REPO"

echo "Four-tree receipts written under $RECEIPT_DIR/${STAMP}-*.json"
