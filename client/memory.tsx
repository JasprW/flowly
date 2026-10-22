import { memo, useMemo, useState, type ReactNode } from "react";
import { Pressable, View } from "react-native";
import { useRpc } from "@getpaseo/plugin/client";
import { copyText, Icon, ScrollView, useToast } from "@getpaseo/plugin/client/react-native";
import { useQueryClient } from "@tanstack/react-query";
import * as rpc from "../shared/rpc";
import type { Project, Status, Task } from "../shared/model";
import {
  agentsRule,
  isStale,
  isWidelyUsed,
  leastUsed,
  memoryKinds,
  memoryLimits,
  recentCards,
  type MemoryEntry,
  type MemoryKind,
  type MemoryView,
} from "../shared/memory";
import { ContentCard, CardBody, CardHeadline, CardMeta, CardMetaRow, CardText } from "./content-card";
import { eventPoint, useMenuOpener } from "./context-menu";
import { Section } from "./disclosure";
import { Modal } from "./modal";
import { Enter } from "./motion";
import { memoryCountsKey, memoryKey, useMemoryQuery } from "./queries";
import { StatusIcon } from "./status";
import { Actions, AiMark, Button, Choices, Field, IconButton, Label, Notice, TextBox, Theme, Toggle, font, message, noFocusRing, radius, space, tint, touch, useTheme, verticalContent, verticalScroll } from "./ui";
import { t, msg, tn } from "../shared/i18n";

/** Project memory UI (PROJECT-MEMORY-SPEC §8): the Memory page, the drawer section and their shared cards. */

export const kindLabels: Record<MemoryKind, string> = { decision: msg("Decision"), convention: msg("Convention"), pitfall: msg("Pitfall"), contact: msg("Contact") };
const kindPlural: Record<MemoryKind, string> = { decision: msg("Decisions"), convention: msg("Conventions"), pitfall: msg("Pitfalls"), contact: msg("Contacts") };
export const kindIcons: Record<MemoryKind, string> = { decision: "Gavel", convention: "ListChecks", pitfall: "TriangleAlert", contact: "Contact" };

type Draft = { kind: MemoryKind; title: string; body: string; tags: string; keywords: string; pinned: boolean };
const list = (value: string) => [...new Set(value.split(",").map((s) => s.trim()).filter(Boolean))];
const draftOf = (e?: MemoryEntry): Draft => ({
  kind: e?.kind ?? "decision",
  title: e?.title ?? "",
  body: e?.body ?? "",
  tags: (e?.tags ?? []).join(", "),
  keywords: (e?.keywords ?? []).join(", "),
  pinned: e?.pinned ?? false,
});
const editsOf = (d: Draft) => ({ kind: d.kind, title: d.title.trim(), body: d.body.trim(), tags: list(d.tags).map((s) => s.toLowerCase()).slice(0, memoryLimits.tags), keywords: list(d.keywords).slice(0, memoryLimits.keywords) });

