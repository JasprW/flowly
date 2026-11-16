import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { View } from "react-native";
import { useRpc } from "@getpaseo/plugin/client";
import * as rpc from "../shared/rpc";
import type { ReadDraft } from "../shared/form-drafts";
import { DraftSaver, type DraftSaveState, type DraftSnapshot } from "./form-draft-saver";
import type { Attachment } from "./web-images";
import { Button, Notice, message, space } from "./ui";
import { t } from "../shared/i18n";

export type FormDraft = ReturnType<typeof useFormDraft>;

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
  const saver = useMemo(
    // Bound to this key: a save still pending when the key changes lands under its own key.
    () => new DraftSaver((input) => saveRef.current({ key: key!, ...input }), setSaveState),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [key],
  );
  const load = useCallback(() => {
    if (!key) return setStatus("off");
    setStatus("loading");
    setLoadError("");
    saver.disable();
    let live = true;
    readRef.current({ key })
      .then((result) => {
        if (!live || keyRef.current !== key) return;
        saver.loaded(result.draft?.revision ?? 0, result.draft?.images.map((i) => i.id) || []);
        setDraft(result.draft);
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
    status,
    draft,
    generation,
    loadError,
    saveState,
    retryLoad: load,
    change: (snapshot: DraftSnapshot) => saver.change(snapshot),
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
    persist: (snapshot: DraftSnapshot) => {
      if (status !== "ready") return Promise.resolve(true);
      saver.change(snapshot);
      return saver.flush();
    },
    /** After a successful create; a later change starts a new draft. */
    clear: async () => {
      saver.discard();
      saver.disable();
      if (!key) return;
      await clearRpc({ key });
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
          ? t("This draft was changed in another window. Retry to keep this version instead.")
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
