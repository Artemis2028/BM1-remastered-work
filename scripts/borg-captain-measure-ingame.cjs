// In-game long run for CAPTAIN-BORG-ASSIMILATION: the real engine and chart, every campaign routine on (nothing
// quieted), the campaign's own Assimilation Cube at Vex, days advanced through the normal calendar.
//   PARKED (3 campaigns × 200 days): the captain in an Inquiry Class parked at Astron beside Vex. Each Borg contact
//     in his scene is played by a fixed per-campaign rotation of scripted responses, so every path is exercised:
//       healthy  — he stands, healthy, through the engagement window;
//       escape   — he warps out to a neighbouring system and later flies back;
//       hurt     — he meets them badly hurt (shields down, hull just above the disable line), is disabled by the
//                  cube's own fire, tries the emergency recovery every 10 s; if he is assimilated he reloads the
//                  save made at the start of the day (that contact is then played as an escape);
//       destroy  — the cube is destroyed in the scene (his fire and escorts, as the scene would record it).
//     He is repaired after every contact (normal play).
//   ELSEWHERE (1 campaign × 200 days): the same captain flying ordinary courses around Earth, far from Vex.
//   LOW-VALUE (1 campaign × 120 days): the captain parked at Astron in his starting Saber.
// Reports the brief's metrics. Must hold: formal wars by the Borg = 0; duplicate objectives = 0; no captain objective
// unless seen and worth it (ELSEWHERE and LOW-VALUE: 0); recovery never lifts him out of active contact; no
// assimilation completes within 10 s of a reload; no assimilation completes faster than the countdown.
const fs = require('node:fs');
const path = require('node:path');
const { startProbe } = require('./probe-harness.cjs');
const DAYS = Number(process.env.BM1_CAPTAIN_DAYS || 200);
(async () => {
  const probe = await startProbe({});
  const { ev, fresh, page } = probe;
  const out = process.env.BM1_TEST_OUTPUT || '/tmp';
  fs.mkdirSync(out, { recursive: true });
  await page.waitForFunction(() => !testBM1.doctrineStatus || testBM1.doctrineStatus().state !== 'loading', null, { timeout: 30000 }).catch(() => {});
  const setup = () => ev(() => {
    const t = testBM1;
    window.__adv1 = () => t.advanceFleetCalendar(1, t.Fleet.nextId(t.fleetBook(), 'journey'));
    window.__step = (n, fs = 2.5) => { for (let i = 0; i < n; i++) { t.playtestClock.offset -= fs * 16.6667; t.tick(fs); } };
    window.__seconds = (s) => window.__step(Math.ceil((s * 1000) / (2.5 * 16.6667)));
    window.__idx = (n) => t.getSystemIndexByName(n);
    window.__place = (sys) => { t.markSystemVisited(sys); t.state.currentPlanet = sys; t.state.myplanet = sys + 1; t.applySystemState(sys); t.placePlayerAtSecurityApproach?.(); };
    window.__ship = (id) => { const b = t.fleetBook(); t.ensurePersonalIdentity(); b.personalRetireCause = 'replaced'; b.personalId = t.Fleet.nextId(b, 'personal'); b.personalCondition = 'operational';
      t.state.playership = id; t.state.hull = 100; t.applyCurrentShipStats(true); t.applyShipDefaultWeapons(id, true); t.ensurePersonalIdentity(); t.state.shipName = t.getShipStats(id).name; t.state.shields = 100; t.state.spawnProtectionUntil = 0; };
    window.__repair = () => { t.state.hull = 100; t.state.shields = 100; t.fleetBook().personalCondition = 'operational'; t.state.recoveryAt = 0; };
    window.__line = () => { const max = t.getNpcCombatDurability(t.state.playership).hull; return (100 * t.Fleet.disableThreshold(max)) / max; };
    window.__capEnc = () => (t.campaign().encounters || []).filter((e) => e.type === 'assimilation' && e.contact?.targetKind === 'captain' && ['pending', 'tactical_active'].includes(e.status)).slice(-1)[0] || null;
    window.__capObj = () => (t.campaign().doctrine?.objectives || []).filter((o) => o.kind === 'assimilation' && o.targetKind === 'captain').slice(-1)[0] || null;
    window.__fly = (to) => { const plan = t.getPlottedRoute(t.state.currentPlanet, to); if (!plan) return false; t.state.antimatter = Math.max(t.state.antimatter, 999); if (!t.beginWarpTravel(to, plan) && !t.state.warp.active) return false; t.openWarpBriefing?.(); t.closeGalaxyReports?.(); t.completeWarpTravel(); return true; };
  });
  const runs = [];
  async function run(kind, seed, days, policies = ['healthy']) {
    await fresh(seed); await setup();
    const r = await ev(({ kind, days, policies }) => {
      const t = testBM1; const b = t.campaign();
      const A = window.__idx('Astron'), E = window.__idx('Earth');
      const W0 = t.buildCampaignWorld(true);
      const escapeTo = W0.neighbours(A).map(Number).find((i) => t.getSystemControl(i).controller !== 'borg' && i !== 33) ?? W0.neighbours(A).map(Number)[0];
      const borgWars0 = Object.keys(b.warStates || {}).filter((k) => k.includes('borg')).length;
      const m = { log: [], contacts: 0, policies: {}, outcomes: {}, assimilations: 0, escapes: 0, borgDefeats: 0, foughtNoDisable: 0, recoveryBlocks: 0, recoveryBypass: 0, disabledSecondsToTerminal: [], reloads: 0, reloadSecondsToTerminal: [], reloadLoops: 0, maxConcurrentCaptainObjectives: 0, captainEvaluations: 0, captainEligible: 0, captainRejected: {}, notes: [] };
      if (kind === 'parked' || kind === 'lowvalue') { window.__place(A); window.__ship(kind === 'lowvalue' ? 307 : 289); }
      else { window.__place(E); window.__ship(289); }
      let reloadPolicy = null;
      const dests = W0.neighbours(E).map(Number).filter((i) => t.getSystemControl(i).controller !== 'borg');
      let flights = 0;
      for (let d = 0; d < days && !t.state.gameOver; d++) {
        if (kind === 'elsewhere' && d % 7 === 0) { const to = dests[flights++ % dests.length]; window.__fly(t.state.currentPlanet === E ? to : E); window.__repair(); }
        if (kind === 'parked' && t.state.currentPlanet !== A) { window.__fly(A); window.__repair(); }
        t.saveGame(1);
        window.__adv1();
        const live = (t.campaign().doctrine?.objectives || []).filter((o) => o.kind === 'assimilation' && o.targetKind === 'captain' && o.status === 'active').length;
        m.maxConcurrentCaptainObjectives = Math.max(m.maxConcurrentCaptainObjectives, live);
        const enc = window.__capEnc();
        if (!enc) continue;
        // A contact in his scene.
        m.contacts++;
        const policy = reloadPolicy || policies[(m.contacts - 1) % policies.length];
        reloadPolicy = null;
        m.policies[policy] = (m.policies[policy] || 0) + 1;
        for (let k = 0; k < 40 && enc.status === 'pending'; k++) window.__step(1);
        const objId = enc.objective.ref;
        const objOf = () => (t.campaign().doctrine?.objectives || []).find((x) => x.id === objId) || null;
        if (policy === 'escape') { window.__seconds(5); window.__fly(escapeTo); window.__repair(); }
        else if (policy === 'destroy') { window.__seconds(5); const cube = t.state.npcShips.find((n) => n.encounterId === enc.id && n.encounterSide === 'borg' && !n.destroyed); if (cube) t.destroyNpcShip(cube); window.__seconds(2); }
        else {
          if (policy === 'hurt') { t.state.shields = 0; t.state.hull = window.__line() + 1.5; }
          let disabledAt = null, s = 0;
          for (; s < 200 && t.Encounter.isLive(enc) && !t.state.gameOver; s++) {
            if (policy === 'hurt') t.state.shields = 0;
            window.__seconds(1);
            if (t.fleetBook().personalCondition === 'disabled') {
              disabledAt ??= s;
              if ((s - disabledAt) % 10 === 0 && t.Encounter.isLive(enc)) { const st = t.getRecoveryStatus(); if (!st.available) m.recoveryBlocks++; if (t.recoverDisabledPlayer()) m.recoveryBypass++; }
            }
          }
          if (t.state.gameOver && t.state.gameOverCause === 'assimilated') {
            m.disabledSecondsToTerminal.push(s - (disabledAt ?? s));
            m.assimilations++;
            m.log.push({ day: t.state.day, objective: String(objId).split(':').pop(), engagement: enc.contact?.engagement, policy, encounter: 'captain_assimilated', objective_result: 'target_assimilated (CAPTAIN ASSIMILATED; reloaded the start-of-day save)', disabledSeconds: s - (disabledAt ?? s), recoveryBlocksSoFar: m.recoveryBlocks });
            // The player's choice: reload the save made at the start of the day (never automatic).
            const reloadedAt = t.gameNow();
            document.getElementById('btn-gameover-reload').click();
            m.reloads++;
            // The day is played again; this time he escapes the contact. A completion within 10 s of the reload is a loop.
            window.__seconds(10);
            if (t.state.gameOver) { m.reloadLoops++; m.reloadSecondsToTerminal.push(Math.round((t.gameNow() - reloadedAt) / 1000)); break; }
            reloadPolicy = 'escape'; d--; continue;
          }
          if (policy !== 'hurt' && t.state.hull >= 99) {} // healthy: the window ran out
        }
        const oc = objOf();
        const res = oc?.result?.result || (oc?.status === 'active' ? `active:${oc.lastEngagement?.outcome || '?'}` : null);
        m.log.push({ day: t.state.day, objective: String(objId).split(':').pop(), engagement: enc.contact?.engagement, policy, encounter: enc.result?.outcome || enc.status, objective_result: res });
        m.outcomes[`${policy}→${res}`] = (m.outcomes[`${policy}→${res}`] || 0) + 1;
        if (res === 'target_escaped') m.escapes++;
        if (res === 'borg_destroyed' || res === 'borg_disabled') m.borgDefeats++;
        if (oc?.lastEngagement?.outcome === 'fought' || /fought/.test(res || '')) m.foughtNoDisable++;
        if (t.fleetBook().personalCondition === 'disabled' && !t.Encounter.isLive(enc)) { const st = t.getRecoveryStatus(); if (st.available) t.recoverDisabledPlayer(); window.__seconds(6); }
        window.__repair();
      }
      const s = t.DoctrineCampaign.borgSummary(t.campaign());
      for (const sel of Object.values(s.selections).flat()) for (const c of sel.candidates.filter((x) => x.kind === 'captain')) { m.captainEvaluations++; if (c.verdict === 'eligible') m.captainEligible++; else m.captainRejected[c.reason] = (m.captainRejected[c.reason] || 0) + 1; }
      const capObjs = s.objectives.filter((o) => o.targetKind === 'captain');
      const keys = capObjs.filter((o) => o.status === 'active').map((o) => o.target.vid);
      return { kind, days, day: t.state.day, ...m, captainObjectivesOpened: capObjs.length, captainResults: capObjs.reduce((a, o) => ({ ...a, [o.result?.result || o.status]: (a[o.result?.result || o.status] || 0) + 1 }), {}),
        duplicateObjectives: keys.length - new Set(keys).size + Math.max(0, m.maxConcurrentCaptainObjectives - 1), stats: Object.fromEntries(Object.entries(s.stats).filter(([k]) => /Captain/.test(k))),
        borgWars: Object.keys(b.warStates || {}).filter((k) => k.includes('borg')).length - borgWars0, borgPairs: Object.keys(t.diplomacyBook().pairs || {}).filter((k) => k.includes('borg')).length, borgLicences: Object.keys(b.polities.borg?.licenses || {}).length,
        gameOverAtEnd: t.state.gameOver, cause: t.state.gameOverCause };
    }, { kind, days, policies });
    runs.push({ seed, ...r });
    console.log(JSON.stringify({ seed, ...r }).slice(0, 3000));
  }
  // Each parked campaign its own rotation (an escape cools the captain for ~120 days on this chart, so a campaign
  // sees only a few contacts): between them every response is played.
  await run('parked', 'cap-long-1', DAYS, ['hurt', 'healthy', 'healthy', 'destroy']);
  await run('parked', 'cap-long-2', DAYS, ['healthy', 'escape', 'hurt', 'destroy']);
  await run('parked', 'cap-long-5', DAYS, ['escape', 'destroy']);
  await run('elsewhere', 'cap-long-3', DAYS);
  await run('lowvalue', 'cap-long-4', Math.round(DAYS * 0.6));
  const parked = runs.filter((r) => r.kind === 'parked');
  const countdown = 60;
  const checks = [
    ['formal wars caused by the Borg = 0', runs.every((r) => r.borgWars === 0 && r.borgPairs === 0)],
    ['duplicate captain objectives = 0 (never more than one live)', runs.every((r) => r.duplicateObjectives === 0 && r.maxConcurrentCaptainObjectives <= 1)],
    ['parked near Vex in a valuable hull: captain objectives open', parked.every((r) => r.captainObjectivesOpened >= 1)],
    ['normal play away from the Borg: no captain objective (no bias)', runs.filter((r) => r.kind === 'elsewhere').every((r) => r.captainObjectivesOpened === 0)],
    ['low-value hull: no captain objective (rejected on value)', runs.filter((r) => r.kind === 'lowvalue').every((r) => r.captainObjectivesOpened === 0 && r.captainEligible === 0)],
    ['emergency recovery never lifts him out of active contact', runs.every((r) => r.recoveryBypass === 0)],
    ['no assimilation completes faster than the countdown', runs.every((r) => r.disabledSecondsToTerminal.every((s) => s >= countdown - 1))],
    ['no game-over loop right after a reload (none within 10 s)', runs.every((r) => r.reloadLoops === 0)],
    ['not unavoidable: escapes and Borg defeats both occur', parked.some((r) => r.escapes > 0) && parked.some((r) => r.borgDefeats > 0)],
    ['no Borg production rights', runs.every((r) => r.borgLicences === 0)],
  ];
  for (const [n, ok] of checks) console.log(ok ? 'OK  ' : 'FAIL', n);
  fs.writeFileSync(path.join(out, 'borg-captain-measure-ingame.json'), JSON.stringify({ runs, checks: checks.map(([n, ok]) => ({ n, ok })) }, null, 1));
  if (probe.errors.length) console.log('page errors:', probe.errors.slice(0, 5));
  await probe.close();
  process.exit(checks.every(([, ok]) => ok) && !probe.errors.length ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
