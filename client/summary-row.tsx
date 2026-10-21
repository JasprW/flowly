import { memo } from "react";
import { View } from "react-native";
import type { PluginTimelineItemProps } from "@getpaseo/plugin/client";
import { modelLabel } from "../shared/summary";
import type { SummaryRowData } from "../shared/native-session";
import { CardFootnote, ContentCard } from "./content-card";
import { SummaryBody } from "./task-progress";
import { AiMark, Button, Label, Theme, font, relativeTime, space } from "./ui";
import { openCardFromRow } from "./native-chips";
import { SharedMotionProvider } from "./motion";
import { t } from "../shared/i18n";

/**
 * A summary version as a timeline row (NATIVE-SESSION-SPEC §5.3): the drawer's
 * Progress card under a "Progress" heading, in Paseo's own timeline only
 * (Flowly's session view leaves it out; the sidebar has Progress).
 */
export const SummaryRow = memo(function SummaryRow({ data, onOpenCard }: { data: SummaryRowData; onOpenCard?: () => void }) {
  return (
    <View testID="session-summary-row" style={{ gap: space[1.5] }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: space[1.5] }}>
        <AiMark />
        <Label muted medium size={font.sm} selectable={false}>
          {t("Progress")}
        </Label>
      </View>
      <ContentCard
        footer={
          <View style={{ flexDirection: "row", alignItems: "center", gap: space[2] }}>
            <CardFootnote>
              {t("Updated {time}", { time: relativeTime(data.at) })} · {modelLabel(data.model)}
            </CardFootnote>
            {onOpenCard && (
              <Button quiet small icon="PanelsTopLeft" onPress={onOpenCard}>
                {t("Open card")}
              </Button>
            )}
          </View>
        }
      >
        <SummaryBody entry={data} />
      </ContentCard>
    </View>
  );
});

/** The renderer Paseo calls for `flowly-summary` rows in its own timeline. */
export function NativeSummaryItem(props: PluginTimelineItemProps<SummaryRowData>) {
  const data = props.item.data;
  // A session Flowly does not manage has no card to open (NATIVE-SESSION-SPEC §12.4).
  const cardLink = data.taskId && data.workspaceId ? { taskId: data.taskId, workspaceId: data.workspaceId } : null;
  return (
    <Theme.Provider value={props.theme}>
      {/* Paseo renders this outside Flowly's tree: without it Show more / Show less would never animate. */}
      <SharedMotionProvider>
        <View style={{ paddingVertical: space[1] }}>
          <SummaryRow data={data} onOpenCard={cardLink ? () => openCardFromRow(cardLink, props.agentId) : undefined} />
        </View>
      </SharedMotionProvider>
    </Theme.Provider>
  );
}
