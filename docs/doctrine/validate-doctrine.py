#!/usr/bin/env python3
"""Validate doctrine structure/references and run an offline reference policy model.

No dependencies. This is not game integration or a replacement for the Chromium
combat probe. The structural validator implements only this bundled schema's
keywords; use a full JSON Schema implementation for arbitrary external schemas.
"""
import argparse
import json
import math
from pathlib import Path

HERE = Path(__file__).resolve().parent


def structural(value, schema, root, at='$'):
    errors = []
    if '$ref' in schema:
        ref = root
        for key in schema['$ref'].removeprefix('#/').split('/'):
            ref = ref[key]
        return structural(value, ref, root, at)
    if 'oneOf' in schema:
        matches = sum(not structural(value, s, root, at) for s in schema['oneOf'])
        return [] if matches == 1 else [f'{at}: expected exactly one schema alternative, got {matches}']
    types = {'object': lambda v: isinstance(v, dict),
             'array': lambda v: isinstance(v, list),
             'string': lambda v: isinstance(v, str),
             'boolean': lambda v: isinstance(v, bool),
             'integer': lambda v: isinstance(v, int) and not isinstance(v, bool),
             'number': lambda v: isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v),
             'null': lambda v: v is None}
    if 'type' in schema and not types[schema['type']](value):
        return [f'{at}: expected {schema["type"]}']
    if 'const' in schema and (type(value) is not type(schema['const']) or value != schema['const']):
        errors.append(f'{at}: expected {schema["const"]!r}')
    if 'enum' in schema and value not in schema['enum']:
        errors.append(f'{at}: invalid enum value {value!r}')
    if 'minimum' in schema and value < schema['minimum']:
        errors.append(f'{at}: below minimum {schema["minimum"]}')
    if isinstance(value, dict):
        properties = schema.get('properties', {})
        for key in schema.get('required', []):
            if key not in value: errors.append(f'{at}: missing {key}')
        for key, item in value.items():
            if key in properties:
                errors += structural(item, properties[key], root, f'{at}.{key}')
            elif schema.get('additionalProperties') is False:
                errors.append(f'{at}: unknown field {key}')
            elif isinstance(schema.get('additionalProperties'), dict):
                errors += structural(item, schema['additionalProperties'], root, f'{at}.{key}')
    if isinstance(value, list):
        if len(value) < schema.get('minItems', 0): errors.append(f'{at}: too few entries')
        if schema.get('uniqueItems') and len({json.dumps(v, sort_keys=True) for v in value}) != len(value):
            errors.append(f'{at}: duplicate entries')
        if 'items' in schema:
            for i, item in enumerate(value): errors += structural(item, schema['items'], root, f'{at}[{i}]')
    if isinstance(value, str) and len(value) < schema.get('minLength', 0): errors.append(f'{at}: empty string')
    return errors


def references(d):
    errors = []
    def require(key, table, at):
        if key not in d[table]: errors.append(f'{at}: unknown {table} reference {key}')
    def walk(node, at):
        if isinstance(node, dict):
            if set(node) == {'fact'}: require(node['fact'], 'facts', at)
            for k, v in node.items(): walk(v, f'{at}.{k}')
        elif isinstance(node, list):
            for i, v in enumerate(node): walk(v, f'{at}[{i}]')
    walk(d, '$')
    for name, r in d['roleTemplates'].items():
        require(r['defaultObjective'], 'objectiveTemplates', name)
        for entry in r['intentPriority']: require(entry['action'], 'actions', name)
        for action in r['sideActions']: require(action, 'actions', name)
        if r['intentPriority'][-1] != {'action': 'wait', 'when': True}:
            errors.append(f'{name}: no explicit final wait fallback')
    for name, r in d['responseCatalog'].items():
        require(r['objective'], 'objectiveTemplates', name)
        for role in r['eligibleRoles']: require(role, 'roleTemplates', name)
    for name, p in d['profiles'].items():
        for source in p['sourceRefs']: require(source, 'sources', name)
        for role, policy in p['rolePolicies'].items():
            require(policy['template'], 'roleTemplates', f'{name}.{role}')
            if role != policy['template']: errors.append(f'{name}.{role}: canonical role/template mismatch')
            for mode in policy['engagementModes']: require(mode, 'engagementModes', name)
        if p['unknownRole'] != 'deny_assignment' and p['unknownRole'] not in p['rolePolicies']:
            errors.append(f'{name}: unknown role fallback is unavailable')
        if p['status'] == 'dormant' and any(v != 'disabled' for v in p['generators'].values()):
            errors.append(f'{name}: dormant profile allows routine generation')
    for group in ('profiles','cultures'):
        for name, p in d[group].items():
            ids = [r['id'] for r in p['interestRules']]
            if len(ids) != len(set(ids)): errors.append(f'{name}: duplicate interest rule ID')
            for rule in p['interestRules']:
                require(rule['response'], 'responseCatalog', name)
                for event in rule['eventTypes']:
                    if event not in d['eventTypes']: errors.append(f'{name}: unknown event {event}')
    for name, role in d['runtimeAdapter']['roleMap'].items(): require(role, 'roleTemplates', name)
    for event in d.get('eventContracts',{}):
        if event not in d['eventTypes']: errors.append(f'Unknown event contract {event}')
    for treaty in d['scenarioTreaties']:
        for party in treaty['parties']: require(party, 'profiles', treaty['id'])
        for source in treaty['sourceRefs']: require(source, 'sources', treaty['id'])
    return errors


def evaluate(rule, facts):
    if isinstance(rule, bool): return rule
    if 'fact' in rule: return facts.get(rule['fact']) is True
    if 'all' in rule: return all(evaluate(r, facts) for r in rule['all'])
    if 'any' in rule: return any(evaluate(r, facts) for r in rule['any'])
    raise ValueError('Invalid predicate')


