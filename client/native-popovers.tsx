import { useState } from "react";
import { Pressable, ScrollView, View } from "react-native";
import { Icon, useToast } from "@getpaseo/plugin/client/react-native";
import type { PluginButtonContentProps } from "@getpaseo/plugin/client";
import type { Idea } from "../shared/model";
import { chipClient, refreshChipsNow, useChipState, type ChipState } from "./native-chips";
import { continueIdea, dismissIdea, newCardFromIdea, openCard, wrapupNow } from "./native-actions";
import { CardField } from "./content-card";
import { SharedMotionProvider } from "./motion";
import { AiMark, Button, Label, Notice, Theme, font, message, noFocusRing, radius, space, useTheme, verticalScroll } from "./ui";
import { t } from "../shared/i18n";

/**
 * The Ideas chip's popover in Paseo's session view (NATIVE-SESSION-SPEC §7.3), and the wrap-up question the Next
 * moves card shows after Move to Done (§6.4). They read the chip store, which the chip refresh fills, and act through
 * the plugin context that registered the chips.
 */
function agentOf(props: PluginButtonContentProps) {
  return props.context === "agent" ? props.agentId : "";
}

function Frame({ props, title, children }: { props: PluginButtonContentProps; title: string; children: React.ReactNode }) {
  return (
    <Theme.Provider value={props.theme}>
      <SharedMotionProvider>
        <Body title={title}>{children}</Body>
      </SharedMotionProvider>
    </Theme.Provider>
  );
}
function Body({ title, children }: { title: string; children: React.ReactNode }) {
  const { colors } = useTheme();
  return (
    <View style={{ width: "100%", maxWidth: 420, maxHeight: 520, backgroundColor: colors.surface0 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: space[1.5], paddingHorizontal: space[3], paddingTop: space[3], paddingBottom: space[2] }}>
        <AiMark />
        <Label medium size={font.md} selectable={false}>
          {title}
        </Label>
      </View>
      <ScrollView {...verticalScroll} keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingHorizontal: space[3], paddingBottom: space[3], gap: space[2] }}>
        {children}
      </ScrollView>
    </View>
  );
}

/** After Move to Done (MULTITASK-SPEC): wrap up now, or leave it to Flowly's dialog when something needs confirming. */
export function WrapupQuestion({ state, close, needsFlowly: initial }: { state: ChipState; close(): void; needsFlowly: boolean }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [needsFlowly, setNeedsFlowly] = useState(initial);
  const client = chipClient();
  const open = () => {
    if (client) openCard(client, { taskId: state.task.id, workspaceId: state.task.workspaceId, agentId: state.agentId });
    close();
  };
  return (
    <>
      <Label medium size={font.md}>{t("Wrap up this card?")}</Label>
      <Label muted size={font.sm}>
        {needsFlowly
          ? t("This card has something to confirm first. Open it in Flowly to wrap it up.")
          : t("Archives this card's sessions and its own workspace. The card stays on the board.")}
      </Label>
      {!!error && <Notice tone="danger">{error}</Notice>}
      <View style={{ flexDirection: "row", gap: space[2], justifyContent: "flex-end", flexWrap: "wrap" }}>
        <Button quiet disabled={busy} onPress={close}>
          {t("Not now")}
        </Button>
        <Button quiet disabled={busy} onPress={open}>
          {t("Open in Flowly")}
        </Button>
        {!needsFlowly && (
          <Button
            primary
            disabled={busy || !client}
            onPress={() => {
              if (!client) return;
              setBusy(true);
              setError("");
              void wrapupNow(client, { taskId: state.task.id })
                .then((result) => {
                  if (result === "needs-flowly") return setNeedsFlowly(true);
                  toast.show(t("Wrapped up"), { variant: "success" });
                  close();
                })
                .catch((e) => setError(message(e)))
                .finally(() => setBusy(false));
            }}
          >
            {t("Wrap up")}
          </Button>
        )}
      </View>
    </>
  );
}

