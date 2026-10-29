# Verification: Shortcut connector (CONNECTORS-SPEC §14)

Date: 2026-10-29

## Commands

| Command | Exit | Result |
|---|---|---|
| `npm run typecheck` | 0 | no errors |
| `npm test` | 0 | see note |
| `npm run test:ci` | 0 | 4 passed |
| `npx vitest run server/connectors/ shared/` | 0 | 456 passed |
| live run, env vars supplied | 0 | 6 passed |

Note on `npm test`: the full suite shows 4–6 failures under parallel load on this
machine (`ideas`, `memory`, `sqlite-store`, `tool-server`). The same four fail on
`origin/main`, and all of them pass when run in isolation. Load-dependent timeouts,
not a regression from this work.

## Live workspace

Run against a real Shortcut workspace with `SHORTCUT_API_TOKEN`, `SHORTCUT_WORKSPACE`,
`SHORTCUT_STORY` and `SHORTCUT_EPIC` supplied from the environment. Output is not
reproduced here: it contains the workspace's own story and epic titles.

Confirmed:

- the token verifies and the account renders as `name (@mention_name)`
- the picker returns the signed-in user's open stories, each keyed `sc-<id>`
- a story reads with status, type, owners, labels, epic and branches, resolved through
  the `/workflows` and `/members` lookups
- an epic reads and lists its stories with their states
- a pasted story link resolves to the same item as its `sc-<id>` key

## Not done

Settings → Connections and the **From Shortcut** picker were not exercised by an
automated UI check.
