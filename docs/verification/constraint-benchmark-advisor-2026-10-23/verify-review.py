"""Read-only checks for review provenance, scope and evidence preservation."""
import hashlib
import json
import re
from pathlib import Path

folder = Path(__file__).resolve().parent
root = folder.parents[2]
ownership = json.loads((folder / "ownership.json").read_text())
assert hashlib.sha256((folder / "overall-proposal.md").read_bytes()).hexdigest() == ownership["proposalHash"]
for name, digest in ownership["protectedHashes"].items():
    assert hashlib.sha256((root / name).read_bytes()).hexdigest() == digest, name

session = json.loads((folder / "review-session.json").read_text())
assert session["agentId"] == "87a4305a-07ba-4050-87cc-9e41355472c0"
assert session["status"] == "COMPLETE_ARCHIVED"
assert session["runtimeIdentity"]["model"] == session["cleanup"]["model"] == "claude-fable-5-1"
assert session["creationResult"]["currentModeId"] == session["cleanup"]["modeId"] == "bypassPermissions"
assert session["cleanup"]["agentId"] == session["agentId"] and session["cleanup"]["archived"]
assert session["cleanup"]["workspaceId"] == ownership["workspaceId"]
assert session["cleanup"]["benchmarkResourcesCreated"] == 0
for field in ["firstReview", "finalReview"]:
    item = session[field]
    assert hashlib.sha256((folder / item["file"]).read_bytes()).hexdigest() == item["hash"]

proposal = json.loads((folder / "proposed-checklist.json").read_text())
assert proposal["status"] == "PROPOSAL_ONLY_NOT_INSTALLED"
current = re.findall(r'^  "(.*)",$', (root / "shared/turn-checklist.ts").read_text(), re.M)
rules = proposal["rules"]
assert len(current) == len(rules) == 6
assert [i + 1 for i, (before, after) in enumerate(zip(current, rules)) if before != after] == [2, 5]
assert len("\n".join(rules)) == proposal["charactersJoinedWithNewlines"] == 1583
assert re.findall(r'^> (.*)$', (folder / "review-summary.md").read_text(), re.M) == [rules[1], rules[4]]
assert len("\n".join(rules)) <= 1800
print(json.dumps({"status": "PASS", "protectedFiles": len(ownership["protectedHashes"]),
                  "advisorModel": session["cleanup"]["model"], "advisorArchived": True,
                  "proposedClauses": 6, "charactersWithNewlines": 1583,
                  "productChanged": False, "benchmarkRerun": False}))
