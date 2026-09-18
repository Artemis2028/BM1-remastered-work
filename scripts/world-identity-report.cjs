// Every world, every identity field, read from whichever tree this runs against. Both halves of the
// comparison come from this one script so the two sides cannot be shaped differently.
const { startProbe } = require('/home/claude/bm1/repo/scripts/probe-harness.cjs');
const fs = require('node:fs');
(async () => {
  const probe = await startProbe(); const { ev, fresh } = probe;
  await fresh('identity-report');
  const out = await ev(() => {
    const t = testBM1, s = t.state;
    return {
      commit: null,
      worlds: (s.planets || []).map((p, i) => {
        const sov = typeof t.getSystemSovereignty === 'function' ? t.getSystemSovereignty(i) : {};
        const ctl = t.getSystemControl(i) || {};
        const cul = typeof t.getSystemCulture === 'function' ? t.getSystemCulture(i) : {};
        return { i, name: p.name, population: p.population ?? null,
          culture: cul.id ?? null, cultureLabel: cul.label ?? null, cultureSource: cul.source ?? null,
          why: sov.cultureWhy ?? null,
          controller: ctl.controller ?? null, allegiance: ctl.allegiance ?? null, origin: ctl.origin ?? null,
          governor: sov.governor ?? null, level: sov.level ?? null, readout: sov.label ?? null };
      }),
    };
  });
  out.commit = process.argv[3] || null;
  fs.writeFileSync(process.argv[2], JSON.stringify(out, null, 1) + '\n');
  console.log('wrote', out.worlds.length, 'worlds for', out.commit);
  await Promise.race([probe.close(), new Promise((r)=>setTimeout(r,9000))]); process.exit(0);
})().catch(e=>{console.error(e);process.exit(1);});
