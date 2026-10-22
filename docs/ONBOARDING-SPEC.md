# New-user onboarding

Status: **implemented, real-UI verification pending** (2026-10-16, card "增加new user onboarding"; user approved the design and its five calls). This adds a first-run welcome tour, a better empty state and a few one-time contextual tips. It changes no business contract in SINGLE-ROOT, Phase 2 or AUTO-STATUS specs.

## Why

A new user opens Ultra Kanban and sees "No projects yet". The ideas the product rests on are never stated in the UI: a board project is a Paseo project root, a card is one workspace, sessions live inside the card, and card status is not session status. The headline features (cards that move by themselves, Needs you, run summaries, Ideas, Insights) are only discoverable by accident. The goal is that a first-time user, within a minute and without reading docs, understands (1) how Kanban objects map onto Paseo objects, (2) the basic loop, (3) what is special here, and ends the tour one tap from creating a project.

Success: a new user can say what a project, a card and a session are, who decides Done, and where to look when an agent needs them. Anti-goals: a blocking tour for existing users, a tour that is long, a tour that creates Paseo resources, tips that nag.

## Observable behavior

### 1. When the welcome tour appears

- The board screen shows it once per host (settings `onboarding`, host scope, like the other preferences) when **all** hold: settings have loaded successfully, `welcomeSeen` is false, and the board has loaded with **zero projects**.
- **Existing users are never interrupted.** If the board already has at least one project (archived ones count) when the settings first read as unseen, the client silently stores `welcomeSeen=true` and marks every tip as seen, so veterans get neither the tour nor first-time tips. They can open the tour manually (§4) or use *Show tips again*.
- Settings loading, error or invalid never show the tour (fail quiet). The tour never opens over another modal, over an open card, or while a shortcut dialog is open.
- Closing it in any way (Skip, Esc, scrim, finishing) sets `welcomeSeen=true`. It is not shown again automatically.

### 2. The tour: a modal sheet, three pages, skippable

Uses the plugin `Modal` (host-owned open/close; content has the shared rise from `client/modal.tsx`). Same component on desktop and phone: single column, max width ~480, scrolls if the viewport is short. Footer: step dots, **Skip** (text button, all pages except the last), **Back** (from page 2), **Next** / final primary button. Page changes use `MotionReveal` (short, interruptible, Reduce Motion honoured, no delay before the action). The modal title carries the Flowly mark as its icon (`FlowlyMark` in `client/brand-icons.tsx`): the small-size mark from `docs/brand/logo/` (a solid start dot and an open end ring joined by one S curve), inlined as 20, 40 and 60 px PNGs per theme (ink on light surfaces, paper on dark; about 3 KB of source together) that `docs/brand/export-logo.mjs` generates into `client/flowly-mark-data.ts`. The one matching the screen's pixel ratio is shown, so the 20 pt icon is never resampled. It is decorative: the title already reads "Welcome to Flowly". No tip announces it (a visual change, no new capability).

**Page 1: How Flowly works** — "Everything on the board is a real Paseo object, so you can always open it in Paseo." The former map and loop pages are merged (user decision 2026-10-21: three pages instead of four). Two parts, each under a small muted heading:

*Three things* — a horizontal chain of three equal bordered boxes joined by chevrons, drawn with React Native views and `Icon`s, no images. Each box: icon tile, name, one short line, the Paseo object in muted text.

| Kanban | Short line | Is a Paseo… |
| --- | --- | --- |
| **Project** | One folder | project |
| **Card** | One task | workspace |
| **Session** | A chat with an agent | agent session |

*The loop* — a lane strip `Todo › Design › Development › Test › In review › Done` (wraps when narrow): Todo and Done are tinted in the accent colour (yours), the middle lanes are neutral (the agent moves them). Below it three steps, each with a role badge:
1. **You** — Make a project from a folder, add a task and start an agent.
2. **Agent** — Moves the card through the lanes. When it needs you, the card says Needs you.
3. **You** — Review the result and move the card to Done.

The old footer "card status and session status are separate" is dropped; the strip's accent Done makes the same point with less text.

**Page 2: What makes it different** — the page stays short: four headline features as bordered tiles (icon, name, one short sentence; two per row, one per row when narrow), in the README's highlight order so promo and product agree, then every other feature folded under a collapsed **More features (n)** disclosure (small icon, name and sentence per row; collapsed each time the tour opens).
The page title has the detail line "Anything marked with the sparkle was written or suggested by AI." ([AI-MARK-SPEC](AI-MARK-SPEC.md)).

