"""Offline checklist scope and immutable-evidence verification."""
import hashlib
import json
import re
from pathlib import Path

folder = Path(__file__).resolve().parent
root = folder.parents[2]
state = json.loads((folder / "ownership.json").read_text())
rules = re.findall(r'^  "(.*)",$', (root / "shared/turn-checklist.ts").read_text(), re.M)
approved = json.loads((root / "docs/verification/constraint-benchmark-advisor-2026-10-23/proposed-checklist.json").read_text())["rules"]
assert rules == approved
assert [i + 1 for i, (a, b) in enumerate(zip(state["originalRules"], rules)) if a != b] == [2, 5]
assert len(rules) == 6 and len("\n".join(rules)) == 1583
skill = (root / "skills/flowly/SKILL.md").read_text()
assert re.findall(r'^\d\. (.*)$', skill.split("## Details", 1)[0], re.M) == rules
assert hashlib.sha256(skill.split("## Details", 1)[1].encode()).hexdigest() == state["originalSkillDetailsHash"]
assert hashlib.sha256((root / "server/skill-source.ts").read_bytes()).hexdigest() == state["generatorUnchangedHash"]
for name, digest in state["protectedEvidence"].items():
    assert hashlib.sha256((root / name).read_bytes()).hexdigest() == digest, name
other_changes = [name for name, digest in state["otherWorkingFiles"].items()
                 if not (root / name).is_file() or hashlib.sha256((root / name).read_bytes()).hexdigest() != digest]
print(json.dumps({"status": "PASS", "changedClauses": [2, 5], "characters": 1583,
                  "skillDetailsUnchanged": True, "generatorUnchanged": True,
                  "protectedEvidenceFiles": len(state["protectedEvidence"]),
                  "otherWorkingFiles": len(state["otherWorkingFiles"]),
                  "concurrentNonTargetChangesObserved": other_changes}, ensure_ascii=False))
