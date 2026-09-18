# Both halves of the comparison come from world-identity-report.cjs, run against two trees, so the two
# sides cannot be shaped differently. This round the government columns are the ones that move, so the
# report is built around what the change *does* — hostility, station ownership, who governs — rather
# than what the planet card prints, which is the thing that was already saying the right words while
# the world underneath behaved like nobody's.
import json, io, sys

before = json.load(io.open('/tmp/claude-0/scratch/before.json'))
after  = json.load(io.open('/tmp/claude-0/scratch/after.json'))
B = {w['i']: w for w in before['worlds']}
A = {w['i']: w for w in after['worlds']}
assert len(B) == len(A) == 101, (len(B), len(A))

GOV = ['controller', 'allegiance', 'origin', 'governor']
def val(x):
    if x in (None, ''): return '—'
    if isinstance(x, list): return ', '.join(str(v) for v in x) or '—'
    if isinstance(x, bool): return 'yes' if x else 'no'
    return str(x)

lines = []
w = lines.append
w("# World allegiance — every world, before and after")
w("")
w(f"Before: `{before['commit']}`   After: `{after['commit']}`   Worlds compared: **{len(A)}**")
w("")
w("Generated from both trees by the same script. The question this round is not what a planet card")
w("says — last round fixed that — but who actually holds each world: whether its stations answer to a")
w("government, whether a Terran captain is welcome, and whether the engine has any government to name")
w("at all. Every claim below is checked against the world's own description by the HOLD gate; a claim")
w("the text does not support fails the suite.")
w("")

gov_changed = [i for i in sorted(A) if any(B[i][f] != A[i][f] for f in GOV)]
cul_changed = [i for i in sorted(A) if B[i]['culture'] != A[i]['culture']]
hostile_changed = [i for i in sorted(A) if B[i]['hostileToPlayer'] != A[i]['hostileToPlayer']]
station_changed = [i for i in sorted(A) if B[i]['stationOwners'] != A[i]['stationOwners']]
relation_changed = [i for i in sorted(A) if B[i]['mapRelation'] != A[i]['mapRelation']]
readout_changed = [i for i in sorted(A) if B[i]['readout'] != A[i]['readout']]

w("## Summary")
w("")
w(f"- Worlds compared: **{len(A)}**")
w(f"- Government changed (controller, allegiance, origin or governor): **{len(gov_changed)}**")
w(f"- Hostility to a Terran captain changed: **{len(hostile_changed)}**")
w(f"- Station ownership changed: **{len(station_changed)}**")
w(f"- Culture (who lives there) changed: **{len(cul_changed)}** — last round's work is untouched")
w(f"- Planet-card readout changed: **{len(readout_changed)}**")
w(f"- Map relation line changed: **{len(relation_changed)}**")
w("")
w("The last two numbers are the point of the round, read backwards. A world whose stations changed")
w("hands and whose attitude to this captain flipped can still print the same relation line, because")
w("\"Tholian world · self-governed\" is what the map says both for a world the Assembly governs and for")
w("a world nobody governs. The line was never wrong; it was never evidence either. What changed is")
w("underneath it.")
w("")

src_b, src_a = {}, {}
for i in A:
    src_b[B[i]['originSource']] = src_b.get(B[i]['originSource'], 0) + 1
    src_a[A[i]['originSource']] = src_a.get(A[i]['originSource'], 0) + 1
w("How each world's government is resolved:")
w("")
w("| source | before | after |")
w("| --- | --- | --- |")
for k in sorted(set(src_b) | set(src_a), key=lambda x: str(x)):
    w(f"| {k} | {src_b.get(k, 0)} | {src_a.get(k, 0)} |")
w("")
w("`government` is the engine's own table. `allegiance` is a world placed inside a power by its own")
w("description. `independent` is a world its description says nobody claims, recorded so that it is")
w("independent *on purpose* rather than because no table had an answer for it.")
w("")

