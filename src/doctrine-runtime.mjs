// Faction doctrine runtime: the v0.2.1 doctrine package loaded and evaluated as data.
//
// This module is pure. It reads the doctrine JSON and its schema exactly as they sit in
// docs/doctrine/ — there is no second, hand-written copy of the policy anywhere in the game — and
// answers the questions the package defines: which profile and role govern an actor, whether a known
// event interests it and what response it proposes (or defers), which guarded intent it would choose,
// whether a shot would be authorised, and whether an objective has ended.
//
// It never decides what an actor knows. Every fact it is handed must come from the caller's knowledge
// adapter (src/doctrine-campaign.mjs derives them from one observer's own evidence); this module only
// refuses facts it does not recognise and treats a missing known fact as false.
//
// Predicate grammar (the package's own, and the only one accepted): a Boolean literal, {fact: ID},
// {all: [nonempty]} or {any: [nonempty]}. There is no expression language, no string predicate and
// nothing is ever executed.
//
// The reference evaluator this ports is docs/doctrine/validate-doctrine.py; runAcceptanceCase()
// reproduces its operations one for one so the package's 59 offline cases can be run in JavaScript.

export const DOCTRINE_RUNTIME_VERSION = 1;

export class DoctrineLoadError extends Error {
  constructor(message, errors = []) {
    super(`${message}${errors.length ? `:\n  - ${errors.slice(0, 40).join('\n  - ')}${errors.length > 40 ? `\n  … ${errors.length - 40} more` : ''}` : ''}`);
    this.name = 'DoctrineLoadError';
    this.errors = errors;
  }
}

