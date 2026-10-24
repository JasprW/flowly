import { useEffect, useState } from "react";
import { View } from "react-native";
import { Icon } from "@getpaseo/plugin/client/react-native";
import type { PluginTheme } from "@getpaseo/plugin";
import { FlowlyMark } from "./brand-icons";
import { Modal } from "./modal";
import { Button, Label, Theme, font, radius, space, tint, useTheme } from "./ui";
import { stepRelease, versionLabel, type WhatsNewItem, type WhatsNewRelease } from "./whats-new";
import { t } from "../shared/i18n";

function Row({ item, onAction }: { item: WhatsNewItem; onAction(action: NonNullable<WhatsNewItem["action"]>): void }) {
  const { colors } = useTheme();
  const action = item.action;
  return (
    <View style={{ flexDirection: "row", alignItems: "flex-start", gap: space[3] }}>
      <View style={{ width: 28, height: 28, borderRadius: radius.lg, alignItems: "center", justifyContent: "center", backgroundColor: tint(colors.accent, 0.12) }}>
        <Icon name={item.icon} size={15} color={colors.accent} />
      </View>
      <View style={{ flex: 1, minWidth: 0, gap: space[1.5], alignItems: "flex-start" }}>
        <Label size={font.md}>{t(item.text)}</Label>
        {action && (
          <Button small onPress={() => onAction(action)}>
            {t(action.label)}
          </Button>
        )}
      </View>
    </View>
  );
}

/**
 * What's new after an update (WHATS-NEW-SPEC §5): one release per page, newest first, one sentence
 * per change with an optional button; Older / Newer page through the earlier releases. Closing it
 * any way, or pressing a button, calls `onClose` first; the board runs the button's action once
 * this modal has gone.
 */
export function WhatsNewWindow({
  open,
  theme,
  releases,
  onClose,
  onAction,
}: {
  open: boolean;
  theme: PluginTheme;
  /** Newest first; opens on the first. */
  releases: WhatsNewRelease[];
  onClose(): void;
  onAction(action: NonNullable<WhatsNewItem["action"]>): void;
}) {
  const [page, setPage] = useState(0);
  // Every open starts on the newest release.
  useEffect(() => {
    if (open) setPage(0);
  }, [open]);
  const release = releases[Math.min(page, releases.length - 1)];
  if (!release) return null;
  const older = page < releases.length - 1;
  const newer = page > 0;
  return (
    <Modal
      open={open}
      title={t("What's new")}
      icon={<FlowlyMark surface={theme.colors.surface0} />}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <Modal.Content contentContainerStyle={{ gap: space[4] }}>
        <Theme.Provider value={theme}>
          <Label muted size={font.sm}>{t("Flowly {version}", { version: versionLabel(release.version) })}</Label>
          {release.items.map((item) => (
            <Row key={`${release.version}:${item.text}`} item={item} onAction={onAction} />
          ))}
          <View style={{ flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: space[2] }}>
            {newer && (
              <Button quiet icon="ChevronLeft" onPress={() => setPage((p) => stepRelease(p, -1, releases.length))}>
                {t("Flowly {version}", { version: versionLabel(releases[page - 1].version) })}
              </Button>
            )}
            {older && (
              <Button quiet icon="Clock" onPress={() => setPage((p) => stepRelease(p, 1, releases.length))}>
                {t("Flowly {version}", { version: versionLabel(releases[page + 1].version) })}
              </Button>
            )}
            <View style={{ flex: 1 }} />
            <Button primary onPress={onClose}>
              {t("Got it")}
            </Button>
          </View>
        </Theme.Provider>
      </Modal.Content>
    </Modal>
  );
}