/** Every memory write, refreshing the project's memory and the overview counts afterwards; failures toast. */
export function useMemoryActions(projectId: string, view: MemoryView | undefined) {
  const client = useQueryClient();
  const toast = useToast();
  const confirmRpc = useRpc(rpc.confirmMemory),
    updateRpc = useRpc(rpc.updateMemory),
    createRpc = useRpc(rpc.createMemory),
    dismissRpc = useRpc(rpc.dismissMemory),
    restoreRpc = useRpc(rpc.restoreMemory),
    archiveRpc = useRpc(rpc.archiveMemory),
    archiveManyRpc = useRpc(rpc.archiveStaleMemory),
    deleteRpc = useRpc(rpc.deleteMemory),
    retroRpc = useRpc(rpc.reviewForMemory);
  const [busy, setBusy] = useState("");
  /** Make room (§6.5): the action waiting for an archived entry. */
  const [room, setRoom] = useState<null | (() => Promise<boolean>)>(null);
  const refresh = () => {
    void client.invalidateQueries({ queryKey: memoryKey(projectId) });
    void client.invalidateQueries({ queryKey: memoryCountsKey });
  };
  const run = async (id: string, work: () => Promise<unknown>, done?: string) => {
    setBusy(id);
    try {
      await work();
      if (done) toast.show(done, { variant: "success" });
      return true;
    } catch (e) {
      toast.show(message(e), { variant: "error" });
      return false;
    } finally {
      setBusy("");
      refresh();
    }
  };
  const active = (view?.entries ?? []).filter((e) => e.status === "active").length;
  /** Runs `work` now, or after the user archived one entry when the project is full (then resolves false). */
  const withRoom = async (work: () => Promise<boolean>): Promise<boolean> => {
    if (active < memoryLimits.activePerProject) return work();
    setRoom(() => work);
    return false;
  };
  return {
    busy,
    room,
    closeRoom: () => setRoom(null),
    refresh,
    confirm: (e: MemoryEntry, draft?: Draft) =>
      withRoom(() => run(e.id, () => confirmRpc({ id: e.id, revision: e.revision, ...(draft ? { edits: editsOf(draft) } : {}) }), t("Remembered. New sessions on this project will see it."))),
    save: (e: MemoryEntry, draft: Draft) => run(e.id, () => updateRpc({ id: e.id, revision: e.revision, ...editsOf(draft), pinned: draft.pinned })),
    create: (draft: Draft) => withRoom(() => run("new", () => createRpc({ projectId, ...editsOf(draft), pinned: draft.pinned }), t("Remembered. New sessions on this project will see it."))),
    pin: (e: MemoryEntry, pinned: boolean) => run(e.id, () => updateRpc({ id: e.id, revision: e.revision, pinned })),
    dismiss: (e: MemoryEntry) => run(e.id, () => dismissRpc({ id: e.id, revision: e.revision })),
    restore: (e: MemoryEntry) => (e.status === "archived" ? withRoom(() => run(e.id, () => restoreRpc({ id: e.id, revision: e.revision }))) : run(e.id, () => restoreRpc({ id: e.id, revision: e.revision }))),
    archive: (e: MemoryEntry, reason: "retired" | "promoted" = "retired") => run(e.id, () => archiveRpc({ id: e.id, revision: e.revision, reason })),
    archiveStale: (entries: readonly MemoryEntry[]) =>
      run("stale", () => archiveManyRpc({ projectId, ids: entries.map((e) => ({ id: e.id, revision: e.revision })) }), tn(entries.length, "Archived {n} memory.", "Archived {n} memories.")),
    remove: (e: MemoryEntry) => run(e.id, () => deleteRpc({ id: e.id, revision: e.revision }), t("Memory deleted.")),
    copyRule: async (e: MemoryEntry) => {
      try {
        await copyText(agentsRule(e));
        toast.show(t("Copied. Paste it into the repository's AGENTS.md, then choose Done, stop injecting."), { variant: "success" });
      } catch (err) {
        toast.show(message(err), { variant: "error" });
      }
    },
    review: (taskId: string) => run(taskId, () => retroRpc({ taskId })),
    /** After Make room archived one: the waiting action runs. */
    madeRoom: async (e: MemoryEntry) => {
      const next = room;
      setRoom(null);
      if (await run(e.id, () => archiveRpc({ id: e.id, revision: e.revision, reason: "retired" })) && next) await next();
    },
  };
}
export type MemoryActions = ReturnType<typeof useMemoryActions>;