// ---------- structural validation (the bundled schema's keywords) ----------
const TYPES = {
  object: (v) => v !== null && typeof v === 'object' && !Array.isArray(v),
  array: (v) => Array.isArray(v),
  string: (v) => typeof v === 'string',
  boolean: (v) => typeof v === 'boolean',
  integer: (v) => Number.isInteger(v),
  number: (v) => typeof v === 'number' && Number.isFinite(v),
  null: (v) => v === null,
};
const SUPPORTED_KEYWORDS = new Set(['$schema', 'title', 'description', '$defs', '$ref', 'oneOf', 'type', 'const', 'enum', 'minimum', 'properties', 'required', 'additionalProperties', 'items', 'minItems', 'uniqueItems', 'minLength']);
function canonical(v) {
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`;
  if (v && typeof v === 'object') return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canonical(v[k])}`).join(',')}}`;
  return JSON.stringify(v);
}
function deref(root, ref) {
  let node = root;
  for (const key of String(ref).replace(/^#\//, '').split('/')) {
    if (node == null || !Object.hasOwn(node, key)) throw new DoctrineLoadError(`Unresolvable schema reference ${ref}`);
    node = node[key];
  }
  return node;
}
export function structural(value, schema, root, at = '$') {
  if (schema == null || typeof schema !== 'object') return [`${at}: invalid schema node`];
  for (const k of Object.keys(schema)) if (!SUPPORTED_KEYWORDS.has(k)) return [`${at}: unsupported schema keyword ${k}`];
  if (schema.$ref) return structural(value, deref(root, schema.$ref), root, at);
  if (schema.oneOf) {
    const matches = schema.oneOf.filter((s) => structural(value, s, root, at).length === 0).length;
    return matches === 1 ? [] : [`${at}: expected exactly one schema alternative, got ${matches}`];
  }
  const errors = [];
  if (schema.type && !TYPES[schema.type]?.(value)) return [`${at}: expected ${schema.type}`];
  if (Object.hasOwn(schema, 'const') && (typeof value !== typeof schema.const || canonical(value) !== canonical(schema.const))) errors.push(`${at}: expected ${JSON.stringify(schema.const)}`);
  if (schema.enum && !schema.enum.some((e) => canonical(e) === canonical(value))) errors.push(`${at}: invalid enum value ${JSON.stringify(value)}`);
  if (Object.hasOwn(schema, 'minimum') && typeof value === 'number' && value < schema.minimum) errors.push(`${at}: below minimum ${schema.minimum}`);
  if (TYPES.object(value)) {
    const props = schema.properties || {};
    for (const key of schema.required || []) if (!Object.hasOwn(value, key)) errors.push(`${at}: missing ${key}`);
    for (const [key, item] of Object.entries(value)) {
      if (Object.hasOwn(props, key)) errors.push(...structural(item, props[key], root, `${at}.${key}`));
      else if (schema.additionalProperties === false) errors.push(`${at}: unknown field ${key}`);
      else if (TYPES.object(schema.additionalProperties)) errors.push(...structural(item, schema.additionalProperties, root, `${at}.${key}`));
    }
  }
  if (Array.isArray(value)) {
    if (value.length < (schema.minItems || 0)) errors.push(`${at}: too few entries`);
    if (schema.uniqueItems && new Set(value.map(canonical)).size !== value.length) errors.push(`${at}: duplicate entries`);
    if (schema.items) value.forEach((item, i) => errors.push(...structural(item, schema.items, root, `${at}[${i}]`)));
  }
  if (typeof value === 'string' && value.length < (schema.minLength || 0)) errors.push(`${at}: empty string`);
  return errors;
}

// ---------- predicates ----------
// Strict: exactly one of the four shapes, lists nonempty, fact IDs known. Anything else — a string,
// a number, an extra key, `not`, an empty list — is a load error, never a silent false.
export function predicateErrors(pred, facts, at = '$') {
  if (typeof pred === 'boolean') return [];
  if (!pred || typeof pred !== 'object' || Array.isArray(pred)) return [`${at}: predicate must be a Boolean, {fact}, {all} or {any}; got ${typeof pred === 'string' ? 'a string expression' : JSON.stringify(pred)}`];
  const keys = Object.keys(pred);
  if (keys.length !== 1) return [`${at}: predicate must have exactly one key, got ${keys.join(',') || 'none'}`];
  const [k] = keys;
  if (k === 'fact') {
    if (typeof pred.fact !== 'string' || !pred.fact) return [`${at}: fact ID must be a nonempty string`];
    return facts && !Object.hasOwn(facts, pred.fact) ? [`${at}: unknown fact reference ${pred.fact}`] : [];
  }
  if (k === 'all' || k === 'any') {
    if (!Array.isArray(pred[k]) || !pred[k].length) return [`${at}: ${k} must be a nonempty list`];
    return pred[k].flatMap((p, i) => predicateErrors(p, facts, `${at}.${k}[${i}]`));
  }
  return [`${at}: unsupported predicate operator ${k}`];
}
export function evaluate(pred, facts) {
  if (typeof pred === 'boolean') return pred;
  if (pred && typeof pred === 'object') {
    if (Object.hasOwn(pred, 'fact')) return facts?.[pred.fact] === true;
    if (Object.hasOwn(pred, 'all')) return pred.all.every((p) => evaluate(p, facts));
    if (Object.hasOwn(pred, 'any')) return pred.any.some((p) => evaluate(p, facts));
  }
  throw new DoctrineLoadError('Invalid predicate');
}
// The facts a predicate needs that are not true: what a deferral or a refusal is waiting on.
export function unmetFacts(pred, facts) {
  if (typeof pred === 'boolean') return pred ? [] : ['false'];
  if (Object.hasOwn(pred, 'fact')) return facts?.[pred.fact] === true ? [] : [pred.fact];
  if (Object.hasOwn(pred, 'all')) return [...new Set(pred.all.flatMap((p) => unmetFacts(p, facts)))];
  if (Object.hasOwn(pred, 'any')) return evaluate(pred, facts) ? [] : [`any(${[...new Set(pred.any.flatMap((p) => unmetFacts(p, facts)))].join('|')})`];
  return ['invalid'];
}
function walkPredicates(node, fn, at = '$') {
  // Every object that is exactly {fact} is a predicate leaf wherever it appears; that is how the
  // reference validator finds references and this does the same.
  if (Array.isArray(node)) node.forEach((v, i) => walkPredicates(v, fn, `${at}[${i}]`));
  else if (node && typeof node === 'object') {
    const keys = Object.keys(node);
    if (keys.length === 1 && keys[0] === 'fact') fn(node.fact, at);
    for (const [k, v] of Object.entries(node)) walkPredicates(v, fn, `${at}.${k}`);
  }
}

// ---------- references (the package's cross-catalogue rules) ----------
export function referenceErrors(d) {
  const errors = [];
  const require = (key, table, at) => { if (!d[table] || !Object.hasOwn(d[table], key)) errors.push(`${at}: unknown ${table} reference ${key}`); };
  walkPredicates(d, (fact, at) => require(fact, 'facts', at));
  // Every place the package puts a predicate, checked against the strict grammar as well.
  const predicateSites = [];
  for (const [n, a] of Object.entries(d.actions || {})) predicateSites.push([a, `actions.${n}`]);
  for (const [n, m] of Object.entries(d.engagementModes || {})) predicateSites.push([m, `engagementModes.${n}`]);
  for (const [n, r] of Object.entries(d.globalRules || {})) if (typeof r !== 'string') predicateSites.push([r, `globalRules.${n}`]);
  for (const [n, t] of Object.entries(d.roleTemplates || {})) (t.intentPriority || []).forEach((e, i) => predicateSites.push([e.when, `roleTemplates.${n}.intentPriority[${i}]`]));
  for (const [n, o] of Object.entries(d.objectiveTemplates || {})) { predicateSites.push([o.successWhen, `objectiveTemplates.${n}.successWhen`]); predicateSites.push([o.abortWhen, `objectiveTemplates.${n}.abortWhen`]); }
  for (const [n, r] of Object.entries(d.responseCatalog || {})) predicateSites.push([r.requires, `responseCatalog.${n}.requires`]);
  for (const group of ['profiles', 'cultures']) for (const [n, p] of Object.entries(d[group] || {})) (p.interestRules || []).forEach((r, i) => predicateSites.push([r.when, `${group}.${n}.interestRules[${i}]`]));
  for (const [pred, at] of predicateSites) errors.push(...predicateErrors(pred, d.facts, at));
  for (const [name, r] of Object.entries(d.roleTemplates || {})) {
    require(r.defaultObjective, 'objectiveTemplates', name);
    for (const entry of r.intentPriority || []) require(entry.action, 'actions', name);
    for (const action of r.sideActions || []) require(action, 'actions', name);
    const last = (r.intentPriority || []).at(-1);
    if (!(last && last.action === 'wait' && last.when === true)) errors.push(`${name}: no explicit final wait fallback`);
  }
  for (const [name, r] of Object.entries(d.responseCatalog || {})) {
    require(r.objective, 'objectiveTemplates', name);
    for (const role of r.eligibleRoles || []) require(role, 'roleTemplates', name);
  }
  for (const [name, p] of Object.entries(d.profiles || {})) {
    for (const source of p.sourceRefs || []) require(source, 'sources', name);
    for (const [role, policy] of Object.entries(p.rolePolicies || {})) {
      require(policy.template, 'roleTemplates', `${name}.${role}`);
      if (role !== policy.template) errors.push(`${name}.${role}: canonical role/template mismatch`);
      for (const mode of policy.engagementModes || []) require(mode, 'engagementModes', name);
    }
    if (p.unknownRole !== 'deny_assignment' && !Object.hasOwn(p.rolePolicies || {}, p.unknownRole)) errors.push(`${name}: unknown role fallback is unavailable`);
    if (p.status === 'dormant' && Object.values(p.generators || {}).some((v) => v !== 'disabled')) errors.push(`${name}: dormant profile allows routine generation`);
  }
  for (const group of ['profiles', 'cultures']) {
    for (const [name, p] of Object.entries(d[group] || {})) {
      const ids = (p.interestRules || []).map((r) => r.id);
      if (new Set(ids).size !== ids.length) errors.push(`${name}: duplicate interest rule ID`);
      for (const rule of p.interestRules || []) {
        require(rule.response, 'responseCatalog', name);
        for (const ev of rule.eventTypes || []) if (!(d.eventTypes || []).includes(ev)) errors.push(`${name}: unknown event ${ev}`);
      }
    }
  }
  for (const [name, role] of Object.entries(d.runtimeAdapter?.roleMap || {})) require(role, 'roleTemplates', name);
  require(d.runtimeAdapter?.dominionDefaultProfile, 'profiles', 'runtimeAdapter.dominionDefaultProfile');
  for (const ev of Object.keys(d.eventContracts || {})) if (!(d.eventTypes || []).includes(ev)) errors.push(`Unknown event contract ${ev}`);
  for (const treaty of d.scenarioTreaties || []) {
    for (const party of treaty.parties || []) require(party, 'profiles', treaty.id);
    for (const source of treaty.sourceRefs || []) require(source, 'sources', treaty.id);
  }
  // Runtime rule: two profiles may share a runtime key only through the explicit Dominion adapter.
  const byKey = {};
  for (const [name, p] of Object.entries(d.profiles || {})) (byKey[p.runtimeFaction] ||= []).push(name);
  for (const [key, list] of Object.entries(byKey)) {
    if (list.length < 2) continue;
    const dom = d.runtimeAdapter?.dominionDefaultProfile;
    if (!(list.includes(dom) && list.length === 2)) errors.push(`runtime faction ${key} maps to ${list.length} profiles (${list.join(', ')}) with no selection rule`);
  }
  return errors;
}

// ---------- loading ----------
// Validates structure and references, then compiles an immutable runtime view. Throws a
// DoctrineLoadError listing every problem: the game never runs a doctrine it could not validate.
export function loadDoctrine(data, schema, opts = {}) {
  if (!data || typeof data !== 'object') throw new DoctrineLoadError('Doctrine data is missing or not an object');
  if (!schema || typeof schema !== 'object') throw new DoctrineLoadError('Doctrine schema is missing or not an object');
  const structure = structural(data, schema, schema);
  if (structure.length) throw new DoctrineLoadError('Doctrine data does not match its schema', structure);
  const refs = referenceErrors(data);
  if (refs.length) throw new DoctrineLoadError('Doctrine references are invalid', refs);
  const d = deepFreeze(JSON.parse(JSON.stringify(data)));
  const profilesByFaction = {};
  for (const [name, p] of Object.entries(d.profiles)) (profilesByFaction[p.runtimeFaction] ||= []).push(name);
  const warnings = [];
  const compiled = {
    version: DOCTRINE_RUNTIME_VERSION,
    doctrineVersion: d.version,
    designStatus: d.status,
    data: d,
    profilesByFaction: deepFreeze(profilesByFaction),
    factIds: Object.freeze(Object.keys(d.facts)),
    warnings,
    warn(message) { if (!warnings.includes(message)) { warnings.push(message); opts.onWarning?.(message); } },
  };
  return compiled;
}
function deepFreeze(o) {
  if (o && typeof o === 'object' && !Object.isFrozen(o)) { Object.freeze(o); for (const v of Object.values(o)) deepFreeze(v); }
  return o;
}
// Facts handed to the evaluator must be known IDs with Boolean values, and never the policy-derived
// authority fact. A bad fact set is a programming error in an adapter, so it throws.
export function checkFacts(doctrine, facts) {
  for (const [k, v] of Object.entries(facts || {})) {
    if (!Object.hasOwn(doctrine.data.facts, k)) throw new DoctrineLoadError(`Unknown input fact ${k}`);
    if (typeof v !== 'boolean') throw new DoctrineLoadError(`Fact ${k} must be Boolean`);
  }
  if (Object.hasOwn(facts || {}, 'engagement_authorized')) throw new DoctrineLoadError('engagement_authorized is policy-derived and cannot be injected');
  return facts;
}

// ---------- profile and role selection ----------
// Hull origin never selects a profile. The caller supplies the actor's COMMAND identity (runtime
// faction key of whoever controls it) and, for the shared Dominion key, the three conditions the
// package requires for the Central profile. Anything else resolves to the one profile for the key, or
// to null when the doctrine has none (the actor then has no doctrine: record-only, never a response).
export function resolveProfile(doctrine, actor = {}) {
  const d = doctrine.data;
  const key = actor.runtimeFaction;
  if (key === 'dominion') {
    const central = actor.centralAuthority === true && actor.scenarioActivated === true && actor.ordersReceived === true;
    const missing = [!actor.centralAuthority && 'central command authority', !actor.scenarioActivated && 'scenario activation', !actor.ordersReceived && 'received orders'].filter(Boolean);
    return central ? { profileId: 'dominion_central', reason: 'central authority, scenario activation and received orders' }
      : { profileId: d.runtimeAdapter.dominionDefaultProfile, reason: `Dominion default: missing ${missing.join(', ')}` };
  }
  const candidates = doctrine.profilesByFaction[key] || [];
  if (candidates.length === 1) return { profileId: candidates[0], reason: `runtime faction ${key}` };
  doctrine.warn(`No doctrine profile for runtime faction ${JSON.stringify(key)}: actor falls back to record-only.`);
  return { profileId: null, reason: `no profile for ${key}: record-only fallback` };
}
export function profileEnabled(doctrine, profileId, ctx = {}) {
  const p = doctrine.data.profiles[profileId];
  if (!p) return false;
  return p.activation !== 'disabled' && (p.activation !== 'scenario_activation' || ctx.scenarioActivated === true);
}
// The reference role selection: a supported canonical role; an unsupported canonical role is denied;
// a legacy native role goes through roleMap, falling back to the profile's safe unknownRole.
export function selectRole(doctrine, profileId, role) {
  const d = doctrine.data;
  const p = d.profiles[profileId];
  if (!p) return 'deny_assignment';
  if (Object.hasOwn(p.rolePolicies, role)) return role;
  if (Object.hasOwn(d.roleTemplates, role)) return 'deny_assignment';
  const mapped = Object.hasOwn(d.runtimeAdapter.roleMap, role) ? d.runtimeAdapter.roleMap[role] : p.unknownRole;
  return Object.hasOwn(p.rolePolicies, mapped) ? mapped : 'deny_assignment';
}
// Overlay for a runtime actor. Native fields (playerEscort, fleetId, combat-credit fields) are read,
// never renamed or written: an explicit doctrineRole wins when valid, the native role maps otherwise.
export function actorDoctrine(doctrine, actor = {}) {
  const prof = resolveProfile(doctrine, actor);
  if (!prof.profileId) return { profileId: null, role: 'deny_assignment', culture: null, profileReason: prof.reason, roleReason: 'no profile', nativeRole: actor.nativeRole ?? null };
  const native = actor.playerEscort ? 'playerEscort' : actor.fleetId ? 'playerFleet' : actor.nativeRole ?? null;
  let role, roleReason;
  if (actor.doctrineRole) {
    role = selectRole(doctrine, prof.profileId, actor.doctrineRole);
    roleReason = role === 'deny_assignment' ? `explicit doctrineRole ${actor.doctrineRole} unsupported by ${prof.profileId}` : `explicit doctrineRole ${actor.doctrineRole}`;
  } else {
    role = selectRole(doctrine, prof.profileId, native ?? '__unrecognized__');
    roleReason = native ? `native role ${native} via roleMap` : 'no native role: profile unknownRole fallback';
  }
  const culture = actor.cultureId && doctrine.data.cultures[actor.cultureId] ? actor.cultureId : null;
  return { profileId: prof.profileId, role, culture, profileReason: prof.reason, roleReason, nativeRole: native };
}

// ---------- reaction to a known event ----------
// The package's responseSelection, with the reasons kept: first matching faction rule, then local
// culture rules; a matched response whose role or prerequisites fail is DEFERRED, never replaced by a
// different response; no match is record_only; an unknown event is ignore_unknown.
// `capacityFor(response)` lets the caller compute can_respond for the response actually matched (the
// capacity to investigate is not the capacity to rescue); without it the facts are used as given.
export function react(doctrine, { profileId, role, culture = null, eventType, facts = {}, capacityFor = null, scenarioActivated = false }) {
  const d = doctrine.data;
  checkFacts(doctrine, facts);
  const out = { profileId, role, culture, eventType, result: null, matchedRule: null, response: null, deferred: false, failed: [], roleEligible: null, capacity: null };
  const p = d.profiles[profileId];
  if (!p) return { ...out, result: 'record_only', reason: 'no doctrine profile: record-only fallback' };
  if (!profileEnabled(doctrine, profileId, { scenarioActivated })) return { ...out, result: 'inactive', reason: `profile ${profileId} is not active` };
  const selected = selectRole(doctrine, profileId, role);
  out.roleSelected = selected;
  if (facts.event_known !== true) return { ...out, result: 'ignore_unknown', reason: 'this actor has not received or observed the event' };
  const rules = [...p.interestRules.map((r) => ({ r, source: 'profile' })), ...(culture && d.cultures[culture] ? d.cultures[culture].interestRules.map((r) => ({ r, source: 'culture' })) : [])];
  for (const { r, source } of rules) {
    if (!r.eventTypes.includes(eventType) || !evaluate(r.when, facts)) continue;
    const response = d.responseCatalog[r.response];
    const f = { ...facts };
    if (capacityFor) { out.capacity = capacityFor(r.response); f.can_respond = out.capacity?.ok === true; }
    out.matchedRule = { id: r.id, source, reason: r.reason };
    out.response = r.response;
    out.roleEligible = response.eligibleRoles.includes(selected);
    const unmet = unmetFacts(response.requires, f);
    if (!out.roleEligible || unmet.length) {
      out.failed = [...(!out.roleEligible ? [`role:${selected} not eligible for ${r.response}`] : []), ...unmet];
      return { ...out, deferred: true, result: `defer:${r.response}`, reason: `matched ${r.id}; waiting on ${out.failed.join(', ')}` };
    }
    return { ...out, result: r.response, reason: `matched ${r.id}: ${r.reason}` };
  }
  return { ...out, result: p.unmatchedKnownEvent, reason: 'known, but no interest rule of this actor matches' };
}

// ---------- intents, fire and objectives ----------
function withAuthority(doctrine, profileId, role, facts) {
  const d = doctrine.data;
  const policy = d.profiles[profileId].rolePolicies[role];
  const f = { ...facts };
  const modes = policy.engagementModes.filter((m) => evaluate(d.engagementModes[m], f));
  f.engagement_authorized = modes.length > 0 && f.engagement_objective_active === true;
  return { f, modes, policy };
}
export function intent(doctrine, { profileId, role, facts = {}, scenarioActivated = false }) {
  const d = doctrine.data;
  checkFacts(doctrine, facts);
  if (!profileEnabled(doctrine, profileId, { scenarioActivated })) return { action: 'inactive' };
  const selected = selectRole(doctrine, profileId, role);
  if (selected === 'deny_assignment') return { action: 'deny_assignment' };
  const { f, policy } = withAuthority(doctrine, profileId, selected, facts);
  for (const entry of d.roleTemplates[policy.template].intentPriority) {
    if (evaluate(entry.when, f) && evaluate(d.actions[entry.action], f)) return { action: entry.action, role: selected, authorized: f.engagement_authorized };
  }
  throw new DoctrineLoadError('Role template has no fallback');
}
// Whether a shot is authorised: the role's engagement authority AND every physical requirement. The
// physical facts are the engine's own (live track, installed and usable weapon, ready, inside the
// equipped range, target still actionable) — doctrine can withhold fire, never grant a shot the engine
// would refuse.
export function fireDecision(doctrine, { profileId, role, facts = {}, scenarioActivated = false }) {
  const d = doctrine.data;
  checkFacts(doctrine, facts);
  if (!profileEnabled(doctrine, profileId, { scenarioActivated })) return { allowed: false, reason: 'profile inactive', failed: ['profile_inactive'] };
  const selected = selectRole(doctrine, profileId, role);
  if (selected === 'deny_assignment') return { allowed: false, reason: 'role denied', failed: ['deny_assignment'] };
  const { f, modes } = withAuthority(doctrine, profileId, selected, facts);
  const physical = unmetFacts(d.globalRules.fireRequires, f);
  const failed = [...(f.engagement_authorized ? [] : ['engagement_authorized']), ...physical];
  return { allowed: f.engagement_authorized && physical.length === 0, modes, role: selected, failed };
}
// Closure precedence: cancellation, abort or deadline beats success when both hold, and both reasons
// are reported.
export function objectiveStatus(doctrine, templateId, facts = {}) {
  const o = doctrine.data.objectiveTemplates[templateId];
  if (!o) throw new DoctrineLoadError(`Unknown objective template ${templateId}`);
  checkFacts(doctrine, facts);
  const abort = evaluate(o.abortWhen, facts), success = evaluate(o.successWhen, facts);
  const abortReasons = o.abortWhen.any ? o.abortWhen.any.filter((p) => evaluate(p, facts)).map((p) => p.fact) : [];
  const successReasons = o.successWhen.any ? o.successWhen.any.filter((p) => evaluate(p, facts)).map((p) => p.fact) : [];
  if (abort) return { status: 'aborted', reasons: abortReasons, alsoSucceeded: success ? successReasons : [] };
  if (success) return { status: 'completed', reasons: successReasons };
  return { status: 'open', reasons: [] };
}
export function generatorAllowed(doctrine, profileId, generator, ctx = {}) {
  const p = doctrine.data.profiles[profileId];
  if (!p || !profileEnabled(doctrine, profileId, ctx)) return false;
  return ctx.rosterEnabled === true && p.generators[generator] === 'requires_assignment_and_budget' && ctx.assignmentExists === true && ctx.budgetExists === true;
}

// ---------- typed events ----------
export function eventErrors(doctrine, event) {
  const contract = doctrine.data.eventContracts?.[event?.eventType];
  if (!contract) return ['Unknown typed event contract'];
  const schema = contract.payloadSchema;
  const errors = structural(event, schema, schema, 'event');
  if (errors.length) return errors;
  if (event.eventType === 'asset_overdue') {
    const { cargo, lastKnown: last, missedMilestone: milestone, detectedAt: detected } = event;
    if ((cargo.knowledge === 'unknown') !== (cargo.manifest === null)) errors.push('Unknown cargo must remain null; known cargo must have a manifest.');
    if (last.position !== null && (last.locationId === null || last.observedAt === null)) errors.push('A last-known position requires a location and observation timestamp.');
    if (detected.clock !== milestone.dueAt.clock) errors.push('Overdue detection and deadline must use the same clock.');
    else if (detected.value <= milestone.dueAt.value + milestone.grace) errors.push('Milestone is not overdue beyond its grace period.');
  }
  return errors;
}

// ---------- the package's acceptance cases, run by this runtime ----------
export function runAcceptanceCase(doctrine, c) {
  const d = doctrine.data;
  const facts = { ...(c.facts || {}) };
  checkFacts(doctrine, facts);
  const op = c.operation;
  if (op === 'validate_event') return eventErrors(doctrine, c.event).length === 0;
  if (c.event) {
    const errors = eventErrors(doctrine, c.event);
    if (errors.length) throw new DoctrineLoadError(`${c.id}: ${errors.join('; ')}`);
    if (c.event.eventType !== c.eventType) throw new DoctrineLoadError('Event type and fixture disagree');
  }
  if (op === 'end') return objectiveStatus(doctrine, c.objective, facts).status;
  if (op === 'resolve_profile') return resolveProfile(doctrine, { runtimeFaction: c.runtimeFaction, centralAuthority: c.centralAuthority === true, scenarioActivated: c.scenarioActivated === true, ordersReceived: c.ordersReceived === true }).profileId;
  const ctx = { scenarioActivated: c.scenarioActivated === true };
  if (op === 'generate') return generatorAllowed(doctrine, c.profile, c.generator, { ...ctx, rosterEnabled: c.rosterEnabled === true, assignmentExists: c.assignmentExists === true, budgetExists: c.budgetExists === true });
  if (op === 'react') return react(doctrine, { profileId: c.profile, role: c.role, culture: c.culture || null, eventType: c.eventType, facts, ...ctx }).result;
  if (op === 'intent') return intent(doctrine, { profileId: c.profile, role: c.role, facts, ...ctx }).action;
  if (op === 'fire') return fireDecision(doctrine, { profileId: c.profile, role: c.role, facts, ...ctx }).allowed;
  if (!profileEnabled(doctrine, c.profile, ctx)) return false;
  throw new DoctrineLoadError(`Unknown operation ${op}`);
}
export function runAcceptance(doctrine, cases) {
  return cases.map((c) => {
    let actual, error = null;
    try { actual = runAcceptanceCase(doctrine, c); } catch (e) { error = e.message; }
    const ok = !error && typeof actual === typeof c.expected && actual === c.expected;
    return { id: c.id, operation: c.operation, expected: c.expected, actual, ok, error };
  });
}
