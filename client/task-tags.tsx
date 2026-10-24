import { memo, useEffect, useMemo, useRef, useState } from "react";
import { View } from "react-native";
import { useRpc } from "@getpaseo/plugin/client";
import { useQueryClient } from "@tanstack/react-query";
import * as rpc from "../shared/rpc";
import type { Task } from "../shared/model";
import { tagValues } from "../shared/tags";
import { useTaskDetail, invalidateCardViews } from "./card-detail-query";
import { TagEditor } from "./tag-input";
import { useStableCallback } from "./stable";
import { Icon } from "@getpaseo/plugin/client/react-native";
import { Button, Label, Notice, message, space, touch, useTheme } from "./ui";
import { t } from "../shared/i18n";

/**
 * The drawer's Tags row (CARD-TAGS-SPEC §6.3): always editable, no edit mode.
 * Each change shows at once and saves through `tasks.tags` (no card revision);
 * a failed save puts the tags back. Tapping a tag filters the board.
 */
export const TaskTags = memo(function TaskTags({
  task,
  active,
  readOnly = false,
  onFilterTag,
}: {
  task: Task;
  /** False while the drawer closes: presses are ignored but the row keeps its layout. */
  active: boolean;
  /** Archived card or project: no × and no "+ Add". */
  readOnly?: boolean;
  onFilterTag?(tag: string): void;
}) {
  const { colors } = useTheme();
  const queryClient = useQueryClient();
  const { index, indexError, retryIndex } = useTaskDetail();
  const save = useRpc(rpc.updateTaskTags);
  const saved = useMemo(() => tagValues(task), [task.tags]);
  // Shown while a save is in flight; dropped when the board brings the saved tags.
  const [shown, setShown] = useState<string[] | null>(null),
    [error, setError] = useState("");
  const pendingSaves = useRef(0);
  useEffect(() => {
    if (!pendingSaves.current) setShown(null);
  }, [saved]);
  const tags = shown ?? saved;
  const agentTags = useMemo(() => new Set((task.tags || []).filter((x) => x.by === "agent").map((x) => x.tag)), [task.tags]);
  const suggestions = useMemo(
    () => (index?.tags || []).map((x) => x.tag),
    [index?.tags],
  );
  const writable = !readOnly && !task.archivedAt;
  const change = useStableCallback(async (edit: { add?: string[]; remove?: string[] }, next: string[]) => {
    if (!active) return;
    setError("");
    setShown(next);
    pendingSaves.current++;
    try {
      await save({ taskId: task.id, ...edit });
    } catch (e) {
      setShown(null);
      setError(message(e));
    } finally {
      pendingSaves.current--;
      await invalidateCardViews(queryClient);
      if (!pendingSaves.current) setShown(null);
    }
  });
  const add = useStableCallback((values: string[]) => void change({ add: values }, [...tags, ...values]));
  const remove = useStableCallback((tag: string) => void change({ remove: [tag] }, tags.filter((x) => x !== tag)));
  const filter = useStableCallback((tag: string) => onFilterTag?.(tag));
  if (!tags.length && !writable) return null;
  return (
    <View style={{ gap: space[1] }}>
      <View style={{ flexDirection: "row", alignItems: "flex-start", gap: space[2] }}>
        {/* Marks the row as tags next to the Status/Priority/Type buttons above it. */}
        <View accessibilityLabel={t("Tags")} style={{ height: touch ? 30 : 24, justifyContent: "center" }}>
          <Icon name="Tag" size={14} color={colors.foregroundMuted} />
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <TagEditor
        tags={tags}
        agentTags={agentTags}
        suggestions={suggestions}
        onAdd={add}
        onRemove={remove}
        onPressTag={onFilterTag ? filter : undefined}
        disabled={!writable}
        inert={!active}
          />
        </View>
      </View>
      {!!indexError ? <Button quiet onPress={retryIndex}>{t("Retry")}</Button> : !index && <Label muted>{t("Checking…")}</Label>}
      {!!error && <Notice>{error}</Notice>}
    </View>
  );
});
