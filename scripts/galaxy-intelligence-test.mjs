import assert from 'node:assert/strict';
import {assessIntel,INTEL_KINDS} from '../src/galaxy-intelligence.mjs';
const totals={civilian:0,fleet:0,samples:10000};
const reliability={civilian:new Set(),fleet:new Set()};
for(let i=0;i<totals.samples;i++) {
  const observation={kind:INTEL_KINDS[i%INTEL_KINDS.length],attacker:'klingon'};
  for(const [source,ownShips] of [['civilian',false],['fleet',true]]) {
    const options={seed:`review-${i}`,ownShips,candidates:['romulan']};
    const result=assessIntel(observation,options);
    assert.deepEqual(result,assessIntel(observation,options),'Re-reading an observation must not reroll');
    totals[source]+=Number(result.kind===observation.kind);
    reliability[source].add(result.accuracy);
    if(!result.correct && result.attacker) assert.equal(result.attacker,'romulan','Mistaken identity must stay regional');
    assert.ok(result.delay >=1 && result.delay<=4);
  }
}
assert.ok(totals.civilian>5000&&totals.civilian<7000,JSON.stringify(totals));
assert.ok(totals.fleet>8000&&totals.fleet<9600,JSON.stringify(totals));
assert.ok(totals.fleet>totals.civilian+1500);
assert.ok(reliability.civilian.size>9000&&reliability.fleet.size>9000);
console.log('PASS seeded report variation, mistakes in both sources, regional mistaken identities, delays and repeatability');
console.log(JSON.stringify(totals));
