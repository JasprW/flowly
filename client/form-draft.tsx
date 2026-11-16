import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { View } from "react-native";
import { useRpc } from "@getpaseo/plugin/client";
import * as rpc from "../shared/rpc";
import { draftConflictMessage, type ReadDraft } from "../shared/form-drafts";
import { DraftSaver, fitDraftFields, mergeAfterFailedLoad, type DraftSaveState, type DraftSnapshot } from "./form-draft-saver";
import type { Attachment } from "./web-images";
import { Button, Notice, message, space } from "./ui";
import { t } from "../shared/i18n";

export type FormDraft = ReturnType<typeof useFormDraft>;

/**
 * Create identities of forms whose draft could not be saved (its load failed),
 * kept for this client's lifetime so a retry after reopening still reuses the
 * server's idempotent create.
 */
const unsavedOperations = new Map<string, string>();

/**
 * Loads and saves one New task / New session draft on the daemon
 * (docs/FORM-DRAFTS-SPEC.md). `key` null means no draft (Edit task). Each
 * time `active` turns on the draft is read again; until then `status` is
 * "loading" and the form should not render its fields.
 */
export function useFormDraft(key: string | null, active = true) {
  const read = useRpc(rpc.readFormDraft),
    save = useRpc(rpc.saveFormDraft),
    clearRpc = useRpc(rpc.clearFormDraft);
  const [status, setStatus] = useState<"off" | "loading" | "ready" | "failed">(key ? "loading" : "off");
  const [draft, setDraft] = useState<ReadDraft>(null);
  const [loadError, setLoadError] = useState("");
  const [saveState, setSaveState] = useState<DraftSaveState>({ saving: false, error: "", conflict: false });
  // Bumped on every load, so a form can remount its fields from the loaded draft.
  const [generation, setGeneration] = useState(0);
  const keyRef = useRef(key);
  keyRef.current = key;
  // A reconnect may hand out a new RPC function; that must not reload (and remount) the form.
  const readRef = useRef(read);
  readRef.current = read;
  const saveRef = useRef(save);
  saveRef.current = save;
  // What the form last reported, also while its load failed (nothing is saved then).
  const typed = useRef<DraftSnapshot | null>(null);
  // What the form showed when it mounted, to tell the user's changes from defaults.
  const base = useRef<DraftSnapshot | null>(null);
  const statusRef = useRef(status);
  statusRef.current = status;
  const saver = useMemo(
    // Bound to this key: a save still pending when the key changes lands under its own key.
    () => new DraftSaver((input) => saveRef.current({ key: key!, ...input }), setSaveState),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [key],
  );
  const load = useCallback(() => {
    if (!key) return setStatus("off");
    // Retry after a failed load keeps what was typed meanwhile.
    const kept = statusRef.current === "failed" ? { typed: typed.current, base: base.current } : null;
    typed.current = null;
    base.current = null;
    setStatus("loading");
    setLoadError("");
    saver.disable();
    let live = true;
    readRef.current({ key })
      .then((result) => {
        if (!live || keyRef.current !== key) return;
        saver.loaded(result.revision, result.draft?.images.map((i) => i.id) || []);
        const merged = kept ? mergeAfterFailedLoad(result.draft, kept.typed, kept.base) : null;
        if (merged) {
          setDraft({ revision: result.revision || 1, fields: merged.fields, images: merged.images.map((i) => ({ ...i })) });
          // Saved like any change; the merge holds everything the loaded draft had.
          saver.change({ fields: fitDraftFields(merged.fields), images: merged.images });
        } else setDraft(result.draft);
        setGeneration((g) => g + 1);
        setStatus("ready");
      })
      .catch((e) => {
        if (!live) return;
        // Never save over a draft that could not be read.
        saver.disable();
        setLoadError(message(e));
        setDraft(null);
        setGeneration((g) => g + 1);
        setStatus("failed");
      });
    return () => {
      live = false;
    };
  }, [key, saver]);
  useEffect(() => {
    if (active) return load();
  }, [active, load]);
  // Leaving (navigation, project switch) still saves what is pending.
  useEffect(
    () => () => {
      if (saver.dirty) void saver.flush();
      saver.stop();
    },
    [saver],
  );
  return {
    key,
    status,
    draft,
    generation,
    loadError,
    saveState,
    retryLoad: load,
    /** The form's content when it mounted. */
    started: (snapshot: DraftSnapshot) => {
      base.current = snapshot;
    },
    change: (snapshot: DraftSnapshot) => {
      typed.current = snapshot;
      saver.change({ ...snapshot, fields: fitDraftFields(snapshot.fields) });
    },
    flush: () => saver.flush(),
    discard: () => saver.discard(),
    retrySave: async () => {
      if (!saver.state.conflict || !key) return saver.flush();
      try {
        // Keep this form's version on top of the newer one the user was told about.
        const latest = await readRef.current({ key });
        return await saver.overwrite(latest.draft?.revision ?? 0);
      } catch (e) {
        // The conflict stays, so Retry stays available.
        setSaveState({ saving: false, error: message(e), conflict: true });
        return false;
      }
    },
    /** Saves this snapshot now (before a create); true when it is saved or drafts are off. */
    persist: (snapshot: DraftSnapshot, operationId?: string) => {
      if (status !== "ready") {
        // Nothing can be saved over an unread draft: keep the create identity in memory instead.
        if (key && operationId) unsavedOperations.set(key, operationId);
        return Promise.resolve(true);
      }
      saver.change({ ...snapshot, fields: fitDraftFields(snapshot.fields) });
      return saver.flush();
    },
    /** The create identity of an earlier attempt whose draft could not be saved. */
    unsavedOperation: () => (key ? unsavedOperations.get(key) : undefined),
    /** After a successful create; a later change starts a new draft. */
    clear: async () => {
      saver.discard();
      saver.disable();
      if (!key) return;
      unsavedOperations.delete(key);
      // A draft that could not be read is never deleted unseen.
      if (status !== "ready") return;
      // Only the revision this form saw: a newer draft from another window is kept.
      await clearRpc({ key, revision: saver.currentRevision });
    },
  };
}