/** One memory as a content card: candidates get Dismiss / Edit / Confirm, confirmed ones Edit and a menu. */
export const MemoryCard = memo(function MemoryCard({
  entry,
  entries,
  actions,
  disabled,
  source,
  now,
}: {
  entry: MemoryEntry;
  /** The project's entries, for "Replaces" (§8.1). */
  entries: readonly MemoryEntry[];
  actions: MemoryActions;
  disabled: boolean;
  source?: ReactNode;
  now: number;
}) {
  const { colors } = useTheme();
  const openMenu = useMenuOpener();
  const [editing, setEditing] = useState(false);
  const [promoting, setPromoting] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const busy = actions.busy === entry.id;
  const replaced = entry.supersedes ? entries.find((e) => e.id === entry.supersedes) : undefined;
  const candidate = entry.status === "candidate";
  if (editing)
    return (
      <MemoryEditor
        initial={draftOf(entry)}
        title={candidate ? t("Edit before confirming") : t("Edit memory")}
        submit={candidate ? t("Save and confirm") : t("Save")}
        allowPin={!candidate}
        onCancel={() => setEditing(false)}
        onSubmit={async (draft) => {
          if (await (candidate ? actions.confirm(entry, draft) : actions.save(entry, draft))) setEditing(false);
        }}
      />
    );
  const widely = isWidelyUsed(entry, now);
  const stale = isStale(entry, now);
  const cards = recentCards(entry, now);
  const used = entry.usedAt
    ? tn(cards, "Used {when} · {n} card", "Used {when} · {n} cards", { when: relative(entry.usedAt, now) })
    : entry.status === "active"
      ? t("Not used yet")
      : "";
  const menu = (): Parameters<NonNullable<typeof openMenu>>[2] => [
    { id: "edit", label: t("Edit"), icon: "Pencil", onPress: () => setEditing(true) },
    entry.pinned
      ? { id: "unpin", label: t("Unpin"), icon: "PinOff", onPress: () => void actions.pin(entry, false) }
      : { id: "pin", label: t("Pin: every new session sees it"), icon: "Pin", onPress: () => void actions.pin(entry, true) },
    { id: "agents", label: t("Copy as AGENTS.md rule"), icon: "Copy", onPress: () => setPromoting(true) },
    { kind: "separator", id: "s" },
    { id: "archive", label: t("Archive"), icon: "Archive", onPress: () => void actions.archive(entry) },
    { id: "delete", label: t("Delete…"), icon: "Trash2", danger: true, onPress: () => setDeleting(true) },
  ];
  const footer = candidate ? (
    <View style={{ flexDirection: "row", gap: space[2] }}>
      <Button quiet disabled={disabled || busy} label={t("Dismiss {title}", { title: entry.title })} onPress={() => void actions.dismiss(entry)}>
        {t("Dismiss")}</Button>
      <Button quiet icon="Pencil" disabled={disabled || busy} onPress={() => setEditing(true)}>
        {t("Edit")}</Button>
      <Button primary icon="Check" disabled={disabled || busy} label={t("Confirm {title}: new sessions on this project will see it", { title: entry.title })} onPress={() => void actions.confirm(entry)}>
        {t("Confirm")}</Button>
    </View>
  ) : entry.status === "active" ? (
    <View style={{ flexDirection: "row", gap: space[2] }}>
      {widely && !entry.pinned && (
        <Button small quiet icon="Pin" disabled={disabled || busy} onPress={() => void actions.pin(entry, true)}>
          {t("Pin")}</Button>
      )}
      {openMenu ? (
        <IconButton icon="Ellipsis" disabled={disabled || busy} label={t("Memory actions for {title}", { title: entry.title })} onPress={(event) => openMenu(eventPoint(event), entry.title, menu())} />
      ) : (
        <>
          <Button small quiet icon="Pencil" disabled={disabled || busy} onPress={() => setEditing(true)}>{t("Edit")}</Button>
          <Button small quiet icon="Archive" disabled={disabled || busy} onPress={() => void actions.archive(entry)}>{t("Archive")}</Button>
          <Button small quiet danger icon="Trash2" disabled={disabled || busy} onPress={() => setDeleting(true)}>{t("Delete…")}</Button>
        </>
      )}
    </View>
  ) : (
    <View style={{ flexDirection: "row", gap: space[2] }}>
      <Button small quiet icon="ArchiveRestore" disabled={disabled || busy} onPress={() => void actions.restore(entry)}>
        {t("Restore")}</Button>
      <Button small quiet danger icon="Trash2" disabled={disabled || busy} onPress={() => setDeleting(true)}>
        {t("Delete…")}</Button>
    </View>
  );
  return (
    <>
      <ContentCard footer={footer} after={source}>
        <CardBody>
          <CardMetaRow>
            <CardMeta icon={<Icon name={kindIcons[entry.kind]} size={12} color={colors.foregroundMuted} />} text={t(kindLabels[entry.kind])} />
            {entry.pinned && <CardMeta icon={<Icon name="Pin" size={12} color={colors.accent} />} text={t("Pinned")} />}
            {candidate && <CardMeta text={entry.source.by === "retro" ? t("Suggested by the finished-card review") : t("Suggested by an agent")} />}
            {entry.status === "archived" && <CardMeta text={entry.archivedReason === "promoted" ? t("Moved to AGENTS.md") : entry.archivedReason === "superseded" ? t("Replaced") : t("Archived")} />}
            {entry.status === "dismissed" && <CardMeta text={t("Dismissed")} />}
            {stale && <CardMeta icon={<Icon name="Clock" size={12} color={colors.statusWarning} />} text={t("Stale")} />}
            {widely && <CardMeta icon={<Icon name="Flame" size={12} color={colors.accent} />} text={tn(cards, "Used by {n} card", "Used by {n} cards")} />}
            {!!used && !widely && <CardMeta text={used} />}
          </CardMetaRow>
          <CardHeadline>{entry.title}</CardHeadline>
          {!!entry.body && <CardText>{entry.body}</CardText>}
          {!!entry.tags.length && <Label muted size={font.xs}>{entry.tags.map((tag) => `#${tag}`).join("  ")}</Label>}
          {replaced && (
            <View style={{ gap: space[1], paddingLeft: space[2], borderLeftWidth: 2, borderColor: colors.border }}>
              <Label muted size={font.xs}>{t("Replaces: {title}", { title: replaced.title })}</Label>
              {!!replaced.body && <Label muted size={font.sm}>{replaced.body}</Label>}
            </View>
          )}
          {!!entry.evidence && (
            <View style={{ paddingLeft: space[2], borderLeftWidth: 2, borderColor: tint(colors.accent, 0.4) }}>
              <Label muted italic size={font.sm}>“{entry.evidence}”</Label>
            </View>
          )}
          {entry.pinned && entry.status === "active" && (
            <Label muted size={font.xs}>{t("Pinned memories reach every new session, like AGENTS.md. If this is a rule for the code, move it there.")}</Label>
          )}
        </CardBody>
      </ContentCard>
      {promoting && <PromoteDialog entry={entry} actions={actions} onClose={() => setPromoting(false)} />}
      {deleting && (
        <ConfirmDialog
          title={t("Delete this memory?")}
          text={t("New sessions will no longer see it. A copy is kept in the plugin's data folder.")}
          action={t("Delete")}
          onClose={() => setDeleting(false)}
          onConfirm={async () => {
            await actions.remove(entry);
            setDeleting(false);
          }}
        />
      )}
    </>
  );
});

