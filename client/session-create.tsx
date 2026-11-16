import { useEffect, useRef, useState } from "react";
import { View } from "react-native";
import { Modal } from "./modal";
import { usePaseo, useRpc } from "@getpaseo/plugin/client";
import { useQuery } from "@tanstack/react-query";
import type { Task } from "../shared/model";
import type { ToolPreparation } from "../shared/tools";
import * as rpc from "../shared/rpc";
import { createPreparedSession } from "./session";
import { Theme, useTheme, Button, Label, Field, Choices, Notice, Actions, message, font, radius, space } from "./ui";
import { AgentPicker, useAgentChoice } from "./agent-choice";
import { Pressable } from "react-native";
import { t } from "../shared/i18n";
import { ImageAttachments, useImageAttachments } from "./image-attach";
import { DraftNotice, draftAttachments, useDraftChanges, useFormDraft, type FormDraft } from "./form-draft";
import { draftField, formDraftKey } from "../shared/form-drafts";
import { maxImages } from "../shared/composer";
import { useToast } from "@getpaseo/plugin/client/react-native";
import { newMessageId, rememberSentImages } from "./sent-images";

type Attempt = { operationId: string; messageId: string; fingerprint: string; prepared?: ToolPreparation };

function SessionForm({
  task,
  open,
  workspaceDirectory,
  unavailable,
  onClose,
  onCreated,
  refresh,
  defaults,
  seed,
  draft,
  busy,
  attempt,
  requestClose,
}: {
  task: Task;
  open: boolean;
  /** Prefill for a session started from an idea (IDEAS-SPEC §6.3); read when the form opens. */
  seed?: { title: string; prompt: string; ideaId?: string } | null;
  /** Provider/model/mode of the latest session, reused as this form's starting point. */
  defaults?: { provider: string; model: string; mode: string } | null;
  workspaceDirectory?: string;
  unavailable: boolean;
  onClose(): void;
  onCreated(id: string, feedback: string): void;
  refresh(): void;
  draft: FormDraft;
  busy: { current: boolean };
  attempt: { current: Attempt | undefined };
  requestClose(): void;
}) {
  const toast = useToast();
  const paseo = usePaseo(),
    contextRead = useRpc(rpc.taskContext),
    prepare = useRpc(rpc.prepareSession),
    healthRead = useRpc(rpc.toolsHealth);
  // Mounted fresh on every open from the saved draft, else the seed (docs/FORM-DRAFTS-SPEC.md).
  // The instruction starts empty: the task's title and description already reach the session.
  const saved = draft.draft?.fields;
  const choice = useAgentChoice({
    enabled: open,
    cwd: workspaceDirectory,
    defaults: saved
      ? {
          provider: draftField.text(saved, "provider") || defaults?.provider || "",
          model: draftField.text(saved, "model") ?? defaults?.model ?? "",
          mode: draftField.text(saved, "mode") ?? defaults?.mode ?? "",
          thinking: draftField.text(saved, "thinking") ?? "",
        }
      : defaults,
  });
  const { provider, chosenModel, chosenMode, providers, models, modes } = choice;
  const [newTitle, setTitle] = useState(() => draftField.text(saved, "title") ?? seed?.title ?? ""),
    [newPrompt, setPrompt] = useState(() => draftField.text(saved, "prompt") ?? seed?.prompt ?? ""),
    [sending, setSending] = useState(false),
    [error, setError] = useState(""),
    // A prepared session survives closing the form, so a retry finds it instead of creating another.
    [creationPending, setCreationPending] = useState(() => !!attempt.current?.prepared);
  // Images with the first message (web: paste, drop or Add images).
  const attachments = useImageAttachments(maxImages, undefined, draftAttachments(draft.draft));
  useDraftChanges(
    draft,
    draft.status === "ready",
    { title: newTitle, prompt: newPrompt, provider, model: choice.model, mode: choice.mode, thinking: choice.thinking },
    attachments.attachments,
  );
  const lock = useRef(false);
  const tools = useQuery({
    queryKey: ["flowly", "tools"],
    queryFn: () => healthRead({}),
    enabled: open,
    refetchInterval: open ? 5000 : false,
  });
  const hasInstruction = !!newPrompt.trim();
  const canCreate =
    !sending &&
    !unavailable &&
    choice.ready &&
    hasInstruction;
  async function perform(action: () => Promise<unknown>) {
    if (lock.current) return;
    lock.current = true;
    busy.current = true;
    setSending(true);
    setError("");
    try {
      await action();
    } catch (e) {
      setError(message(e));
    } finally {
      lock.current = false;
      busy.current = false;
      setSending(false);
    }
  }
  async function createSession(ordinary = false) {
    await perform(async () => {
      const chosen = chosenModel;
      if (!chosen) throw new Error(t("Choose an available model."));
      const latestScope = await contextRead({ id: task.id });
      if (!latestScope.available) throw new Error(latestScope.reason);
      const fingerprint = JSON.stringify([
        provider,
        chosen,
        chosenMode,
        choice.chosenThinking,
        newTitle,
        newPrompt,
        ordinary,
      ]);
      if (attempt.current?.prepared) {
        const existing = await paseo.agents
          .ref(attempt.current.prepared.agentId)
          .refresh();
        if (existing?.agent) {
          if (
            existing.agent.workspaceId !== task.workspaceId ||
            existing.agent.archivedAt
          )
            throw new Error(
              t("Prepared session is unavailable or belongs to a different workspace."),
            );
          onCreated(
            existing.agent.id,
            t("Recovered the existing session. Its initial instruction was not sent again; check its output before continuing."),
          );
          await draft.clear().catch(() => undefined);
          onClose();
          attempt.current = undefined;
          setCreationPending(false);
          refresh();
          return;
        }
      }
      if (!attempt.current || attempt.current.fingerprint !== fingerprint)
        attempt.current = {
          operationId: `session-${Date.now()}-${Math.random().toString(36).slice(2)}`,
          messageId: newMessageId(),
          fingerprint,
        };
      const images = attachments.images();
      const imageUris = attachments.uris();
      const messageId = attempt.current.messageId;
      const preparation = ordinary
        ? undefined
        : await prepare({
            id: task.id,
            operationId: attempt.current.operationId,
          });
      if (preparation) {
        attempt.current.prepared = preparation;
        setCreationPending(true);
      }
      const options = {
        config: {
          provider: `${provider}/${chosen}`,
          systemPrompt: preparation?.instructions || latestScope.context,
          ...(chosenMode ? { modeId: chosenMode } : {}),
          ...(choice.chosenThinking ? { thinkingOptionId: choice.chosenThinking } : {}),
        },
        ...(preparation
          ? {
              agentId: preparation.agentId,
              idempotencyKey: `ultra-kanban-session:${preparation.agentId}`,
              env: {
                FLOWLY_CONTEXT_FILE: preparation.contextFile,
                FLOWLY_CLI: preparation.cliPath,
                FLOWLY_SKILL: preparation.skillPath,
              },
            }
          : { idempotencyKey: attempt.current.operationId }),
        title: newTitle.trim() || task.title,
        labels: { "flowly-task": task.id },
        prompt: newPrompt.trim(),
        ...(images.length ? { images, clientMessageId: messageId } : {}),
      };
      const created = preparation
        ? await createPreparedSession(paseo, task.workspaceId, {
            ...options,
            agentId: preparation.agentId,
          })
        : await paseo.workspaces.ref(task.workspaceId).agents.create(options);
      if (images.length) rememberSentImages(messageId, imageUris);
      attachments.clear();
      onCreated(
        created.id,
        "recovered" in created && created.recovered
          ? t("Session exists after a partial creation response. Check its output before sending more instructions.")
          : ordinary
            ? t("Ordinary session created. Select it to send Kanban instructions later.")
            : t("Kanban configuration provided. Successful tool calls will be shown separately."),
      );
      attempt.current = undefined;
      setCreationPending(false);
      // The session exists: its draft is done (a failed clear only warns).
      await draft.clear().catch((e) => toast.error(t("The draft was not cleared: {error}", { error: message(e) })));
      onClose();
      refresh();
    });
  }
  // Enter submits, Shift+Enter is a new line.
  const submit = canCreate && tools.data?.ready ? () => void createSession() : undefined;
  return (
    <>
        <Field
          title={t("Session title (optional)")}
          value={newTitle}
          onChange={setTitle}
          placeholder={task.title}
          editable={!sending}
          onSubmit={submit}
        />
        <ImageAttachments state={attachments} disabled={sending}>
          <Field
            title={t("Instruction")}
            value={newPrompt}
            onChange={setPrompt}
            multiline
            placeholder={t("What should this session do first?")}
            editable={!sending}
            onSubmit={submit}
          />
        </ImageAttachments>
        <AgentPicker choice={choice} disabled={sending} />
        <Label muted size={font.sm}>
          {t("The task's title and description are included automatically, along with Kanban tools.")}</Label>
        {providers.isSuccess &&
          !providers.data?.providers.some((p) => p.available) && (
            <Notice>
              {t("No providers are available. Configure a provider in Paseo to create a session.")}</Notice>
          )}
        {providers.isSuccess &&
          providers.data?.providers.some((p) => p.available) &&
          !providers.data?.providers.some(
            (p) => p.available && p.provider === provider,
          ) && (
            <Notice>{t("Choose an available provider.")}</Notice>
          )}
        {models.isSuccess &&
          !(models.data?.models || []).some(
            (m) => m.isSelectable !== false,
          ) && (
            <Notice>
              {t("No selectable models are available for this provider.")}</Notice>
          )}
        {(models.error || modes.error || providers.error) && (
          <Notice>
            {message(models.error || modes.error || providers.error)}
          </Notice>
        )}
        {(!tools.data?.ready || tools.error) && (
          <Notice tone={tools.error ? "danger" : "warning"}>
            {tools.error
              ? message(tools.error)
              : tools.data?.reason || t("Checking Kanban tools…")}
          </Notice>
        )}
        {creationPending && (
          <Notice tone="info">
            {t("A session ID is prepared. Retry checks for an existing session before creating it.")}</Notice>
        )}
        {error && <Notice>{error}</Notice>}
        <DraftNotice draft={draft} onDiscardClose={() => {
          draft.discard();
          onClose();
        }} />
        <Actions>
          {!tools.data?.ready && (
            <Button
              disabled={!canCreate}
              onPress={() => void createSession(true)}
            >
              {t("Create ordinary session")}</Button>
          )}
          <Button quiet disabled={sending} onPress={requestClose}>
            {t("Cancel")}</Button>
          <Button
            primary
            disabled={!submit}
            onPress={() => void createSession()}
          >
            {sending ? t("Creating…") : t("Create session")}
          </Button>
        </Actions>
    </>
  );
}

