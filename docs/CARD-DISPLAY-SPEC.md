# Card display: calmer layout and user-chosen fields

Status: implemented 2026-10-19. Card: 任务卡片布局调整.

## 1. Problem

A board card grew one row or pill per feature: ticket key line, title, progress line, latest-output line, and a wrapping row of priority pill, type pill, tag chips, Needs you, waiting, workpad checks, workspace state, approvals, errors, running, unread, ideas, archived and legacy. In a 260 px column a busy card ran to 7–8 lines, and the things that need the user were mixed in with descriptive metadata.

## 2. Layout

Four tiers, top to bottom. Every tier is omitted when empty.

| Tier | Content | Style |
| --- | --- | --- |
| Meta | priority (Urgent/High/Low only), type, ticket key, tags (first two, then `+n`) | one wrapping row of small muted text with icons, no pills or chips; Urgent/High keep their colour |
| Title | task title, up to 3 lines | unchanged |
| Activity | one line of what the agent did, with its relative time | AI mark when it is the progress summary |
| Status | what needs the user and what is happening | signals as before |

- Urgent/High keep the left stripe; it follows the Priority field.
- Status order: Needs you, waiting on cards, approvals, errors, workspace problems, running, unread, workpad checks, ideas, Archived, Legacy.
- The accessibility label of the card is unchanged and always lists every fact, whatever is hidden.

### 2.1 Tapping the session signal

Added 2026-11-05 (issue #74).

- The session signals (running/starting, unread, the session count) form one target. Tapping it opens the card's latest session — the same one the activity line reads (`pickOutputSession`: the card's own sessions first, newest activity wins; archived sessions never) — through the drawer's session entry, as the Attention list does.
- Tapping anywhere else on the card still opens Details. A card with no live session, a stale or unavailable summary, the settings preview and the tour demos keep the signal display-only.
- A mouse drag that starts on the signal still drags the card; the tap after a drag is suppressed as for the card body.
- The target is a button labelled *Open latest session*; the card's own label and hint are unchanged.

## 3. Options (Settings → Cards)

Host-scoped (`board-view` settings), so every board on this device uses them.

| Option | Values | Default |
| --- | --- | --- |
| Activity line (`cardActivity`) | `auto`: progress summary, else latest output · `progress` · `output` · `both` · `none` | `auto` |
| Priority, Type, Ticket, Tags, Session activity, Workpad checks, Ideas | shown / hidden (`cardHidden`: list of hidden field ids) | all shown |

- Session activity covers running, starting, unread, session count, Loading… and Last known. Approvals and errors are always shown.
- Always shown, not configurable: Needs you, waiting on cards, approvals, errors, Workspace unavailable, Wrapped up, Archived, Legacy. They tell the user to act or explain why the card behaves differently.
- `both` restores the earlier two-line behaviour (progress line, then output line).
- The page shows a live preview card built from sample data with the current options, and a *Reset to defaults* row.
- The board's Sort menu ends with *Card display…*, which opens Settings on the Cards page.
- The same page has a **Card sidebar** group for the open card's section order and which sections start open (DRAWER-SPEC, Section order).

## 4. Data contract

- `cardActivity: "auto" | "progress" | "output" | "both" | "none"`, default `auto`.
- `cardHidden: string[]` (≤ 20, each ≤ 40 chars), default `[]`. Unknown ids are kept and ignored, so a newer client's value never invalidates the whole board-view document on an older one.
- Pure helpers in `shared/card-display.ts`: `cardDisplay(view)` → per-field visibility; `activityLines(mode, hasProgress, hasOutput)` → which lines show.

## 5. Onboarding

New one-time tip `card-display`, shown when the current project has 6 or more active cards: “Cards too busy? Choose what they show in Settings → Cards, or from the Sort menu → Card display.” Welcome tour copy is unchanged: this is a view preference, not a new concept.

## 6. Acceptance

1. Default card: meta row, title, at most one activity line, status row; no priority/type pills or tag chips.
2. Each switch hides its field on the board and in the preview immediately; settings persist across reload.
3. Activity modes behave as in §3; `auto` shows output only when there is no progress summary.
4. Always-shown signals stay when every switch is off.
5. Invalid stored values fall back to defaults; older stored documents get the defaults.
6. All new strings in every catalog; `npm test` passes.
