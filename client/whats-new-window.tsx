import { useEffect, useRef, useState } from "react";
import { View } from "react-native";
import { Icon } from "@getpaseo/plugin/client/react-native";
import type { PluginTheme } from "@getpaseo/plugin";
import { FlowlyMark } from "./brand-icons";
import { Modal } from "./modal";
import { Enter } from "./motion";
import { Button, IconButton, Label, Theme, font, radius, space, tint, useTheme } from "./ui";
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
 * per change with an optional button. The arrows beside the version page left to older releases and
 * right to newer ones; the page slides in from that side. Closing it any way, or pressing a button,
 * calls `onClose` first; the board runs the button's action once this modal has gone.
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
  // Only a page turn slides; the first page arrives with the modal.
  const [paged, setPaged] = useState(false);
  const turn = (direction: 1 | -1) => {
    setPaged(true);
    setPage((p) => stepRelease(p, direction, releases.length));
  };
  // The page before the change: an older release slides in from the left, a newer one from the right.
  const shown = useRef(0);
  const from = page > shown.current ? -PAGE_SLIDE : PAGE_SLIDE;
  useEffect(() => {
    shown.current = page;
  }, [page]);
  // Every open starts on the newest release.
  useEffect(() => {
    if (!open) return;
    setPage(0);
    setPaged(false);
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
          {releases.length > 1 ? (
            <View style={{ flexDirection: "row", alignItems: "center", gap: space[1], marginVertical: -space[1] }}>
              <IconButton icon="ChevronLeft" label={t("Older release")} disabled={!older} onPress={() => turn(1)} />
              <Label muted size={font.sm} selectable={false}>
                {t("Flowly {version}", { version: versionLabel(release.version) })}
              </Label>
              <IconButton icon="ChevronRight" label={t("Newer release")} disabled={!newer} onPress={() => turn(-1)} />
            </View>
          ) : (
            <Label muted size={font.sm}>{t("Flowly {version}", { version: versionLabel(release.version) })}</Label>
          )}
          <Enter key={release.version} axis="x" distance={paged ? from : 0} style={{ gap: space[4] }}>
            {release.items.map((item) => (
              <Row key={`${release.version}:${item.text}`} item={item} onAction={onAction} />
            ))}
          </Enter>
          <View style={{ flexDirection: "row", alignItems: "center" }}>
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

/** How far a release's items slide in when the page changes (as the Insights day panel). */
const PAGE_SLIDE = 16;