/**
 * New session in a card. Its draft (per card and prefill source) is saved on
 * the daemon and restored on every open (docs/FORM-DRAFTS-SPEC.md).
 */
export function SessionCreate(props: Omit<Parameters<typeof SessionForm>[0], "draft" | "busy" | "attempt" | "requestClose">) {
  const theme = useTheme();
  const { open, onClose, task, seed } = props;
  const draft = useFormDraft(formDraftKey("session", task.id, seed?.ideaId ? { ideaId: seed.ideaId } : null), open);
  const busy = useRef(false);
  const attempt = useRef<Attempt | undefined>(undefined);
  const closing = useRef(false);
  // Close, Cancel, Esc and Back save what is pending first; a failed save keeps the form open.
  const requestClose = () => {
    if (busy.current || closing.current) return;
    closing.current = true;
    void draft.flush().then((saved) => {
      closing.current = false;
      if (saved) onClose();
    });
  };
  return (
    <Modal
      open={open}
      title={t("New session")}
      onOpenChange={(next) => {
        if (!next) requestClose();
      }}
    >
      <Modal.Content>
        <Theme.Provider value={theme}>
          {open && draft.status !== "loading" ? (
            <SessionForm key={draft.generation} {...props} draft={draft} busy={busy} attempt={attempt} requestClose={requestClose} />
          ) : (
            <Label muted>{t("Loading…")}</Label>
          )}
        </Theme.Provider>
      </Modal.Content>
    </Modal>
  );
}
