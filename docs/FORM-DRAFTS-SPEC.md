# New task / New session drafts

Status: implemented (branch `fix/form-drafts`).

## 1. Problem

Closing **New task** or a card's **New session** lost what was typed: New task
unmounts on close, and New session reset its fields every time it opened. The
existing composer drafts (`server/composer.ts`) only cover messages to a session
that already exists, not the forms that create one.

## 2. Behavior

- Close, Cancel, Esc, backdrop and Back keep the draft. Reopening the same form
  restores its text, the user's choices and the images already read in.
- Restoring only fills the form. It never creates a card, workspace or session and
  never sends a message.
- Edit task has no draft: it edits a saved card.

### 2.1 What is kept

| Form | Kept |
| --- | --- |
| New task | title, description, status, priority, type, tags, workspace mode, existing workspace, base ref, branch, *Start an agent now*, provider, model, mode, reasoning, instruction, picked external items, description images, the form's `operationId` |
| New session | title, instruction, provider, model, mode, reasoning, first-message images |

An agent choice that is no longer available falls back the same way as a stale
default (`useAgentChoice`). Restored images keep the form's image limits
(`maxImages` for New session, `cardImageLimit` for New task).

### 2.2 Isolation

A draft key is `<kind>:<scopeId>:<source>`:

- `task:<projectId>:plain` — New task from the board (any lane);
  `task:<projectId>:idea:<ideaId>`, `task:<projectId>:insight:<findingId>`,
  `task:<projectId>:follow:<taskId>` — New task prefilled from an idea, a workflow
  insight or as a follow-up.
- `session:<taskId>:plain` — New session in a card;
  `session:<taskId>:idea:<ideaId>` — New session started from an idea.

A prefilled form starts from its seed when it has no draft; a plain form never
shows a prefilled form's draft and the reverse.

## 3. Saving

- The client saves 400 ms after the last change, never in the keystroke path
  (text inputs keep owning their text; see AGENTS.md *Text input*).
- Opening the form again (or Retry of a failed load) first lets a pending or
  running save finish, then reads; a load that a newer one or a close replaced
  applies nothing. If that save fails, nothing is read over it: the form shows the
  unsaved edit again with the save error, Retry and Close without saving.
- Closing flushes a pending save first. If that save fails, the form stays open
  with the error and two exits: **Retry** and **Close without saving**. *Close
  without saving* drops only the changes since the last successful save; the saved
  draft stays.
- If the draft cannot be loaded when the form opens, the form shows the error with
  **Retry** and does not save, so a failed load never overwrites a draft with an
  empty form. Creating still works, and a successful create does not clear the
  unread draft; the clear-failure toast says the draft was kept. New task keeps its `operationId` in client memory for that draft
  key instead, so a retry after reopening (same client) still reuses it.
- **Retry** after a failed load keeps what was typed meanwhile. Fields the user
  changed after the failed load are combined with the loaded draft: changed
  choices win, title/description/instruction written on both sides are kept as
  both (saved text first), the saved `operationId` is kept, images are joined.
  Joined images stay within the form's image limit: the images added after the
  failed load are kept, saved images that no longer fit are left out and the form
  says how many. A Retry that fails again keeps those edits (the form shows them)
  for the next Retry; they are dropped only by a successful load or *Close without
  saving*, and never merged into another draft key (another project or card).
  While a create is running, Retry of a failed load is disabled.
- A text value longer than 20000 characters is saved as empty; the open form keeps
  it and creating uses it, but it is not kept across a close.
- A force-quit may lose up to the last ~400 ms of typing.

## 4. Daemon storage and RPC

`form-drafts.json` plus `form-draft-images/` in the plugin data directory
(`server/form-drafts.ts`). Writes are serialized and atomically replaced; an
invalid file is preserved and reported, never reset. Image files are written
before the JSON that references them and removed after it no longer does.

- `form-drafts.read({ key })` → `{ revision, draft: { revision, fields, images[{ id, name, mimeType, data }] } | null }`.
  `revision` is what the next save must name: the draft's, else the revision
  recorded when that key was cleared (revisions never repeat), else 0. A conflict
  Retry overwrites on top of this `revision`, also when no draft is left.
  A draft whose project or card is gone or archived reads as `null` and is removed
  (also at plugin start); like a clear, it leaves its revision marker, so after the
  project or card is restored a window still holding that draft gets a conflict.
- `form-drafts.save({ key, baseRevision, fields, images[{ id, name, mimeType, data? }] })` →
  `{ revision }`. `baseRevision` is the revision the client last read or saved (0
  for none). A different current revision is refused with `This draft was changed
  in another window.`: an older writer never overwrites a newer draft. An image is
  sent with `data` once; later saves reference it by `id`. The project (task draft)
  or card (session draft) must exist and not be archived.
- `form-drafts.clear({ key, revision? })` → `{ ok }`. Removes the draft and its
  images and records one past its revision, so a window still holding the cleared
  revision cannot save it back. With `revision`, a draft that has since been
  saved again (another window) is kept and `ok` is false.

Field values are strings, booleans or string lists (bounded); the client validates
what it restores and ignores what it does not understand.

## 5. Creating

- **New task**: the draft is cleared as soon as the card exists, before the first
  agent starts, so an agent that fails to start never leads to a second card.
  The draft stores the form's `operationId` and is saved before the first create
  request (a save that fails stops the create and shows the draft error), so a
  retry after reopening reuses the server's idempotent create instead of making a
  duplicate. A failed create keeps the draft.
- A close that is still saving blocks Create, and a create in progress keeps the
  form open until it finishes. A session prepared for one draft (card and idea) is
  never recovered for another.
- **New session**: the draft is cleared after the session is created; a failed
  create keeps it.
- The clear waits for a save already on its way and names the revision it
  produced. If another window saved a newer draft meanwhile, that draft is kept
  and the toast says so.
- A failed clear is shown as a toast; the created resource is not affected.

## 6. Acceptance

1. Typing in New task / New session, closing (Cancel, Esc, backdrop) and reopening
   restores text, choices and images; the same after a client reload.
2. Plain and prefilled forms, different projects and different cards do not share
   drafts.
3. A stale `baseRevision` is refused; invalid data is preserved.
4. A failed load does not save; a failed save keeps the form open with Retry and
   Close without saving.
5. Successful create clears the draft; failed create keeps it; a card created
   while its agent fails to start is not created again.