w("## Government changes, and why each one")
w("")
w("| # | world | controller | allegiance | governor | hostile to Terran | station owners | justified by its own description |")
w("| --- | --- | --- | --- | --- | --- | --- | --- |")
for i in gov_changed:
    b, a = B[i], A[i]
    def cell(f):
        bv, av = val(b[f]), val(a[f])
        return av if bv == av else f"{bv} → **{av}**"
    host = f"{val(b['hostileToPlayer'])} → **{val(a['hostileToPlayer'])}**" if b['hostileToPlayer'] != a['hostileToPlayer'] else val(a['hostileToPlayer'])
    stn = f"{val(b['stationOwners'])} → **{val(a['stationOwners'])}**" if b['stationOwners'] != a['stationOwners'] else val(a['stationOwners'])
    why = a['originWhy'] or (f"shipped government table" if a['originSource'] == 'government' else val(a['why']))
    w(f"| {i} | {a['name']} | {cell('controller')} | {cell('allegiance')} | {cell('governor')} | {host} | {stn} | {why} |")
w("")

w("## Worlds deliberately left alone, and why")
w("")
w("**Two powers were given no territory.**")
w("")
w("- **Blender** — the Dominion remnant. Handing it a world makes it a territorial polity, and the war")
w("  ledger then holds `dominion_remnant:ferengi`, which is a war nobody wrote. It keeps its outpost")
w("  and no worlds.")
w("- **Gorn** — the text says the Gorn are extinct. Giving them worlds would contradict the thing the")
w("  worlds themselves say. Their services and recovery stay behind the authored discovery requirement.")
w("")
w("**Two worlds a first cut of this table got wrong, and reverted.** Both were caught by reading what")
w("the descriptions say rather than which words they contain, and both are now held by the gate.")
w("")
w("- **Pirates Haven** was recorded as independent on the phrase \"we pirates\". Its text warns of")
w("  \"the rotting corpses of the poor traders caught in our little haven\"; recording it as independent")
w("  made it neutral and stopped it being hostile. It stays pirate-held and hostile.")
w("- **Rigel**'s text says both things at once: \"Rigel is an independent planet\" and \"The Andorians")
w("  however lay claim to this world and are quite willing to protect it\". The engine has no")
w("  protectorate level to express that, so nothing was authored and the shipped table's `andorian`")
w("  stands. **This is a gap, not a decision:** a world whose text names a protector is currently")
w("  indistinguishable from one the protector governs outright.")
w("")
w("**Four worlds were dropped from the independent table** — New Switzerland, Trill, Tepos and Flash.")
w("Their descriptions say who lives there and what they sell, and nothing whatever about who governs")
w("them. They remain neutral through the shipped table, which is where an absence of data belongs; a")
w("phrase like \"Trills\" is not a claim of independence and is no longer recorded as one.")
w("")

w("## All 101 worlds")
w("")
w("Changed values are shown `before → after`.")
w("")
w("| # | world | pop | people | controller | allegiance | governor | source | hostile | station owners | map relation |")
w("| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |")
for i in sorted(A):
    b, a = B[i], A[i]
    def cell(f):
        bv, av = val(b[f]), val(a[f])
        return av if bv == av else f"{bv} → **{av}**"
    w(f"| {i} | {a['name']} | {val(a['population'])} | {val(a['cultureLabel'] or a['culture'])} | "
      f"{cell('controller')} | {cell('allegiance')} | {cell('governor')} | {cell('originSource')} | "
      f"{cell('hostileToPlayer')} | {cell('stationOwners')} | {val(a['mapRelation'])} |")
w("")

w("## What the gate checks, so this table cannot drift")
w("")
w("`HOLD` in `scripts/playtest-gate.cjs`, run against the final commit:")
w("")
w("- every authored claim appears in that world's own `description`, or the check fails and names it;")
w("- the five Tholian worlds are controlled by, fly the flag of, and are hostile on the same terms as")
w("  Tholia itself, and their stations are owned by `tholian` rather than an anonymous `polity:NN`;")
w("- the map can name a government for each of them, which is the field that was empty before;")
w("- worlds recorded as independent resolve as `independent`, not as somebody's territory;")
w("- capturing one still transfers it, and the capture survives a save and a reload;")
w("- an explicit `factionSystemOverrides` entry still beats the authored allegiance.")
w("")

io.open('/home/claude/bm1/patch2/validation/world-identity-report.md', 'w').write("\n".join(lines) + "\n")
print(f"worlds {len(A)} | government changed {len(gov_changed)} | hostility changed {len(hostile_changed)} "
      f"| stations changed {len(station_changed)} | culture changed {len(cul_changed)} | readout changed {len(readout_changed)}")