/** §5.4: copy the rule, paste it into AGENTS.md, then stop injecting it. */
function PromoteDialog({ entry, actions, onClose }: { entry: MemoryEntry; actions: MemoryActions; onClose(): void }) {
  const theme = useTheme();
  return (
    <Modal open title={t("Move to AGENTS.md")} onOpenChange={(open) => !open && onClose()}>
      <Modal.Content>
        <Theme.Provider value={theme}>
          <View style={{ gap: space[3] }}>
            <Label>{t("Every session of this repository reads AGENTS.md, inside Flowly or not. Flowly does not edit repository files: copy the rule, paste it where it belongs, then stop injecting it here so it is not said twice.")}</Label>
            <View style={{ padding: space[2], borderRadius: radius.md, backgroundColor: theme.colors.surface2 }}>
              <Label mono size={font.sm} selectable>{agentsRule(entry)}</Label>
            </View>
            <Actions>
              <Button quiet onPress={onClose}>{t("Cancel")}</Button>
              <Button quiet icon="Copy" onPress={() => void actions.copyRule(entry)}>{t("Copy rule")}</Button>
              <Button
                primary
                icon="Check"
                onPress={async () => {
                  await actions.archive(entry, "promoted");
                  onClose();
                }}
              >
                {t("Done, stop injecting")}</Button>
            </Actions>
          </View>
        </Theme.Provider>
      </Modal.Content>
    </Modal>
  );
}

function ConfirmDialog({ title, text, action, onClose, onConfirm }: { title: string; text: string; action: string; onClose(): void; onConfirm(): Promise<void> }) {
  const theme = useTheme();
  const [pending, setPending] = useState(false);
  return (
    <Modal open title={title} onOpenChange={(open) => !open && !pending && onClose()}>
      <Modal.Content>
        <Theme.Provider value={theme}>
          <View style={{ gap: space[3] }}>
            <Label>{text}</Label>
            <Actions>
              <Button quiet disabled={pending} onPress={onClose}>{t("Cancel")}</Button>
              <Button
                danger
                icon="Trash2"
                disabled={pending}
                onPress={async () => {
                  setPending(true);
                  await onConfirm();
                  setPending(false);
                }}
              >
                {action}</Button>
            </Actions>
          </View>
        </Theme.Provider>
      </Modal.Content>
    </Modal>
  );
}

