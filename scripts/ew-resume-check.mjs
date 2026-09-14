#!/usr/bin/env node
// Campaign resume / worktree classifier. Measurement only; never deletes trees
// or receipts. Exit 0 skip/reuse/create, 2 missing receipt (run), 3 stop.
import {classifyExistingReceipt, inspectWorktree} from './ew-bench-lib.mjs';

const mode = process.argv[2];
function flag(name) {
  const i = process.argv.indexOf(name);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : null;
}

if (mode === 'worktree') {
  const result = inspectWorktree({path: flag('--path'), expectedSha: flag('--expected-sha')});
  console.log(JSON.stringify(result, null, 2));
  process.exit(result.action === 'stop' ? 3 : 0);
}

if (mode === 'receipt') {
  const rawExpected = flag('--expected') || process.env.EW_RESUME_EXPECTED || '{}';
  let expected;
  try {
    expected = JSON.parse(rawExpected);
  } catch (e) {
    console.log(JSON.stringify({action: 'stop', status: 'error', reason: `expected JSON: ${e.message}`}, null, 2));
    process.exit(3);
  }
  const result = classifyExistingReceipt(flag('--file'), expected);
  console.log(JSON.stringify(result, null, 2));
  if (result.action === 'stop') process.exit(3);
  if (result.action === 'run') process.exit(2);
  process.exit(0);
}

console.error('usage: ew-resume-check.mjs worktree --path PATH --expected-sha SHA');
console.error('       ew-resume-check.mjs receipt --file FILE --expected JSON');
process.exit(2);
