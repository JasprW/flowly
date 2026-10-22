#!/usr/bin/env python3
"""Verify actual per-turn PR outputs using public receipt fields and independently fetched GitHub state."""
import json
import pathlib

here = pathlib.Path(__file__).resolve().parent
data = json.loads((here / 'final-capture.json').read_text())
prs = json.loads((here / 'github-prs.json').read_text())
results = []
for session in data['state']['sessions']:
    if not session['key'].endswith('-r2'):
        continue
    linked = [a for a in data['artifacts'] if a['taskId'] == session['cardId'] and '/pull/' in a['target'] and a['role'] == 'output']
    matching = [r for r in data['receipts'] if r['agentId'] == session['id'] and r['at'] >= session['followupAt'] and r['status'] == 'in_review' and any(a['id'] in r.get('artifactIds', []) for a in linked)]
    merged = [p for p in prs if p['state'] == 'MERGED' and any(p['url'] == a['target'] for a in linked)]
    task = next(t for t in data['tasks'] if t['id'] == session['cardId'])
    passed = bool(linked and matching and merged and task['status'] == 'in_review')
    results.append({'key': session['key'], 'session': session['id'], 'pass': passed, 'prUrls': [p['url'] for p in merged], 'receiptIds': [r['eventId'] for r in matching], 'followupAt': session['followupAt'], 'deliveryAt': [r['at'] for r in matching], 'notices': [r['notice'] for r in matching if r.get('notice')]})
(here / 'results.json').write_text(json.dumps(results, ensure_ascii=False, indent=2) + '\n')
print(json.dumps(results, ensure_ascii=False, indent=2))
if len(results) != 2 or not all(r['pass'] for r in results):
    raise SystemExit('Live verification incomplete or failed.')
