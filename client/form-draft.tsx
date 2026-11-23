import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { View } from "react-native";
import { useRpc } from "@getpaseo/plugin/client";
import * as rpc from "../shared/rpc";
import { draftConflictMessage, type ReadDraft } from "../shared/form-drafts";
import { DraftSaver, FailedLoadEdits, clearAfterSaves, flushBeforeClose, readAfterSaves, fitDraftFields, overwriteLatest, mergeAfterFailedLoad, type DraftSaveState, type DraftSnapshot } from "./form-draft-saver";
import type { Attachment } from "./web-images";
import { Button, Notice, message, space } from "./ui";
import { t, tn } from "../shared/i18n";

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
 * "loading" and the form should not render its fields. `imageLimit` is how
 * many images the form holds, so a merged draft never saves more than it shows.
 */
export function useFormDraft(key: string | null, active = true, imageLimit = Number.POSITIVE_INFINITY) {
  const read = useRpc(rpc.readFormDraft),
    save = useRpc(rpc.saveFormDraft),
    clearRpc = useRpc(rpc.clearFormDraft);
  const [status, setStatus] = useState<"off" | "loading" | "ready" | "failed">(key ? "loading" : "off");
  const [draft, setDraft] = useState<ReadDraft>(null);
  const [loadError, setLoadError] = useState("");
  const [saveState, setSaveState] = useState<DraftSaveState>({ saving: false, error: "", conflict: false });
  // Bumped on every load, so a form can remount its fields from the loaded draft.
  const [generation, setGeneration] = useState(0);
  // The committed key: a render React discards never makes a running load look superseded.
  const keyRef = useRef(key);
  useLayoutEffect(() => {
    keyRef.current = key;
  }, [key]);
  // A reconnect may hand out a new RPC function; that must not reload (and remount) the form.
  const readRef = useRef(read);
  readRef.current = read;
  const saveRef = useRef(save);
  saveRef.current = save;
  // What the form reported while its load failed (nothing is saved then), for the next Retry.
  const edits = useRef(new FailedLoadEdits()).current;
  // Saved images a merge left out to stay within imageLimit.
  const [leftOut, setLeftOut] = useState(0);
  // Edits made after a failed load: closing keeps the form open for Retry or Close without saving.
  const [unsavedEdits, setUnsavedEdits] = useState(false);
  const statusRef = useRef(status);
  statusRef.current = status;
  // The newest load: an older one (a superseded Retry, a load from before a close) never applies its result.
  const loadId = useRef(0);
  const saver = useMemo(
    // Bound to this key: a save still pending when the key changes lands under its own key.
    () => new DraftSaver((input) => saveRef.current({ key: key!, ...input }), setSaveState),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [key],
  );
  const load = useCallback(() => {
    if (!key) return setStatus("off");
    // Retry after a failed load of this same key keeps what was typed meanwhile,
    // also over several failed retries; edits made under another key never carry over.
    const kept = edits.begin(key, statusRef.current === "failed");
    setUnsavedEdits(false);
    setStatus("loading");
    setLeftOut(0);
    setLoadError("");
    const id = ++loadId.current;
    const k = key;
    const current = () => id === loadId.current && keyRef.current === k;
    const apply = (result: Awaited<ReturnType<typeof read>>) => {
      if (!current()) return;
      saver.loaded(result.revision, result.draft?.images.map((i) => i.id) || []);
      const merged = kept ? mergeAfterFailedLoad(result.draft, kept.typed, kept.base, imageLimit) : null;
      // Restored: the form remounts from here and reports a new starting point.
      edits.reset();
      setLeftOut(merged?.leftOut ?? 0);
      if (merged) {
        setDraft({ revision: result.revision || 1, fields: merged.fields, images: merged.images.map((i) => ({ ...i })) });
        // Saved like any change; the merge holds everything the loaded draft had.
        saver.change({ fields: fitDraftFields(merged.fields), images: merged.images });
      } else setDraft(result.draft);
      setGeneration((g) => g + 1);
      setStatus("ready");
    };
    const fail = (e: unknown) => {
      if (!current()) return;
      // Never save over a draft that could not be read.
      saver.disable();
      setLoadError(message(e));
      // The form remounts: it shows what was typed so far (kept for the next Retry), else defaults.
      const shown = edits.shown(k);
      setDraft(shown ? { revision: 1, fields: shown.fields, images: shown.images.map((i) => ({ ...i })) } : null);
      setUnsavedEdits(edits.pending(k));
      setGeneration((g) => g + 1);
      setStatus("failed");
    };
    // An edit still waiting for its save (or a save on its way) lands first, so the read includes it.
    readAfterSaves(saver, current, () => readRef.current({ key: k })).then((loaded) => {
      if (!loaded) return;
      if ("result" in loaded) return apply(loaded.result);
      // The edit could not be saved: nothing is read over it. The form shows it again with the save error (Retry / Close without saving).
      const { unsaved } = loaded;
      setDraft({ revision: saver.currentRevision || 1, fields: unsaved.fields, images: unsaved.images.map((i) => ({ ...i })) });
      setGeneration((g) => g + 1);
      setStatus("ready");
    }, fail);
  }, [key, saver, imageLimit, edits]);
  useEffect(() => {
    if (!active) return;
    load();
    return () => {
      // Closed (or the key changed): a load still running is dropped, and what was typed is saved now.
      loadId.current++;
      if (saver.dirty) void saver.flush();
    };
  }, [active, load, saver]);
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
    leftOut,
    imageLimit,
    /** Edits made after a failed load, which nothing has saved. */
    unsavedEdits,
    retryLoad: load,
    /** The form's content when it mounted. */
    started: (snapshot: DraftSnapshot) => {
      edits.started(snapshot);
    },
    change: (snapshot: DraftSnapshot) => {
      edits.changed(snapshot);
      if (key && statusRef.current === "failed") setUnsavedEdits(edits.pending(key));
      saver.change({ ...snapshot, fields: fitDraftFields(snapshot.fields) });
    },
    /** Before a close; false keeps the form open (see flushBeforeClose). */
    flush: () => flushBeforeClose(saver, edits, key, statusRef.current === "failed"),
    discard: () => {
      saver.discard();
      edits.reset();
      setUnsavedEdits(false);
    },
    retrySave: async () => {
      if (!saver.state.conflict || !key) return saver.flush();
      try {
        // Keep this form's version on top of the newer one the user was told about.
        return await overwriteLatest(saver, () => readRef.current({ key }));
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
      // A draft that could not be read is never deleted unseen; the caller's toast says it was kept.
      if (status !== "ready") throw new Error(t("It could not be loaded, so it was kept."));
      // Only the revision this form saw (after a save on its way): a newer draft from another window is kept.
      if (!(await clearAfterSaves(saver, (revision) => clearRpc({ key, revision }))))
        throw new Error(t("It was changed in another window and was kept."));
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

/**
 * Load/save problems with their way out: Retry, and Close without saving after
 * a failed save. `busy` (a create running) disables Retry of a failed load,
 * which would remount the form under that create.
 */
export function DraftNotice({ draft, onDiscardClose, busy = false }: { draft: FormDraft; onDiscardClose(): void; busy?: boolean }) {
  const leftOut = draft.leftOut ? (
    <Notice>
      {tn(draft.leftOut, "{n} saved image was left out: this form holds at most {limit} images.", "{n} saved images were left out: this form holds at most {limit} images.", {
        limit: draft.imageLimit,
      })}
    </Notice>
  ) : null;
  if (draft.status === "failed")
    return (
      <View style={{ gap: space[2] }}>
        <Notice>{t("The saved draft could not be loaded, so changes here are not saved: {error}", { error: draft.loadError })}</Notice>
        <View style={{ flexDirection: "row", gap: space[2] }}>
          <Button small disabled={busy} onPress={() => draft.retryLoad()}>
            {t("Retry")}
          </Button>
          {draft.unsavedEdits && (
            <Button small quiet disabled={busy} onPress={onDiscardClose}>
              {t("Close without saving")}
            </Button>
          )}
        </View>
      </View>
    );
  if (!draft.saveState.error) return leftOut;
  return (
    <View style={{ gap: space[2] }}>
      {leftOut}
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