/** Make room (§6.5): the project is full; archive one of the longest-unused to continue. */
function MakeRoomDialog({ projectId, entries, actions }: { projectId: string; entries: readonly MemoryEntry[]; actions: MemoryActions }) {
  const theme = useTheme();
  const options = leastUsed(entries, projectId);
  return (
    <Modal open title={t("Make room")} onOpenChange={(open) => !open && actions.closeRoom()}>
      <Modal.Content>
        <Theme.Provider value={theme}>
          <View style={{ gap: space[3] }}>
            <Label>{t("This project has {n} memories, the most it keeps. Archive one to continue; archived memories can be restored.", { n: memoryLimits.activePerProject })}</Label>
            {options.map((e) => (
              <View key={e.id} style={{ flexDirection: "row", alignItems: "center", gap: space[2] }}>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Label lines={1}>{e.title}</Label>
                  <Label muted size={font.xs}>{e.usedAt ? t("Last used {when}", { when: relative(e.usedAt, Date.now()) }) : t("Not used yet")}</Label>
                </View>
                <Button small quiet icon="Archive" disabled={!!actions.busy} onPress={() => void actions.madeRoom(e)}>{t("Archive")}</Button>
              </View>
            ))}
            <Actions>
              <Button quiet onPress={actions.closeRoom}>{t("Cancel")}</Button>
            </Actions>
          </View>
        </Theme.Provider>
      </Modal.Content>
    </Modal>
  );
}

/** The inline form for a new memory, an edit, or "Save and confirm" of a candidate. */
export function MemoryEditor({
  initial,
  title,
  submit,
  allowPin,
  onCancel,
  onSubmit,
}: {
  initial: Draft;
  title: string;
  submit: string;
  allowPin: boolean;
  onCancel(): void;
  onSubmit(draft: Draft): Promise<void> | void;
}) {
  const { colors } = useTheme();
  const [draft, setDraft] = useState(initial);
  const [pending, setPending] = useState(false);
  const set = (patch: Partial<Draft>) => setDraft((d) => ({ ...d, ...patch }));
  const valid = !!draft.title.trim();
  const go = async () => {
    if (!valid || pending) return;
    setPending(true);
    try {
      await onSubmit(draft);
    } finally {
      setPending(false);
    }
  };
  return (
    <View style={{ gap: space[3], padding: space[3], borderRadius: radius.lg, borderWidth: 1, borderColor: colors.accent, backgroundColor: colors.surface1 }}>
      <Label bold size={font.md}>{title}</Label>
      <Choices title={t("Kind")} value={draft.kind} options={memoryKinds.map((k) => ({ value: k, label: t(kindLabels[k]) }))} onChange={(kind) => set({ kind })} />
      <Field title={t("Title")} value={draft.title} onChange={(value) => set({ title: value })} placeholder={t("The rule or fact itself")} autoFocus />
      <Field title={t("Details")} value={draft.body} onChange={(value) => set({ body: value })} multiline placeholder={t("What and why, or the symptom and how to avoid it. Never a secret.")} />
      <Field title={t("Tags")} value={draft.tags} onChange={(value) => set({ tags: value })} placeholder={t("Comma-separated, e.g. drawer, mobile")} />
      <Field title={t("Search words")} value={draft.keywords} onChange={(value) => set({ keywords: value })} hint={t("Other names it goes by, in English and your language; they help new cards find it.")} placeholder={t("Comma-separated")} />
      {allowPin && <Toggle title={t("Pin")} detail={t("Every new session on this project sees it.")} value={draft.pinned} onChange={(pinned) => set({ pinned })} />}
      <Actions>
        <Button quiet disabled={pending} onPress={onCancel}>{t("Cancel")}</Button>
        <Button primary icon="Check" disabled={!valid || pending} onPress={() => void go()}>{submit}</Button>
      </Actions>
    </View>
  );
}

type Filter = "all" | MemoryKind | "stale";

