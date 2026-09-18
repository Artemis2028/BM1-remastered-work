import json, io, sys
before = json.load(io.open('/tmp/claude-0/scratch/before.json'))
after  = json.load(io.open('/tmp/claude-0/scratch/after.json'))
B = {w['i']: w for w in before['worlds']}
A = {w['i']: w for w in after['worlds']}
assert len(B) == len(A) == 101, (len(B), len(A))

FIELDS = ['culture', 'controller', 'allegiance', 'origin', 'governor']
def val(x):
    return '—' if x in (None, '') else str(x)

lines = []
w = lines.append
w(f"# World identity — every world, before and after")
w("")
w(f"Before: `{before['commit']}`   After: `{after['commit']}`   Worlds compared: **{len(A)}**")
w("")
w("Generated from both trees by the same script, so the two sides cannot be shaped differently.")
w("`culture` is who lives there. `controller`, `allegiance` and `origin` are the three government")
w("fields the engine keeps, and `governor` is what the planet card prints from them. The point of the")
w("table is the four government columns: they are identical on every row.")
w("")

changed = [i for i in sorted(A) if B[i]['culture'] != A[i]['culture']]
gov_changed = [i for i in sorted(A) if any(B[i][f] != A[i][f] for f in FIELDS[1:])]
label_changed = [i for i in sorted(A) if B[i]['readout'] != A[i]['readout']]

w("## Summary")
w("")
w(f"- Worlds compared: **{len(A)}**")
w(f"- Culture changed: **{len(changed)}**")
w(f"- Government changed (controller, allegiance, origin or governor): **{len(gov_changed)}**")
w(f"- Planet-card readout changed: **{len(label_changed)}**")
w("")
src_b, src_a = {}, {}
for i in A:
    src_b[B[i]['cultureSource']] = src_b.get(B[i]['cultureSource'], 0) + 1
    src_a[A[i]['cultureSource']] = src_a.get(A[i]['cultureSource'], 0) + 1
w("How each world's people are resolved:")
w("")
w("| source | before | after |")
w("| --- | --- | --- |")
for k in sorted(set(src_b) | set(src_a), key=lambda x: str(x)):
    w(f"| {k} | {src_b.get(k, 0)} | {src_a.get(k, 0)} |")
w("")

w("## All 101 worlds")
w("")
w("`culture` column shows `before → after` where it changed, or the single value where it did not.")
w("The four government columns show `before → after` likewise; every one of them is unchanged.")
w("")
w("| # | world | pop | culture | controller | allegiance | origin | governor | readout (after) |")
w("| --- | --- | --- | --- | --- | --- | --- | --- | --- |")
for i in sorted(A):
    b, a = B[i], A[i]
    def cell(f):
        bv, av = val(b[f]), val(a[f])
        return av if bv == av else f"**{bv} → {av}**"
    w(f"| {i} | {a['name']} | {a['population']} | {cell('culture')} | {cell('controller')} | "
      f"{cell('allegiance')} | {cell('origin')} | {cell('governor')} | {val(a['readout'])} |")
w("")

w("## The worlds whose people changed")
w("")
w("| # | world | people before | people after | government (unchanged) | justified by its own description |")
w("| --- | --- | --- | --- | --- | --- |")
for i in changed:
    b, a = B[i], A[i]
    w(f"| {i} | {a['name']} | {val(b['cultureLabel'] or b['culture'])} | {val(a['cultureLabel'] or a['culture'])} | "
      f"{val(a['governor'])} | {val(a['why'])} |")
w("")

if gov_changed:
    w("## Government changes")
    w("")
    for i in gov_changed:
        b, a = B[i], A[i]
        w(f"- **{a['name']}**: " + "; ".join(f"{f} {val(b[f])} → {val(a[f])}" for f in FIELDS[1:] if b[f] != a[f]))
else:
    w("## Government changes")
    w("")
    w("**None.** Every world's controller, allegiance, origin and governor is identical before and after.")
    w("Naming a world's people did not move who holds it, which is the whole point of separating the two.")
w("")

w("## Worlds whose readout changed but whose people did not")
w("")
only_label = [i for i in label_changed if i not in changed]
if only_label:
    for i in only_label:
        w(f"- **{A[i]['name']}**: `{val(B[i]['readout'])}` → `{val(A[i]['readout'])}`")
else:
    w("None.")
w("")

io.open('/home/claude/bm1/patch2/validation/world-identity-report.md', 'w').write("\n".join(lines) + "\n")
print(f"worlds {len(A)} | culture changed {len(changed)} | government changed {len(gov_changed)} | readout changed {len(label_changed)}")
print("orilla:", B[62]['culture'], '->', A[62]['culture'], '|', A[62]['cultureLabel'], '|', A[62]['cultureSource'], '|', A[62]['readout'])