Headline tiles:
- *Automatic status*: cards follow the agent's work through the lanes. Done stays yours.
- *Needs-you reminders*: questions, approvals and errors light up the card; answer them right there.
- *Run summaries*: after every turn a cheap model keeps state / target / recap / next on the card.
- *Suggested next steps*: tap one to fill in the message box; nothing is sent until you send it.

Under More features (a new feature normally goes here; promote it to a tile only by replacing one):
- *Workpad*: agents set the card's type and tags and write a workpad before they start: acceptance criteria, checks (passed, failed or not run on a named commit) and confusions; delivering without them needs a note ([WORKPAD-SPEC](WORKPAD-SPEC.md), [CARD-SETUP-SPEC](CARD-SETUP-SPEC.md) §4). No new tip: the change is agent behavior with no new screen moment.
- *Follow-up ideas*: work an agent finds on the way lands in the Ideas inbox; Good idea or Dismiss.
- *Project memory*: decisions and pitfalls you confirm carry over to new cards' sessions; agents and the review of finished cards suggest them, and you edit or delete them any time (PROJECT-MEMORY-SPEC).
- *Inputs and outputs*: each card lists the files and links it worked from and delivered, added by agents or by you ([CARD-ARTIFACTS-SPEC](CARD-ARTIFACTS-SPEC.md)).
- *Tickets, docs and PRs as inputs*: start a card from a Jira ticket, Confluence page, or GitHub/GitLab issue or pull request; agents read it every turn and Flowly never changes it.
- *Tags*: tag cards by module or direction; agents tag their own cards too; filter and search by #tag.
- *Project insights*: today's cards, turns, agent time, commits, tokens and what is waiting on you.
- *Workflow insights*: optional; on a schedule you choose, a model reads the commands agents ran and suggests scripts, tools and rules worth keeping (WORKFLOW-INSIGHTS-SPEC).
- *Saved with your project*: each project's board is also kept in its folder (`.flowly`, ignored by git); adding the folder again restores it.

**Page 3: Ready when you are**

Title with detail "Your first three steps." (plus "Nothing is created until you confirm." when there is no project yet), then one bordered checklist of three rows (empty circle, text, small accent icon): *Pick a folder to make a project.* / *Add your first task and start an agent.* / *Reply when a card says Needs you.* The rows are static, not tracked progress. Then the reopen hint. Primary **Create project** (opens the existing project form after the tour closes) with secondary **Not now**, or **Done** when a project exists. No project, workspace, card or session is created by the tour itself (no sample data).


### 3. Better empty states (always visible, not one-time)

- **No projects**: the current empty view keeps its icon and **Create project** button, and gains a compact three-chip strip "Project → Card → Session" (same wording as page 1) plus a "Take the tour" link. Visible even after the tour was seen, so it is never a dead end.
- **Project with no cards**: columns stay, and a quiet centred hint over the empty board reads "Add your first task. It gets its own workspace and sessions." with the **New task** button. Disappears with the first card.

### 4. Re-entry

- There is no board overflow menu, so the entries are: a **Welcome tour** help icon in the board header (desktop/tablet layout), **Settings → Welcome tour → Show welcome tour** (every layout, including phones), the empty-board **Take the tour** link, and Command Center "Ultra Kanban: Welcome tour". Opening it manually ignores `welcomeSeen` and does not change it. The tour only opens in the full board screen, not in the workspace panel.
- Settings → Welcome tour also has **Show tips again**: clears `tipsSeen` only (the tour itself is reopened by hand; clearing `welcomeSeen` would make the board silently mark existing users again). Opening the tour from Settings closes Settings first and opens the tour 450 ms later. Settings is a React Native `Modal` and the tour a host `Modal`; swapping two modals in one tick is the suspected cause of a reported whole-app freeze (not reproduced; unverified).

### 5. One-time contextual tips (small, non-modal)