/** The project Memory page (§8.1). Replaces the board area while open, like Ideas and Insights. */
export const MemoryPage = memo(function MemoryPage({
  project,
  tasks,
  compact,
  nameOf,
  onOpenTask,
  onBack,
}: {
  project: Project;
  /** The project's cards, archived included. */
  tasks: readonly Task[];
  compact: boolean;
  nameOf(status: Status): string;
  onOpenTask(id: string): void;
  onBack(): void;
}) {
  const { colors } = useTheme();
  const query = useMemoryQuery(project.id, true);
  const view = query.data;
  const actions = useMemoryActions(project.id, view);
  const [filter, setFilter] = useState<Filter>("all");
  const [search, setSearch] = useState("");
  const [adding, setAdding] = useState(false);
  const [closedOpen, setClosedOpen] = useState(false);
  const [staleAsk, setStaleAsk] = useState(false);
  const now = Date.now();
  const entries = view?.entries ?? noEntries;
  const cards = useMemo(() => new Map(tasks.map((t) => [t.id, t])), [tasks]);
  const disabled = !!project.archivedAt || !view?.enabled;
  const candidates = entries.filter((e) => e.status === "candidate").sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const active = entries.filter((e) => e.status === "active");
  const closed = entries.filter((e) => e.status === "dismissed" || e.status === "archived").sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const stale = active.filter((e) => isStale(e, now));
  const needle = search.trim().toLowerCase();
  const shown = active
    .filter((e) => (filter === "all" ? true : filter === "stale" ? isStale(e, now) : e.kind === filter))
    .filter((e) => !needle || `${e.title}\n${e.body}\n${e.tags.join(" ")}\n${e.keywords.join(" ")}`.toLowerCase().includes(needle))
    .sort((a, b) => Number(b.pinned) - Number(a.pinned) || (b.confirmedAt || b.createdAt).localeCompare(a.confirmedAt || a.createdAt));
  const source = (e: MemoryEntry) => (e.source.taskId ? <SourceLine task={cards.get(e.source.taskId)} nameOf={nameOf} onOpenTask={onOpenTask} /> : undefined);
  const card = (e: MemoryEntry) => (
    <View key={e.id} style={{ marginBottom: space[2] }}>
      <MemoryCard entry={e} entries={entries} actions={actions} disabled={disabled} source={source(e)} now={now} />
    </View>
  );
  const counts = (k: MemoryKind) => active.filter((e) => e.kind === k).length;
  return (
    <View style={{ flex: 1, minHeight: 0 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: space[2], paddingHorizontal: space[3], height: touch ? 48 : 40, borderBottomWidth: 1, borderColor: colors.border }}>
        <Button quiet icon="ChevronLeft" label={t("Back to board (Esc)")} onPress={onBack}>
          {t("Board")}</Button>
        <View style={{ flex: 1 }} />
        <Icon name="BookMarked" size={15} color={colors.foregroundMuted} />
        <Label bold size={font.md} selectable={false}>
          {t("Memory")}</Label>
        <View style={{ flex: 1 }} />
        <View style={{ width: compact ? 56 : 72 }} />
      </View>
      <ScrollView {...verticalScroll} keyboardShouldPersistTaps="handled" style={{ flex: 1, minHeight: 0 }} contentContainerStyle={{ ...verticalContent, padding: space[3], paddingBottom: space[6] * 2, alignItems: "center" }}>
        <View style={{ width: "100%", maxWidth: 760, gap: space[3] }}>
          {query.error && <Notice>{message(query.error)}</Notice>}
          {view && !view.enabled && <Notice tone="info">{t("Project memory is off for this project. Turn it on in the project's settings; what is here is kept.")}</Notice>}
          {active.length >= memoryLimits.warnAt && (
            <Notice tone="warning">{t("{n} of {max} memories. Archive stale ones to keep room.", { n: active.length, max: memoryLimits.activePerProject })}</Notice>
          )}
          {!!candidates.length && (
            <View style={{ gap: space[2] }}>
              <SectionTitle icon="Inbox" title={t("To review · {n}", { n: candidates.length })} ai />
              {candidates.map(card)}
            </View>
          )}
          <View style={{ gap: space[2] }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: space[2] }}>
              <SectionTitle icon="BookMarked" title={t("Memory · {n}", { n: active.length })} />
              <View style={{ flex: 1 }} />
              {!disabled && !adding && (
                <Button small quiet icon="Plus" onPress={() => setAdding(true)}>
                  {t("Add memory")}</Button>
              )}
            </View>
            {adding && (
              <MemoryEditor
                initial={draftOf()}
                title={t("Add memory")}
                submit={t("Add")}
                allowPin
                onCancel={() => setAdding(false)}
                onSubmit={async (draft) => {
                  if (await actions.create(draft)) setAdding(false);
                }}
              />
            )}
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space[1.5] }}>
              <FilterChip on={filter === "all"} label={t("All")} onPress={() => setFilter("all")} />
              {memoryKinds.map((k) => (
                <FilterChip key={k} on={filter === k} icon={kindIcons[k]} label={`${t(kindPlural[k])} ${counts(k)}`} onPress={() => setFilter(filter === k ? "all" : k)} />
              ))}
              {!!stale.length && <FilterChip on={filter === "stale"} icon="Clock" label={t("Clean up · {n}", { n: stale.length })} onPress={() => setFilter(filter === "stale" ? "all" : "stale")} />}
            </View>
            {active.length > 3 && (
              <TextBox
                value={search}
                onChangeText={setSearch}
                commitDelay={200}
                placeholder={t("Search memory")}
                accessibilityLabel={t("Search memory")}
                style={{ height: touch ? 40 : 32, paddingHorizontal: space[3], borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, color: colors.foreground, fontSize: font.base }}
              />
            )}
            {filter === "stale" && !!stale.length && !disabled && (
              <View style={{ flexDirection: "row", alignItems: "center", gap: space[2] }}>
                <Label muted size={font.sm}>{t("Not used by any card for {n} days.", { n: memoryLimits.staleDays })}</Label>
                <View style={{ flex: 1 }} />
                <Button small quiet icon="Archive" disabled={!!actions.busy} onPress={() => setStaleAsk(true)}>
                  {t("Archive all stale")}</Button>
              </View>
            )}
            <Enter key={filter} distance={0}>
              <View>
                {shown.length ? (
                  shown.map(card)
                ) : (
                  <View style={{ alignItems: "center", gap: space[2], paddingVertical: space[6] }}>
                    <Icon name="BookMarked" size={22} color={colors.foregroundMuted} />
                    <Label muted size={font.md}>
                      {!entries.length
                        ? t("Nothing remembered yet. Agents suggest decisions and pitfalls as they work, and finished cards are reviewed for them. You confirm what stays.")
                        : t("No matching memories.")}
                    </Label>
                  </View>
                )}
              </View>
            </Enter>
          </View>
          {!!closed.length && (
            <View style={{ gap: space[2] }}>
              <Pressable accessibilityRole="button" accessibilityState={{ expanded: closedOpen }} onPress={() => setClosedOpen(!closedOpen)} style={{ ...noFocusRing, flexDirection: "row", alignItems: "center", gap: space[1.5], minHeight: touch ? 40 : 28 }}>
                <Icon name={closedOpen ? "ChevronDown" : "ChevronRight"} size={14} color={colors.foregroundMuted} />
                <Label muted medium size={font.sm} selectable={false}>{t("Archived & dismissed · {n}", { n: closed.length })}</Label>
              </Pressable>
              {closedOpen && closed.map(card)}
            </View>
          )}
          {!!view && view.recall.queries > 0 && (
            <Label muted size={font.xs}>{t("Recall: {queries} searches, {empty} found nothing (30 days)", { queries: view.recall.queries, empty: view.recall.empty })}</Label>
          )}
        </View>
      </ScrollView>
      {actions.room && <MakeRoomDialog projectId={project.id} entries={entries} actions={actions} />}
      {staleAsk && (
        <ConfirmDialog
          title={tn(stale.length, "Archive {n} stale memory?", "Archive {n} stale memories?")}
          text={t("New sessions stop seeing them. You can restore them from Archived & dismissed.")}
          action={t("Archive")}
          onClose={() => setStaleAsk(false)}
          onConfirm={async () => {
            await actions.archiveStale(stale);
            setStaleAsk(false);
            setFilter("all");
          }}
        />
      )}
    </View>
  );
});
const noEntries: MemoryEntry[] = [];