def selected_role(d, profile, role):
    if role in profile['rolePolicies']: return role
    # An explicitly named canonical role which this profile does not support is denied.
    if role in d['roleTemplates']: return 'deny_assignment'
    mapped = d['runtimeAdapter']['roleMap'].get(role, profile['unknownRole'])
    return mapped if mapped in profile['rolePolicies'] else 'deny_assignment'


def event_errors(d, event):
    contract=d.get('eventContracts',{}).get(event.get('eventType'))
    if not contract: return ['Unknown typed event contract']
    schema=contract['payloadSchema']
    errors=structural(event,schema,schema,'event')
    if errors: return errors
    if event['eventType']=='asset_overdue':
        cargo=event['cargo']
        if (cargo['knowledge']=='unknown') != (cargo['manifest'] is None):
            errors.append('Unknown cargo must remain null; known cargo must have a manifest.')
        last=event['lastKnown']
        if last['position'] is not None and (last['locationId'] is None or last['observedAt'] is None):
            errors.append('A last-known position requires a location and observation timestamp.')
        milestone=event['missedMilestone']; detected=event['detectedAt']; due=milestone['dueAt']
        if detected['clock'] != due['clock']:
            errors.append('Overdue detection and deadline must use the same clock.')
        elif detected['value'] <= due['value']+milestone['grace']:
            errors.append('Milestone is not overdue beyond its grace period.')
    return errors


def run_case(d, c):
    facts = dict(c.get('facts', {}))
    if set(facts) - set(d['facts']): raise ValueError(f'{c["id"]}: unknown input facts')
    if any(type(v) is not bool for v in facts.values()): raise ValueError('Facts must be Boolean')
    if 'engagement_authorized' in facts: raise ValueError('Cannot inject policy-derived authority')
    op = c['operation']
    if op == 'validate_event': return not event_errors(d,c['event'])
    if 'event' in c:
        errors=event_errors(d,c['event'])
        if errors: raise ValueError(f'{c["id"]}: '+ '; '.join(errors))
        if c['event']['eventType'] != c.get('eventType'): raise ValueError('Event type and fixture disagree')
    if op == 'end':
        o = d['objectiveTemplates'][c['objective']]
        if evaluate(o['abortWhen'], facts): return 'aborted'
        if evaluate(o['successWhen'], facts): return 'completed'
        return 'open'
    if op == 'resolve_profile':
        if c['runtimeFaction'] == 'dominion':
            return 'dominion_central' if c.get('centralAuthority') and c.get('scenarioActivated') and c.get('ordersReceived') else d['runtimeAdapter']['dominionDefaultProfile']
        candidates = [k for k,p in d['profiles'].items() if p['runtimeFaction'] == c['runtimeFaction']]
        return candidates[0] if len(candidates) == 1 else None
    p = d['profiles'][c['profile']]
    enabled = p['activation'] != 'disabled' and (p['activation'] != 'scenario_activation' or c.get('scenarioActivated') is True)
    if op == 'generate':
        return enabled and c.get('rosterEnabled') is True and p['generators'][c['generator']] == 'requires_assignment_and_budget' and c.get('assignmentExists') is True and c.get('budgetExists') is True
    if not enabled: return 'inactive' if op in ('react','intent') else False
    role = selected_role(d, p, c['role'])
    if op == 'react':
        if not facts.get('event_known'): return 'ignore_unknown'
        rules = list(p['interestRules'])
        if c.get('culture'): rules += d['cultures'][c['culture']]['interestRules']
        for rule in rules:
            if c['eventType'] not in rule['eventTypes'] or not evaluate(rule['when'],facts): continue
            response = d['responseCatalog'][rule['response']]
            if role not in response['eligibleRoles'] or not evaluate(response['requires'],facts): return 'defer:'+rule['response']
            return rule['response']
        return p['unmatchedKnownEvent']
    if role == 'deny_assignment': return 'deny_assignment' if op == 'intent' else False
    policy = p['rolePolicies'][role]
    facts['engagement_authorized'] = any(evaluate(d['engagementModes'][m],facts) for m in policy['engagementModes']) and facts.get('engagement_objective_active') is True
    if op == 'fire': return facts['engagement_authorized'] and evaluate(d['globalRules']['fireRequires'],facts)
    if op == 'intent':
        for entry in d['roleTemplates'][policy['template']]['intentPriority']:
            if evaluate(entry['when'],facts) and evaluate(d['actions'][entry['action']],facts): return entry['action']
        raise ValueError('Missing fallback')
    raise ValueError('Unknown operation '+op)


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--doctrine',type=Path,default=HERE/'bm1-faction-doctrine.v0.2.1.json')
    args=parser.parse_args()
    d=json.loads(args.doctrine.read_text())
    schema=json.loads((HERE/'bm1-faction-doctrine.schema.json').read_text())
    errors=structural(d,schema,schema)
    if not errors: errors=references(d)
    if errors:
        for error in errors: print('INVALID',error)
        return 1
    print(f'Structure and references: PASS ({len(d["profiles"])} profiles; {len(d["cultures"])} cultures)')
    cases=json.loads((HERE/'doctrine-acceptance.json').read_text())['cases']
    failed=0
    for c in cases:
        actual=run_case(d,c)
        ok=type(actual) is type(c['expected']) and actual==c['expected']
        print(f'{"PASS" if ok else "FAIL"} {c["id"]}: {actual!r}'+('' if ok else f' (expected {c["expected"]!r})'))
        failed+=not ok
    print(f'{len(cases)-failed}/{len(cases)} offline doctrine contract cases passed. Game behavior not tested.')
    return int(bool(failed))


if __name__=='__main__': raise SystemExit(main())