A tip is a single dismissible banner row (icon, one sentence, **Got it**) under the overview bar; only **Got it** records it as seen. Priority when several apply: agent-question, needs-you, attention-dismiss, first-done, older-finished, next-move, first-workpad, subagents, first-idea, first-memory-candidate, first-workflow-insight, ai-language, first-artifact, first-ticket, first-tag, first-card, card-display, connectors, session-history, sidebar-order, project-menu, jira-connect. The empty-project hint takes the same slot and wins at the top of the relevant surface, using theme colours. At most one tip is visible at a time; a tip appears at most once per host (`tipsSeen`); dismissing or acting on the feature records it. Tips never block input, never move a focused input, and are not shown while the welcome tour is open.

| Tip id | Shown when | Text |
| --- | --- | --- |
| `first-card` | the project has a card and none is open | "Your card moves by itself as the agent works. Open it any time to see its sessions, output and summary." |
| `agent-question` | the first time a session in the project waits on an agent question (SESSION-QUESTION-SPEC) | "An agent is asking you something. Open the card's session to answer it right there, no need to switch to Paseo." |
| `needs-you` | the first time any card in the project is Needs you | "A card is waiting for you. Reply goes straight to the session." |
| `attention-dismiss` | three or more cards are in Attention and none is dismissed yet (ATTENTION-DISMISS-SPEC §6) | "Not ready to decide? Dismiss a card from Attention. It comes back when something new happens." |
| `next-move` | a session of the project has suggested next steps for its current turn (NEXT-MOVES-SPEC) | "When an agent finishes a turn, its suggested next steps sit above the message box. Tap one to fill it in; nothing is sent until you press Send." |
| `first-workpad` | the project's Card workpad switch is on, a card of the project has a workpad and no card is open (WORKPAD-SPEC §8, §9) | "This card has a workpad: the agent's acceptance criteria and checks. The card shows how many checks passed; open it to see which ran on which commit, and tick items yourself." |
| `subagents` | a session of the project has a live Paseo child agent (SUBAGENTS-SPEC §7) | "When a session starts subagents, a Subagents chip appears above its message box. Click it to see their status and open one in Paseo." |
| `first-idea` | the first time Ideas has an open item | "An agent suggested follow-up work. Good idea starts a card or continues here; Dismiss removes it." |
| `first-memory-candidate` | the current project has a project-memory candidate waiting for review and no card is open (PROJECT-MEMORY-SPEC §11); read from `memory.counts` with the board | "An agent suggested something to remember. Confirm it in Memory and new sessions on this project will know it; you can edit or delete it any time." |
| `first-workflow-insight` | Workflow insights is on and the current project has an open suggestion (WORKFLOW-INSIGHTS-SPEC §8); read once per project while unseen, no polling | "Workflow insights found repeated work worth keeping. Open Insights to turn a suggestion into a card." |
| `first-artifact` | a card of the project has an artifact and no card is open | "Cards now collect artifacts: the files and links a task worked from and delivered. Agents add them as they work; you can add your own in the card." |
| `first-tag` | a card of the project has a tag an agent added and no card is open | "Agents tag their cards by module and direction. Open a card and tap a tag to filter the board by it, or search #tag." |
| `first-done` | the user first moves a card to Done/Cancelled | "Done cards can be wrapped up: archive their sessions and workspace. Auto wrap up is in settings." |
| `older-finished` | the current project has old Done/Cancelled cards folded under "Show older" (and at least one of those lanes still folds them) | "Cards that finished a while ago fold under “Show older” at the bottom of Done and Cancelled. Settings → Workflow sets how long they stay." (FINISHED-CARDS-SPEC) |
| `first-ticket` | a card of the project has an external input (Jira, Confluence, GitHub, GitLab) and no card is open (EXTERNAL-TRACKER-SPEC, CONNECTORS-SPEC) | "A card has an item from a connected service as an input. Agents read it every turn and see when it changes. Flowly never changes it there, and its status doesn't move the card." |
| `card-display` | the current project has 6 or more active cards and no card is open (CARD-DISPLAY-SPEC §5) | "Cards too busy? Choose what they show in Settings → Cards, or from the Sort menu → Card display." |
| `connectors` | a card is open, so its Artifacts + is in view (CONNECTORS-SPEC §8.5; new id, so every existing user sees it once) | "The Artifacts + now adds Confluence pages and GitHub or GitLab issues and pull requests too, besides files, links and Jira tickets. Connect services in Settings → Connections." |
| `session-history` | a card is open and it has a session (SESSION-PANE-SPEC §1) | "A session's output now starts at the beginning of its current turn. Press Load earlier at the top to read further back." |
| `ai-language` | a card of the current project has an AI progress summary (AI-LANGUAGE-SPEC §7) | "AI-written text follows Settings → AI features → AI output language. It starts as your interface language." |
| `sidebar-order` | a card is open and it has at least one artifact or idea (DRAWER-SPEC, Section order) | "Arrange an open card your way: reorder its sections and choose which start open in Settings → Cards → Card sidebar." |
| `project-menu` | desktop project tabs show two or more projects and no card is open (PROJECT-TABS-SPEC) | "Drag a project tab to reorder it. Right-click it for its settings, a new task, Insights, Ideas or Remove." |
| `jira-connect` | the project has a card, no card is open, and no connection is configured (announces the feature; lowest priority) | "Work from Jira, Confluence, GitHub or GitLab: connect them in Settings → Connections, then start a card with From… or add items with the Artifacts +. Flowly only reads them." |