/**
 * The drawer's Memory section (§8.2): candidates from this card with the page's
 * actions, how many confirmed ones came from it, and Find memories on finished cards.
 */
export function TaskMemorySection({ task, project, onOpenPage }: { task: Task; project: Project; onOpenPage(): void }) {
  const { colors } = useTheme();
  const [open, setOpen] = useState(true);
  const finished = task.status === "done" || task.status === "cancelled";
  const query = useMemoryQuery(project.id, true);
  const view = query.data;
  const actions = useMemoryActions(project.id, view);
  if (!view || !view.enabled) return null;
  const own = view.entries.filter((e) => e.source.taskId === task.id);
  const candidates = own.filter((e) => e.status === "candidate");
  const kept = own.filter((e) => e.status === "active").length;
  const running = view.running.includes(task.id);
  const error = view.errors.find((e) => e.taskId === task.id);
  if (!candidates.length && !kept && !finished) return null;
  const now = Date.now();
  return (
    <Section
      id={`memory-${task.id}`}
      title={t("Memory")}
      count={candidates.length || undefined}
      ai={!!candidates.length}
      open={open}
      onToggle={() => setOpen(!open)}
      actions={
        finished ? (
          <Button small quiet icon="Sparkles" disabled={running || !!project.archivedAt} onPress={() => void actions.review(task.id)}>
            {running ? t("Reviewing…") : t("Find memories")}</Button>
        ) : undefined
      }
    >
      {candidates.map((e) => (
        <MemoryCard key={e.id} entry={e} entries={view.entries} actions={actions} disabled={!!project.archivedAt} now={now} />
      ))}
      {!!kept && (
        <Pressable accessibilityRole="link" onPress={onOpenPage} style={{ ...noFocusRing, flexDirection: "row", alignItems: "center", gap: space[1] }}>
          <Label muted size={font.sm}>{tn(kept, "Remembered from this card: {n}", "Remembered from this card: {n}")}</Label>
          <Icon name="ChevronRight" size={12} color={colors.foregroundMuted} />
        </Pressable>
      )}
      {finished && !candidates.length && !kept && !running && !error && (
        <Label muted size={font.sm}>{view.retroEnabled ? t("Finished cards are reviewed for things worth remembering; most have none.") : t("Find memories asks the summary model for things worth remembering from this card.")}</Label>
      )}
      {error && <Label muted size={font.sm}>{t("Review failed: {message}", { message: error.message })}</Label>}
      {actions.room && <MakeRoomDialog projectId={project.id} entries={view.entries} actions={actions} />}
    </Section>
  );
}

