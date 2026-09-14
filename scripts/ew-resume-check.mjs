#!/usr/bin/env node
// Campaign resume / worktree / plan classifier. Measurement only; never deletes.
// Exit 0 skip/reuse/create/plan-ok, 2 missing receipt (run), 3 stop.
import fs from 'node:fs';
import {
  classifyExistingReceipt,
  inspectWorktree,
  validatePlan
} from './ew-bench-lib.mjs';

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

if (mode === 'plan') {
  const file = flag('--file');
  const rawExpected = flag('--expected') || process.env.EW_RESUME_EXPECTED || '{}';
  let expected;
  try {
    expected = JSON.parse(rawExpected);
  } catch (e) {
    console.log(JSON.stringify({ok: false, action: 'stop', reason: `expected JSON: ${e.message}`}, null, 2));
    process.exit(3);
  }
  if (!file || !fs.existsSync(file)) {
    console.log(JSON.stringify({ok: true, action: 'write', status: 'missing'}, null, 2));
    process.exit(0);
  }
  let plan;
  try {
    plan = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    console.log(JSON.stringify({ok: false, action: 'stop', status: 'malformed', reason: e.message, file}, null, 2));
    process.exit(3);
  }
  const result = validatePlan(plan, expected);
  const payload = {
    ...result,
    action: result.ok ? 'keep' : 'stop',
    file
  };
  console.log(JSON.stringify(payload, null, 2));
  process.exit(result.ok ? 0 : 3);
}

console.error('usage: ew-resume-check.mjs worktree --path PATH --expected-sha SHA');
console.error('       ew-resume-check.mjs receipt --file FILE --expected JSON');
console.error('       ew-resume-check.mjs plan --file FILE --expected JSON');
process.exit(2);
