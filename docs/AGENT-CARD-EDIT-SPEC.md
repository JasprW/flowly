# Agent card edits (AGENT-CARD-EDIT-SPEC)

A session can change other cards of its own project when the user asks it to, for example a triage card that
retitles, re-prioritizes, tags or closes the cards it has reviewed. Until now an agent could only write its own
card, so such a card ended in a list of paste-ready edits that the user applied by hand.

## 1. Tool `flowly_edit_card`

MCP tool `flowly_edit_card`; HTTP `/api` action `edit_card` with the same input. There is no CLI command yet.

Input:

- `expectedRevision`, `request`: copied from `flowly_get_task`, validated like every agent write (session, card,
  workspace, signature, issue time, both revisions).
- `cardId`: the target card's full id.
- `cardRevision`: the target's current revision.
- Optional `title`, `description` (replaces the whole text), `priority`, `type`, `status` (any lane of the project,
  Done and Cancelled included).
- `addTags`, `removeTags` (default `[]`).
- `note` (required, non-empty): why the card changes.

At least one field or tag change is required.

## 2. Behavior

- The project is the session card's project, never an input. A target in another project returns `NOT_FOUND`.
- The session's own card is refused with `INVALID_INPUT`; it keeps its own tools (`flowly_update_status`,
  `flowly_set_tags`, `flowly_set_type`).
- An archived target or project is refused with `INVALID_INPUT`.
- A target whose revision differs from `cardRevision` returns `REVISION_CONFLICT`, so a human edit made in between
  is never overwritten.
- Field changes go through the same store edit as the card form (`BoardStore.editTask`), with `actor: "agent"`, the
  session's `agentId` and the note. The target's revision goes up by one; the session card's revision does not change.
- Tags use `changeTags` with `actor: "agent"`: tags a human added cannot be removed (`INVALID_INPUT`), and the
  per-card tag limit applies. A refused tag change is checked before any write, so the card stays untouched.
- A status change runs the same after-status work as a move on the board (restore on reopen, Done review, guardrail
  finish, wrap-up).
- The result is `{card: {id, title, status, priority, type, tags, revision}}`. The call writes no receipt: a retry
  after an uncertain result re-reads the target revision first.

## 3. Open question

Agents do not move their own card to Done or Cancelled; those are the user's decisions. This tool lets a session move
other cards there when the user asked for it. If that should stay a user-only move, the tool can refuse `done` and
`cancelled`, or the tool can sit behind a project switch that is off by default.

## 4. Acceptance

1. A session edits title, priority, status and tags of another card of its project. The events are recorded as the
   agent's with the note, the after-status hook runs once, and the session card's revision is unchanged.
2. The own card, a card of another project, an archived card, a stale `cardRevision`, removing a human's tag, an
   empty change and another session's request are refused, and the board stays byte-identical.
3. The MCP tool list includes `flowly_edit_card`; the `/api` action `edit_card` reaches the same method.
