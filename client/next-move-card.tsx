import { memo, useState } from "react";
import { Pressable, View } from "react-native";
import { copyText, Icon, useToast } from "@getpaseo/plugin/client/react-native";
import type { PluginTimelineItemProps } from "@getpaseo/plugin/client";
import type { NextMove } from "../shared/model";
import type { NextRowData } from "../shared/native-session";
import { cardView, chipClient, refreshChipsNow, setWrapPending, useChipState, useWrapPending, type ChipState } from "./native-chips";
import { hideMoves } from "./hidden-moves";
import { moveToDone, wrapupNeed } from "./native-actions";
import { fillComposer } from "./web-composer";
import { WrapupQuestion } from "./native-popovers";
import { SharedMotionProvider } from "./motion";
import {
  AiMark,
  IconButton,
  Label,
  Notice,
  Theme,
  font,
  message,
  noFocusRing,
  radius,
  space,
  tint,
  touch,
  useTheme,
} from "./ui";
import { t } from "../shared/i18n";

/**
 * The session's suggested next steps as a card under the agent's last reply in Paseo's own timeline
 * (NATIVE-SESSION-SPEC §6). Shown only while its suggestion set is current (the chip refresh's `chipMoves`); a
 * message move fills this session's message box (or copies it, per the setting or where filling is impossible),
 * nothing is sent; Move to Done moves the card and may ask to wrap up.
 */
export function NativeNextMovesItem(
  props: PluginTimelineItemProps<NextRowData>,
) {
  const { data } = props.item;
  const state = useChipState(props.agentId);
  const eventId = data.status === "ready" ? data.eventId : "";
  const wrap = useWrapPending(props.agentId, eventId);
  const view = cardView(data, state, props.agentId);
  if (view === "hidden" || data.status !== "ready") return null;
  return (
    <Theme.Provider value={props.theme}>
      <SharedMotionProvider>
        <View style={{ paddingVertical: space[1] }}>
          {view === "wrap" && wrap ? (
            // Kept after Move to Done ended this suggestion set (NATIVE-SESSION-SPEC §6.4).
            <Frame>
              <WrapupQuestion
                state={wrap.state}
                close={() => setWrapPending(props.agentId, eventId, null)}
                needsFlowly={wrap.need === "needs-flowly"}
              />
            </Frame>
          ) : state?.moves ? (
            <NextMovesCard state={state} eventId={eventId} moves={state.moves.moves} />
          ) : null}
        </View>
      </SharedMotionProvider>
    </Theme.Provider>
  );
}

const NextMovesCard = memo(function NextMovesCard({
  state,
  eventId,
  moves,
}: {
  state: ChipState;
  eventId: string;
  moves: readonly NextMove[];
}) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const client = chipClient();
  const pick = (move: NextMove) => {
    setError("");
    if (move.moveTo === "done") {
      if (!client) return;
      setBusy(true);
      void (async () => {
        await moveToDone(client, {
          taskId: state.task.id,
          agentId: state.agentId,
          eventId,
        });
        toast.show(t("Moved to Done"), { variant: "success" });
        // Ask before the chips refresh: the card would hide once its suggestion set ends. Auto wrap up (read fresh)
        // asks nothing, as a move to Done on the board (MULTITASK-SPEC).
        const need = await wrapupNeed(client, { taskId: state.task.id }).catch(() => "none" as const);
        if (need !== "none") setWrapPending(state.agentId, eventId, { need, state });
        refreshChipsNow();
      })()
        .catch((e) => setError(message(e)))
        .finally(() => setBusy(false));
      return;
    }
    if (!move.prompt) return;
    if (
      state.nextMoveTap === "fill" &&
      fillComposer(state.agentId, move.prompt)
    )
      return;
    void copyText(move.prompt)
      .then(() =>
        toast.show(
          state.nextMoveTap === "fill"
            ? t("Copied. Paste it into the message box.")
            : t("Copied"),
          { variant: "success" },
        ),
      )
      .catch((e) => setError(message(e)));
  };
  const height = touch ? 32 : 26;
  return (
    <Frame
      header={
        <IconButton
          icon="X"
          size={height}
          label={t("Hide suggestions")}
          onPress={() => hideMoves(eventId)}
        />
      }
    >
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space[1.5] }}>
        {moves.map((move, index) => (
          <MoveChip
            key={`${index}:${move.label}`}
            move={move}
            first={index === 0}
            height={height}
            disabled={busy}
            fill={state.nextMoveTap === "fill"}
            onPress={() => pick(move)}
          />
        ))}
      </View>
      {!!error && <Notice tone="danger">{error}</Notice>}
    </Frame>
  );
});

function MoveChip(p: {
  move: NextMove;
  first: boolean;
  height: number;
  disabled: boolean;
  fill: boolean;
  onPress(): void;
}) {
  const { colors } = useTheme();
  const action = !!p.move.moveTo;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={t("Suggested next step: {label}", {
        label: p.move.label,
      })}
      accessibilityHint={
        action
          ? t("Moves this card to Done.")
          : p.fill
            ? t("Fills the message box. Nothing is sent until you send it.")
            : t("Copies the message so you can paste it into the message box.")
      }
      accessibilityState={{ disabled: p.disabled }}
      disabled={p.disabled}
      onPress={p.onPress}
      style={(s) => {
        const { pressed, hovered, focused } = s as typeof s & {
          hovered?: boolean;
          focused?: boolean;
        };
        return {
          ...noFocusRing,
          minHeight: p.height,
          maxWidth: "100%",
          flexDirection: "row",
          alignItems: "center",
          paddingHorizontal: space[2] + 2,
          borderRadius: p.height / 2,
          borderWidth: 1,
          borderColor: action
            ? tint(colors.statusSuccess, 0.55)
            : p.first
              ? tint(colors.accent, 0.5)
              : colors.border,
          backgroundColor:
            pressed || hovered || focused
              ? colors.surface2
              : p.first
                ? tint(colors.accent, 0.08)
                : colors.surface0,
          opacity: p.disabled ? 0.45 : 1,
        };
      }}
    >
      {action && (
        <View style={{ marginRight: space[1] }}>
          <Icon name="Check" size={13} color={colors.statusSuccess} />
        </View>
      )}
      <Label size={font.sm} medium lines={1} selectable={false}>
        {p.move.label}
      </Label>
    </Pressable>
  );
}

function Frame({
  header,
  children,
}: {
  header?: React.ReactNode;
  children: React.ReactNode;
}) {
  const { colors } = useTheme();
  return (
    <View
      testID="session-next-moves-card"
      style={{
        borderRadius: radius.lg,
        borderWidth: 1,
        borderColor: colors.border,
        backgroundColor: colors.surface1,
        padding: space[2] + 2,
        gap: space[2],
      }}
    >
      <View
        style={{ flexDirection: "row", alignItems: "center", gap: space[1.5] }}
      >
        <AiMark />
        <View style={{ flex: 1, minWidth: 0 }}>
          <Label muted medium size={font.sm} selectable={false}>
            {t("Suggested next steps")}
          </Label>
        </View>
        {header}
      </View>
      {children}
    </View>
  );
}
