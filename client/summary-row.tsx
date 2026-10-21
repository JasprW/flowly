import { memo } from "react";
import { View } from "react-native";
import type { PluginTimelineItemProps } from "@getpaseo/plugin/client";
import { modelLabel } from "../shared/summary";
import type { SummaryRowData } from "../shared/native-session";
import { CardFootnote, ContentCard } from "./content-card";
import { SummaryBody } from "./task-progress";
import { Button, Theme, relativeTime, space } from "./ui";
import { NativeCardHeader } from "./native-card";
import { openCardFromRow } from "./native-chips";
import { SharedMotionProvider } from "./motion";
import { t } from "../shared/i18n";

/**
 * A summary version as a timeline row (NATIVE-SESSION-SPEC §5.3): the drawer's
 * Progress card with the shared native card header, in Paseo's own timeline only
 * (Flowly's session view leaves it out; the sidebar has Progress).
 */
export const SummaryRow = memo(function SummaryRow({ data, onOpenCard }: { data: SummaryRowData; onOpenCard?: () => void }) {
  return (
    <View testID="session-summary-row">
      <ContentCard
        header={
          <NativeCardHeader
            title={t("Progress")}
            trailing={
              onOpenCard ? (
                <Button quiet small icon="PanelsTopLeft" onPress={onOpenCard}>
                  {t("Open card")}
                </Button>
              ) : undefined
            }
          />
        }
        footer={
          <CardFootnote>
            {t("Updated {time}", { time: relativeTime(data.at) })} · {modelLabel(data.model)}
          </CardFootnote>
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