/** Ideas: the card's open ideas, with Continue here / Start a new task / Dismiss (IDEAS-SPEC actions). */
export function IdeasPopover(props: PluginButtonContentProps) {
  return (
    <Frame props={props} title={t("Ideas for this card")}>
      <IdeasBody agentId={agentOf(props)} close={props.close} />
    </Frame>
  );
}

function IdeasBody({ agentId, close }: { agentId: string; close(): void }) {
  const state = useChipState(agentId);
  const [open, setOpen] = useState("");
  if (!state?.ideas.length) return <Label muted size={font.sm}>{t("No open ideas.")}</Label>;
  const finished = state.task.status === "done" || state.task.status === "cancelled";
  return (
    <>
      {state.ideas.map((idea) => (
        <IdeaItem
          key={idea.id}
          idea={idea}
          agentId={agentId}
          canContinue={!finished}
          expanded={open === idea.id}
          onToggle={() => setOpen(open === idea.id ? "" : idea.id)}
          close={close}
        />
      ))}
    </>
  );
}

function IdeaItem({ idea, agentId, canContinue, expanded, onToggle, close }: { idea: Idea; agentId: string; canContinue: boolean; expanded: boolean; onToggle(): void; close(): void }) {
  const { colors } = useTheme();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [confirm, setConfirm] = useState(false);
  const client = chipClient();
  const act = (work: () => Promise<unknown>, done: string) => {
    if (!client) return;
    setBusy(true);
    setError("");
    void work()
      .then(() => {
        toast.show(done, { variant: "success" });
        refreshChipsNow();
        close();
      })
      .catch((e) => setError(message(e)))
      .finally(() => setBusy(false));
  };
  return (
    <View style={{ borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface1, padding: space[2], gap: space[2] }}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded }}
        accessibilityLabel={idea.title}
        onPress={onToggle}
        style={{ ...noFocusRing, flexDirection: "row", alignItems: "flex-start", gap: space[1.5] }}
      >
        <Icon name={expanded ? "ChevronDown" : "ChevronRight"} size={14} color={colors.foregroundMuted} />
        <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
          <Label medium size={font.md} selectable={false}>
            {idea.title}
          </Label>
          <Label muted size={font.xs} selectable={false}>
            {idea.scope === "here" ? t("Continues this task") : t("New task")}
          </Label>
        </View>
      </Pressable>
      {expanded && (
        <View style={{ gap: space[2] }}>
          {!!idea.detail && <CardField title={t("What to do")} text={idea.detail} />}
          {!!idea.rationale && <CardField title={t("Why")} text={idea.rationale} />}
        </View>
      )}
      {confirm && <Label muted size={font.sm}>{t("Sends this idea to this session.")}</Label>}
      {!!error && <Notice tone="danger">{error}</Notice>}
      <View style={{ flexDirection: "row", gap: space[2], flexWrap: "wrap", justifyContent: "flex-end" }}>
        <Button small quiet disabled={busy} label={t("Dismiss {title}", { title: idea.title })} onPress={() => act(() => dismissIdea(client!, { ideaId: idea.id }), t("Idea dismissed"))}>
          {t("Dismiss")}
        </Button>
        <Button
          small
          quiet
          icon="SquarePlus"
          disabled={busy || !client}
          onPress={() => {
            if (!client) return;
            newCardFromIdea(client, { ideaId: idea.id });
            close();
          }}
        >
          {t("Start a new task")}
        </Button>
        {canContinue &&
          (confirm ? (
            <Button small primary icon="CornerDownRight" disabled={busy} onPress={() => act(() => continueIdea(client!, { ideaId: idea.id, agentId }), t("Idea sent"))}>
              {t("Send")}
            </Button>
          ) : (
            <Button small icon="CornerDownRight" disabled={busy} onPress={() => setConfirm(true)}>
              {t("Continue here")}
            </Button>
          ))}
      </View>
    </View>
  );
}