function SectionTitle({ icon, title, ai }: { icon: string; title: string; ai?: boolean }) {
  const { colors } = useTheme();
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: space[1.5] }}>
      <Icon name={icon} size={14} color={colors.foregroundMuted} />
      <Label bold size={font.md} selectable={false}>{title}</Label>
      {ai && <AiMark label={t("AI generated")} />}
    </View>
  );
}

function SourceLine({ task, nameOf, onOpenTask }: { task: Task | undefined; nameOf(status: Status): string; onOpenTask(id: string): void }) {
  const { colors } = useTheme();
  if (!task)
    return (
      <View style={{ marginHorizontal: space[3], marginBottom: space[1.5], paddingHorizontal: space[2], minHeight: touch ? 36 : 28, justifyContent: "center" }}>
        <Label muted size={font.xs}>{t("From a deleted card")}</Label>
      </View>
    );
  return (
    <Pressable
      accessibilityRole="link"
      accessibilityLabel={t("From card {title}, {state}. Open it", { title: task.title, state: task.archivedAt ? t("archived") : nameOf(task.status) })}
      onPress={() => onOpenTask(task.id)}
      style={({ pressed, hovered }: { pressed: boolean; hovered?: boolean }) => ({
        ...noFocusRing,
        flexDirection: "row",
        alignItems: "center",
        gap: space[1.5],
        marginHorizontal: space[3],
        marginBottom: space[1.5],
        paddingHorizontal: space[2],
        minHeight: touch ? 36 : 28,
        borderRadius: radius.md,
        backgroundColor: pressed || hovered ? colors.surface2 : tint(colors.foreground, 0.03),
      })}
    >
      <Label muted size={font.xs} selectable={false}>{t("From")}</Label>
      <StatusIcon status={task.status} size={12} />
      <View style={{ flexShrink: 1, minWidth: 0 }}>
        <Label size={font.sm} lines={1} selectable={false}>{task.title}</Label>
      </View>
      <Label muted size={font.xs} selectable={false}>· {task.archivedAt ? t("Archived") : nameOf(task.status)}</Label>
      <View style={{ flex: 1 }} />
      <Icon name="ChevronRight" size={13} color={colors.foregroundMuted} />
    </Pressable>
  );
}

function FilterChip({ on, icon, label, onPress }: { on: boolean; icon?: string; label: string; onPress(): void }) {
  const { colors } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected: on }}
      onPress={onPress}
      hitSlop={touch ? 6 : 0}
      style={({ pressed, hovered }: { pressed: boolean; hovered?: boolean }) => ({
        ...noFocusRing,
        flexDirection: "row",
        alignItems: "center",
        gap: space[1],
        height: touch ? 32 : 26,
        paddingHorizontal: space[2],
        borderRadius: radius.full,
        borderWidth: 1,
        borderColor: on ? colors.accent : colors.border,
        backgroundColor: on ? tint(colors.accent, 0.12) : pressed || hovered ? colors.surface2 : "transparent",
      })}
    >
      {!!icon && <Icon name={icon} size={12} color={on ? colors.accent : colors.foregroundMuted} />}
      <Label size={font.sm} color={on ? colors.accent : undefined} muted={!on} selectable={false}>
        {label}
      </Label>
    </Pressable>
  );
}

/** "3d ago" style, for the usage line. */
function relative(iso: string, now: number) {
  const minutes = Math.max(0, Math.round((now - Date.parse(iso)) / 60000));
  if (minutes < 60) return t("{n}m ago", { n: Math.max(1, minutes) });
  const hours = Math.round(minutes / 60);
  if (hours < 24) return t("{n}h ago", { n: hours });
  return t("{n}d ago", { n: Math.round(hours / 24) });
}