/** Restored images as attachments the image picker shows and sends. */
export function draftAttachments(draft: ReadDraft): Attachment[] {
  return (draft?.images || []).map((i) => ({ id: i.id, name: i.name, mimeType: i.mimeType, data: i.data, uri: `data:${i.mimeType};base64,${i.data}` }));
}

/** The images part of a snapshot. */
export function snapshotImages(list: readonly Attachment[]): DraftSnapshot["images"] {
  return list.map((a) => ({ id: a.id, name: a.name.slice(0, 300), mimeType: a.mimeType, data: a.data }));
}

/**
 * Sends a snapshot whenever the form's content differs from what it last
 * reported (the first render after a restore is not a change).
 */
export function useDraftChanges(draft: FormDraft, ready: boolean, fields: DraftSnapshot["fields"], images: readonly Attachment[]) {
  const fieldsKey = JSON.stringify(fields);
  const imagesKey = images.map((i) => i.id).join(",");
  const last = useRef<string | null>(null);
  const latest = useRef({ fields, images });
  latest.current = { fields, images };
  useEffect(() => {
    last.current = null;
  }, [draft.generation]);
  useEffect(() => {
    if (!ready) return;
    const now = `${fieldsKey}\u0000${imagesKey}`;
    if (last.current === null) {
      last.current = now;
      draft.started({ fields: latest.current.fields, images: snapshotImages(latest.current.images) });
      return;
    }
    if (last.current === now) return;
    last.current = now;
    draft.change({ fields: latest.current.fields, images: snapshotImages(latest.current.images) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, fieldsKey, imagesKey, draft.generation]);
}

/** Load/save problems with their way out: Retry, and Close without saving after a failed save. */
export function DraftNotice({ draft, onDiscardClose }: { draft: FormDraft; onDiscardClose(): void }) {
  if (draft.status === "failed")
    return (
      <View style={{ gap: space[2] }}>
        <Notice>{t("The saved draft could not be loaded, so changes here are not saved: {error}", { error: draft.loadError })}</Notice>
        <View style={{ flexDirection: "row", gap: space[2] }}>
          <Button small onPress={() => draft.retryLoad()}>
            {t("Retry")}
          </Button>
        </View>
      </View>
    );
  if (!draft.saveState.error) return null;
  return (
    <View style={{ gap: space[2] }}>
      <Notice>
        {draft.saveState.conflict
          ? draft.saveState.error.includes(draftConflictMessage)
            ? t("This draft was changed in another window. Retry to keep this version instead.")
            : // A failed retry: the conflict stays, and so does the reason the retry failed.
              `${t("This draft was changed in another window. Retry to keep this version instead.")} ${t("The draft was not saved: {error}", { error: draft.saveState.error })}`
          : t("The draft was not saved: {error}", { error: draft.saveState.error })}
      </Notice>
      <View style={{ flexDirection: "row", gap: space[2] }}>
        <Button small disabled={draft.saveState.saving} onPress={() => void draft.retrySave()}>
          {t("Retry")}
        </Button>
        <Button small quiet onPress={onDiscardClose}>
          {t("Close without saving")}
        </Button>
      </View>
    </View>
  );
}
