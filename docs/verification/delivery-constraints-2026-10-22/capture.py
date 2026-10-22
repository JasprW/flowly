#!/usr/bin/env python3
"""Capture only owned fixture facts and selected tool fields; never credentials or signed requests."""
import json
import pathlib
import re
import sys

here = pathlib.Path(__file__).resolve().parent
home = pathlib.Path.home()
state = json.loads((here / 'live-state.json').read_text())
board = json.loads((home / '.paseo/plugin-data/flowly/board.json').read_text())
cards = {c['id'] for c in state['cards']}
sessions = {s['id'] for s in state['sessions']}
flow_file = home / '.paseo/plugin-data/flowly/flow' / (state['projectId'] + '.jsonl')
events = [json.loads(line) for line in flow_file.read_text().splitlines() if line]
events = [e for e in events if e.get('taskId') in cards]
receipts = [{k: r[k] for k in ['agentId', 'taskId', 'action', 'eventId', 'status', 'at', 'artifactIds', 'notice'] if k in r}
            for r in board.get('agentReceipts', []) if r['agentId'] in sessions]
calls = []
for session in state['sessions']:
    agent_file = next((home / '.paseo/agents').glob('*/' + session['id'] + '.json'))
    agent = json.loads(agent_file.read_text())
    sid = agent.get('persistence', {}).get('sessionId')
    if agent['provider'] == 'claude':
        file = next((home / '.claude/projects').glob('*/' + sid + '.jsonl'))
        uses = {}
        for line in file.read_text().splitlines():
            row = json.loads(line)
            content = row.get('message', {}).get('content')
            if not isinstance(content, list):
                continue
            for item in content:
                if item.get('type') == 'tool_use' and item.get('name', '').startswith('mcp__flowly__'):
                    args = item.get('input', {})
                    call = {'session': session['id'], 'at': row.get('timestamp'), 'tool': item['name'], 'input': {k: v for k, v in args.items() if k in ['status', 'kind', 'note', 'outputs', 'acknowledgeOpen', 'target', 'role']}}
                    calls.append(call)
                    uses[item['id']] = call
                elif item.get('type') == 'tool_result' and item.get('tool_use_id') in uses:
                    raw = item.get('content', '')
                    text = raw if isinstance(raw, str) else '\n'.join(i.get('text', '') for i in raw if isinstance(i, dict))
                    try:
                        result = json.loads(text)
                    except (ValueError, TypeError):
                        result = None
                    if isinstance(result, dict):
                        if 'code' in result:
                            uses[item['tool_use_id']]['error'] = {k: result[k] for k in ['code', 'message'] if k in result}
                        if 'receipt' in result:
                            uses[item['tool_use_id']]['receipt'] = {k: result['receipt'][k] for k in ['action', 'status', 'at', 'eventId', 'artifactIds'] if k in result['receipt']}
    else:
        files = list((home / '.codex/sessions/2026/10/22').glob('*' + sid + '.jsonl'))
        for file in files:
            for line in file.read_text().splitlines():
                row = json.loads(line)
                payload = row.get('payload', {})
                if payload.get('type') not in ['custom_tool_call', 'function_call']:
                    continue
                src = payload.get('input', payload.get('arguments', ''))
                if not isinstance(src, str):
                    continue
                names = re.findall(r'mcp__flowly__flowly_([a-z_]+)\s*\(', src)
                if names:
                    calls.append({'session': session['id'], 'at': row.get('timestamp'), 'tools': names, 'declaresOutputs': bool(re.search(r'outputs\s*:', src)), 'mentionsPullUrl': '/pull/' in src})

out = {'at': __import__('datetime').datetime.now(__import__('datetime').timezone.utc).isoformat(), 'state': state, 'events': events, 'receipts': receipts, 'calls': calls,
       'tasks': [t for t in board['tasks'] if t['id'] in cards], 'artifacts': [a for a in board['artifacts'] if a['taskId'] in cards], 'workpads': [w for w in board['workpads'] if w['taskId'] in cards]}
name = sys.argv[1] if len(sys.argv) > 1 else 'captured'
if not re.fullmatch('[a-z0-9-]+', name):
    raise SystemExit('Bad evidence name')
(here / (name + '.json')).write_text(json.dumps(out, ensure_ascii=False, indent=2) + '\n')
print(json.dumps({'file': name + '.json', 'calls': len(calls), 'events': len(events), 'artifacts': len(out['artifacts']), 'errors': [c['error'] for c in calls if 'error' in c]}, ensure_ascii=False))
