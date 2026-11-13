# Card images — live check on Tinylink (2026-11-13)

Commit under test: branch `feat/card-images` (PR #104, `cdc5760`), installed with the main tree's uncommitted work (another session's Paseo 0.16 changes), combined in a temporary worktree. Script: `verify.mjs` (setup / web / check / agents / cleanup). Fixture: temporary card `d2a3c4cf-25b7-40aa-a3ed-5ba2f9b51c3a` (workspace `wks_aea9cc8c5e360aab`) in Tinylink, deleted with its sessions and workspace afterwards.

| Check | Result |
| --- | --- |
| Web, Edit task: paste, drop, file chooser each add one image (3 thumbnails, `02`) | pass |
| Save uploads 3 images with WebP thumbnails; revision 1 → 5 (update + 3 adds) | pass |
| Sidebar thumbnail row under the description (`03`) | pass |
| Viewer: full image, Next → "2 / 3" (`04`, `05`) | pass |
| Remove in the viewer: 2 images remain, both files of the removed image deleted, the rest 0600 (`06`, `check-log.txt`) | pass |
| `tasks.context` has the "Card images …" line with absolute paths that exist (`check-log.txt`) | pass |
| Web page errors | none |
| Claude Haiku session `b4c3866a-85fb-4959-8eb2-ba4f2d4a8656` read both paths and replied "ALPHA 4821 / CHARLIE 1946" | pass |
| Codex session `f87b75ff-f8aa-487f-a811-dd1a578e657c` (`codex-aicodewith/gpt-5.5`) | **unrun**: the provider failed before the turn ("This chat uses paseo:codex-aicodewith, but your current provider is custom"); plain `codex` is not installed on this host |
| Phone (view thumbnails and viewer, no Add images) | **unrun**: no device on adb (USB or mDNS) and AndroMeld not running |

Raw logs: `web-log.txt`, `check-log.txt`.
| Delete (archive) moved the card's image folder to `removed/task-<id>-images-<time>/`; `card-images/` empty afterwards | pass |