Tips are the lowest-priority part of this feature and can ship after the tour (see Delivery).

## Data contract

New host-scoped setting in `shared/settings.ts`, same pattern as `ideasSettings` (read through a `…Values()` helper that tolerates missing fields):

```
id: "onboarding", scope: "host", version: 1
schema: { welcomeSeen: boolean = false, tipsSeen: string[] (max 100, ids ≤ 40 chars; was 20 until 2026-10-21, when 20 tips made each new tip evict the oldest) = [] }
```

The daemon only registers the setting (`server.registerSettings(onboardingSettings)`). No board schema, RPC, tool or skill change; no migration; agent-facing text is untouched. Settings are per host, so a user on a second device sees the tour once there too; this is accepted.

Pure logic lives in `client/onboarding-logic.ts` (not `onboarding.ts`: it would shadow `onboarding.tsx` in module resolution) so it can be unit-tested without rendering: `shouldShowWelcome({ settingsStatus, welcomeSeen, boardLoaded, projectCount, blocked })`, `shouldAutoMarkSeen(…)` (existing users), `nextTip({ tipsSeen, facts })`, and page-index stepping. UI and the `useOnboarding` hook (optimistic overlay, revision-conflict merge and retry, like `board-view.ts`) in `client/onboarding.tsx`. The board only mounts the tour component and passes facts; it does not own onboarding state.

## Constraints from AGENTS.md

- React Native primitives, theme colours, `Icon`; no HTML/DOM/CSS strings. Plugin-owned open/close and page changes use the shared motion primitives; honour Reduce Motion; no listeners left after close.
- All strings via `t()`/`tn()` and added to every catalog in `shared/i18n/` (`shared/i18n.test.ts` enforces completeness; 9 non-English catalogs).
- Performance: the tour mounts only when due (no hidden subtree on phones); tips read facts the board already has (project count, attention items, ideas list) and add no polling or query.
- The tour must not use a bare controlled `TextInput` (it has none).
- Statuses/lanes in copy use the user's lane names where available, otherwise the defaults.

## Not in scope

Interactive coach-mark overlays that point at live UI (fragile across desktop/phone layouts), sample/demo projects (would create Paseo resources), video, per-user server-side onboarding state, onboarding for Paseo itself, changing agent prompts or the skill.

## Delivery and acceptance

Implemented: settings + logic + tests, tour modal and all entry points, empty states, tips, and 47 new strings in all 9 catalogs.

Run and passing: `npm run typecheck`, `npm test` (63 files / 395 tests, including `client/onboarding-logic.test.ts` and i18n completeness).

Covered by unit tests: the pure logic (fresh user shows; existing user silently marked; settings loading/error never shows; manual open leaves `welcomeSeen`; one tip at a time; tips once only), i18n completeness. Real-UI verification (desktop and compact, light and dark, Reduce Motion, tour on first run, empty states, re-entry, tips) in an explicitly full-access `codex/gpt-6-luna` session against the non-fullscreen Paseo window with a fresh settings state; record evidence in `docs/verification/onboarding.md`. Anything not exercised on a real window is recorded UNRUN. **Status: UNRUN.** The plugin has not been reloaded and no Luna session or window was used.

## Calls I made that you can overrule

1. Existing users are not shown the tour (silent mark), because an unexpected modal on a working board is worse than a missed intro.
2. Four pages, modal sheet, no spotlight overlays.
3. No sample project is created.
4. Tips are a separate, optional stage and can be dropped without affecting the tour.
5. Onboarding state is per host (setting), not per account.
