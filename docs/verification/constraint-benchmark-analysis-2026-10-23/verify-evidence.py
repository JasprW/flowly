"""Read-only verification of the saved evidence used by this analysis."""
import hashlib
import json
import re
from pathlib import Path

root = Path(__file__).resolve().parents[3]
folder = Path(__file__).resolve().parent
ownership = json.loads((folder / "ownership.json").read_text())
for name, digest in ownership["preservedHashes"].items():
    assert hashlib.sha256((root / name).read_bytes()).hexdigest() == digest, name

run = root / "docs/verification/constraint-benchmark/20261023020035204-8b1863"
facts = json.loads((run / "facts.json").read_text())
sonnet = next(s for s in facts["sessions"] if s["model"] == "claude-sonnet-5-5")
gpt = next(s for s in facts["sessions"] if s["model"] == "gpt-6-luna")
t2 = next(t for t in sonnet["turns"] if t["id"] == "T2")
t1 = next(t for t in gpt["turns"] if t["id"] == "T1")
for turn in [t2, t1]:
    assert turn["state"] == "VALID"
    assert all(turn[k] for k in ["complete", "flowComplete", "timelineComplete", "receiptsComplete"])
    assert not turn["providerDiagnostics"]

assert len(t2["calls"]) == 1
assert t2["calls"][0]["id"] == "toolu_016nrkwiryvY7rFiKiHGPwhm"
assert t2["calls"][0]["kind"] == "opaque"
assert not t2["receipts"]
assert t2["before"]["workpad"]["revision"] == t2["after"]["workpad"]["revision"] == 2
assert not any(e.get("actor") == "agent" for e in t2["events"])
assert any(e["action"] == "agent.turn_ended" for e in t2["events"])
assert any(e["action"] == "status_changed" and e["actor"] == "system" and e.get("to") == "in_review" for e in t2["events"])

by_id = {c["id"]: c for c in t1["calls"]}
edit = by_id["exec-ab150483-6504-4de3-8913-a21864a2d378"]
check = by_id["exec-8e3488b4-75fa-48d3-99e4-1d8d7b26224f"]
switch = by_id["exec-d5048d23-a83b-48a4-91f3-cf3a8f738844"]
read_after = by_id["exec-8b2bdd35-d3f6-4d80-a62e-8fe1681da1d6"]
delivery = by_id["exec-f23fa5e1-e826-46d9-a7f7-98213513c9bc"]
assert edit["kind"] == "edit" and check["kind"] == "check" and check["exitCode"] == 0
assert edit["endSeq"] < check["seq"] < check["endSeq"] < read_after["seq"] < switch["seq"]
assert all(c["task"]["status"] == "development" for c in read_after["contexts"])
assert switch["input"]["status"] == "test"
assert "开始登记" in switch["input"]["note"]
assert delivery["action"] == "report_progress" and delivery["input"]["kind"] == "result"
assert "未提交，卡片保持 Test" in delivery["input"]["note"]
assert not any(r["action"] == "status" and r["status"] == "in_review" for r in t1["receipts"])
receipt = next(r for r in t1["receipts"] if r["eventId"] == "639e92e4-7c68-4594-8b83-e70cb946e1f6")
assert receipt["artifactIds"] == ["db0d2371-4138-465a-b0ce-9f848e7a8206"]
assert any(a["id"] in receipt["artifactIds"] and a["role"] == "output" and a["target"].removeprefix("./") == gpt["filename"] for a in t1["after"]["artifacts"])
assert any(e["action"] == "next_moves_suggested" and e.get("offered") == 1 for e in t1["events"])

projection = json.loads((folder / "evidence.json").read_text())
assert projection["sourceHash"] == hashlib.sha256((run / "facts.json").read_bytes()).hexdigest()
assert [(s["sessionId"], s["turn"]) for s in projection["selected"]] == [(sonnet["id"], "T2"), (gpt["id"], "T1")]
manifest = json.loads((run / "manifest.json").read_text())
assert manifest["runtime"]["loadedImplementationHash"] == "unknown"
assert manifest["runtime"]["skillHash"] == hashlib.sha256((root / "skills/flowly/SKILL.md").read_bytes()).hexdigest()
proposed = re.findall(r'^> (.+)$', (folder / "report.md").read_text(), re.M)
assert len(proposed) == 2
rules = re.findall(r'^  "(.*)",$', (root / "shared/turn-checklist.ts").read_text(), re.M)
assert len(rules) == 6
rules[1], rules[4] = proposed
assert sum(map(len, rules)) <= 1800
print(json.dumps({"status": "PASS", "protectedFiles": len(ownership["preservedHashes"]), "selectedTurns": 2,
                  "proposedRuleCount": len(rules), "proposedCharacters": sum(map(len, rules)),
                  "modelsRun": 0, "productRulesChanged": False}, ensure_ascii=False))
