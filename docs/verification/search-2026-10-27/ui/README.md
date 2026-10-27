# Search UI check, 2026-10-27

Implementer's UI check (SEARCH-SPEC §11), on main 06b72ed plus the Esc fix in this commit, with the installed plugin reloaded from the main checkout. Fixture: Tinylink (read only; nothing created). Browser: headless Google Chrome through `docs/promo/shot-lib.mjs` (`launch`, `shot`, `pageText`, `hidePrivate`); `run.mjs` adds closing the What's new dialog: the first run showed the new 1.8.0 entry and dismissed it, so later runs (these files) did not see it.

| Check | Result |
|---|---|
| Header search button (`Search (S)`) opens the page, box focused | pass |
| Typing `n` in the box does not open New task | pass |
| `rate limit` finds the rate limiting card, with card and summary hits highlighted | pass (`desktop-2-results.png`) |
| All projects, Notes-only filter | pass (`desktop-3`, `desktop-4`) |
| Unknown words show No results | pass |
| A result opens its card; the Search page stays open | pass (`desktop-5-open-card.png`) |
| Board button returns to the board | pass |
| `S` opens the page; Esc while typing closes it | pass (Esc failed before this commit: shortcuts are blocked while the box is focused) |
| Compact (430 px): header search button, results | pass (`compact-1-results.png`). The log's `compact results contain expired card: false` is a check artifact: `pageText` drops text left of x=320, the desktop sidebar edge, and the compact layout has no sidebar. |
| Page errors | none |

Not checked: the Command Center entry (host UI), native phone apps.
