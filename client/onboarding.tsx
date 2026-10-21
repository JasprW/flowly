import { useEffect, useRef, useState } from "react";
import { View } from "react-native";
import { Icon } from "@getpaseo/plugin/client/react-native";
import { useSettings } from "@getpaseo/plugin/client";
import type { PluginTheme } from "@getpaseo/plugin";
import { onboardingSettings, onboardingSettingsValues, type OnboardingSettings } from "../shared/settings";
import { FlowlyMark } from "./brand-icons";
import { Modal } from "./modal";
import { MotionReveal } from "./motion";
import { stepPage, tipIds, welcomePageCount, withTipSeen, type TipId } from "./onboarding-logic";
import { Badge, Button, Label, Theme, font, radius, space, tint, useTheme } from "./ui";
import { t } from "../shared/i18n";

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Host-scoped onboarding state with safe writes: a save against a stale
 * revision is merged into the latest values and retried, and a change shows at
 * once (optimistic) until the stored values agree.
 */
export function useOnboarding() {
  const settings = useSettings(onboardingSettings);
  const latest = useRef(settings);
  latest.current = settings;
  const stored = settings.status === "ready" ? onboardingSettingsValues(settings.values) : null;
  const [overlay, setOverlay] = useState<Partial<OnboardingSettings>>({});
  useEffect(() => {
    if (!stored) return;
    setOverlay((current) => {
      const left = Object.fromEntries(
        Object.entries(current).filter(([key, value]) => JSON.stringify(stored[key as keyof OnboardingSettings]) !== JSON.stringify(value)),
      );
      return Object.keys(left).length === Object.keys(current).length ? current : left;
    });
  }, [settings.status === "ready" ? settings.revision : ""]);
  const values: OnboardingSettings | null = stored ? { ...stored, ...overlay } : null;
  const valuesRef = useRef(values);
  valuesRef.current = values;

  async function update(change: (current: OnboardingSettings) => Partial<OnboardingSettings>) {
    if (valuesRef.current) {
      const patch = change(valuesRef.current);
      setOverlay((current) => ({ ...current, ...patch }));
    }
    for (let attempt = 0; attempt < 4; attempt++) {
      const current = latest.current;
      if (current.status !== "ready" || current.revision === undefined) {
        await wait(150);
        continue;
      }
      const base = onboardingSettingsValues(current.values);
      const next = { ...base, ...change(base) };
      if (JSON.stringify(next) === JSON.stringify(base)) return true;
      if (await current.save(next, current.revision)) return true;
      await current.reload();
      await wait(50 * (attempt + 1));
    }
    // Give up visibly rather than show a value that was not stored.
    setOverlay({});
    return false;
  }

  return {
    status: settings.status,
    values,
    markWelcomeSeen: () => update(() => ({ welcomeSeen: true })),
    /** Someone who already uses the board: no tour and no first-time tips. */
    markExistingUserSeen: () => update(() => ({ welcomeSeen: true, tipsSeen: [...tipIds] })),
    markTipSeen: (id: TipId) => update((current) => ({ tipsSeen: withTipSeen(current.tipsSeen, id) })),
    /** Show every one-time tip again. The welcome tour is reopened by hand; resetting it would only make the board re-mark existing users. */
    resetTips: () => update(() => ({ tipsSeen: [] })),
  };
}

/** The three Kanban objects and the Paseo object each one is (page 1 and the empty-board strip). */
const objects = [
  { icon: "Folder", name: () => t("Project"), paseo: () => t("Paseo project"), note: () => t("One board is one folder. Put several repos under one folder, or let Flowly link them for you.") },
  { icon: "SquarePlus", name: () => t("Card"), paseo: () => t("Paseo workspace"), note: () => t("One task is one workspace (a worktree or a directory). Two cards never share a workspace.") },
  { icon: "MessagesSquare", name: () => t("Session"), paseo: () => t("Paseo agent session"), note: () => t("One conversation with an agent inside the card's workspace. A card can have many; you choose who gets your next message.") },
] as const;

function Step({ n }: { n: number }) {
  const { colors } = useTheme();
  return (
    <View
      style={{
        width: 24,
        height: 24,
        borderRadius: radius.full,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: tint(colors.accent, 0.14),
      }}
    >
      <Label bold size={font.sm} color={colors.accent} selectable={false}>{String(n)}</Label>
    </View>
  );
}

function IconTile({ name, color }: { name: string; color?: string }) {
  const { colors } = useTheme();
  const c = color || colors.accent;
  return (
    <View
      style={{
        width: 32,
        height: 32,
        borderRadius: radius.lg,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: tint(c, 0.12),
      }}
    >
      <Icon name={name} size={17} color={c} />
    </View>
  );
}

function PageTitle({ title, detail }: { title: string; detail?: string }) {
  return (
    <View style={{ gap: space[1] }}>
      <Label bold size={font.lg} selectable={false}>{title}</Label>
      {!!detail && <Label muted size={font.md}>{detail}</Label>}
    </View>
  );
}

function MapPage() {
  const { colors } = useTheme();
  return (
    <View style={{ gap: space[3] }}>
      <PageTitle
        title={t("How Flowly maps to Paseo")}
        detail={t("Three things to know. Each one is a real Paseo object, so you can always open it in Paseo.")}
      />
      <View style={{ gap: space[1] }}>
        {objects.map((item, index) => (
          <View key={item.icon} style={{ gap: space[1] }}>
            {index > 0 && (
              <View style={{ paddingLeft: 8 }}>
                <Icon name="ArrowDown" size={14} color={colors.foregroundMuted} />
              </View>
            )}
            <View
              style={{
                flexDirection: "row",
                gap: space[3],
                padding: space[3],
                borderRadius: radius.lg,
                borderWidth: 1,
                borderColor: colors.border,
                backgroundColor: colors.surface1,
              }}
            >
              <IconTile name={item.icon} />
              <View style={{ flex: 1, minWidth: 0, gap: space[1] }}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: space[2], flexWrap: "wrap" }}>
                  <Label bold size={font.base} selectable={false}>{item.name()}</Label>
                  <Badge>{item.paseo()}</Badge>
                </View>
                <Label muted size={font.md}>{item.note()}</Label>
              </View>
            </View>
          </View>
        ))}
      </View>
      <Label muted size={font.md}>
        {t("A card's status and its sessions' status are separate. A finished turn never completes a card; only you mark it Done.")}
      </Label>
    </View>
  );
}

function LoopPage() {
  const steps = [
    t("Create a project from a folder."),
    t("Add a task and start an agent with it. The card gets its own workspace."),
    t("Watch the card move Design → Development → Test → In review by itself."),
    t("When an agent needs you, the card says Needs you. Reply from the card."),
    t("Review the result, then move the card to Done yourself."),
  ];
  return (
    <View style={{ gap: space[3] }}>
      <PageTitle title={t("Hand out work, make the calls, review")} detail={t("The basic loop, from folder to Done.")} />
      <View style={{ gap: space[3] }}>
        {steps.map((text, index) => (
          <View key={text} style={{ flexDirection: "row", gap: space[3], alignItems: "flex-start" }}>
            <Step n={index + 1} />
            <View style={{ flex: 1, minWidth: 0, paddingTop: 2 }}>
              <Label size={font.base}>{text}</Label>
            </View>
          </View>
        ))}
      </View>
    </View>
  );
}

function FeaturesPage() {
  const { colors } = useTheme();
  const features = [
    { icon: "Activity", color: colors.accent, title: t("Automatic status"), text: t("Cards follow the agent's work through the lanes. Done stays yours.") },
    { icon: "Bell", color: colors.statusWarning, title: t("Needs-you reminders"), text: t("Questions, approvals and errors light up the card, the Attention menu and the sidebar badge. Answer questions and approvals right on the card or in the session.") },
    { icon: "Brain", color: colors.accent, title: t("Run summaries"), text: t("After every turn a cheap model keeps the card's state, recap and next step up to date.") },
    { icon: "Sparkles", color: colors.accent, title: t("Suggested next steps"), text: t("When a turn ends, the agent's next steps sit above the message box. Tap one to fill it in, then send it yourself. Once the work is pushed, it can offer Move to Done.") },
    { icon: "ListChecks", color: colors.statusSuccess, title: t("Workpad"), text: t("Agents set the card's type and tags and write a workpad before they start: acceptance criteria, checks marked passed, failed or not run on a named commit, and what confused them. Delivering without them needs a note.") },
    { icon: "Lightbulb", color: colors.statusSuccess, title: t("Follow-up ideas"), text: t("Work an agent finds along the way lands in the Ideas inbox. Good idea or Dismiss.") },
    { icon: "Package", color: colors.accent, title: t("Inputs and outputs"), text: t("Each card lists the files and links it worked from and delivered, added by agents or by you.") },
    { icon: "Ticket", color: colors.accent, title: t("Tickets, docs and PRs as inputs"), text: t("Start a card from a Jira ticket, Confluence page, or GitHub/GitLab issue or pull request, or add one with the Artifacts +. Agents read it every turn; Flowly never changes it.") },
    { icon: "Tags", color: colors.accent, title: t("Tags"), text: t("Tag cards by module or direction. Agents tag their own cards too; filter and search by #tag.") },
    { icon: "CircleGauge", color: colors.accent, title: t("Project insights"), text: t("Today's cards, turns, agent time, commits, tokens and what is waiting on you.") },
    { icon: "Workflow", color: colors.accent, title: t("Workflow insights"), text: t("Optional: on a schedule you choose, a model reads the commands agents ran and suggests scripts, tools and rules worth keeping.") },
    { icon: "FolderGit2", color: colors.statusSuccess, title: t("Saved with your project"), text: t("Each project's board is also kept in its folder (.flowly, ignored by git). Add the folder again to restore it.") },
  ];
  return (
    <View style={{ gap: space[3] }}>
      <PageTitle title={t("What makes it different")} detail={t("Anything marked with the sparkle was written or suggested by AI.")} />
      <View style={{ gap: space[3] }}>
        {features.map((item) => (
          <View key={item.icon} style={{ flexDirection: "row", gap: space[3], alignItems: "flex-start" }}>
            <IconTile name={item.icon} color={item.color} />
            <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
              <Label bold size={font.base} selectable={false}>{item.title}</Label>
              <Label muted size={font.md}>{item.text}</Label>
            </View>
          </View>
        ))}
      </View>
    </View>
  );
}

function StartPage({ canCreate }: { canCreate: boolean }) {
  const { colors } = useTheme();
  return (
    <View style={{ gap: space[3], alignItems: "center", paddingVertical: space[4] }}>
      <IconTile name="PanelsTopLeft" />
      <Label bold size={font.lg} selectable={false}>{t("Ready when you are")}</Label>
      <Label muted size={font.md}>
        {canCreate
          ? t("Pick a folder to make your first project. Nothing is created until you confirm.")
          : t("Add a task to any project to get started.")}
      </Label>
      <View style={{ flexDirection: "row", gap: space[1], alignItems: "center" }}>
        <Icon name="CircleHelp" size={13} color={colors.foregroundMuted} />
        <Label muted size={font.sm}>{t("You can reopen this tour from Settings or the Command Center.")}</Label>
      </View>
    </View>
  );
}

function Dots({ page }: { page: number }) {
  const { colors } = useTheme();
  return (
    <View style={{ flexDirection: "row", gap: space[1.5], alignItems: "center" }} accessibilityLabel={t("Step {n} of {total}", { n: page + 1, total: welcomePageCount })}>
      {Array.from({ length: welcomePageCount }, (_, i) => (
        <View
          key={i}
          style={{
            width: i === page ? 16 : 6,
            height: 6,
            borderRadius: 3,
            backgroundColor: i === page ? colors.accent : colors.border,
          }}
        />
      ))}
    </View>
  );
}

/**
 * First-run welcome tour: four short pages. Closing it any way (Skip, Esc,
 * finishing) calls `onClose`; `onCreate` runs after the final primary button.
 * The tour itself never creates a Paseo or board resource.
 */
export function WelcomeTour({
  open,
  theme,
  canCreate,
  onClose,
  onCreate,
}: {
  open: boolean;
  theme: PluginTheme;
  /** There is no project yet: the last page offers Create project. */
  canCreate: boolean;
  onClose(): void;
  onCreate(): void;
}) {
  const [page, setPage] = useState(0);
  const [direction, setDirection] = useState<1 | -1>(1);
  useEffect(() => {
    if (open) {
      setPage(0);
      setDirection(1);
    }
  }, [open]);
  const last = page === welcomePageCount - 1;
  const go = (step: 1 | -1) => {
    setDirection(step);
    setPage((current) => stepPage(current, step));
  };
  return (
    <Modal
      open={open}
      title={t("Welcome to Flowly")}
      icon={<FlowlyMark surface={theme.colors.surface0} />}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <Modal.Content contentContainerStyle={{ padding: space[4], gap: space[4] }}>
        <Theme.Provider value={theme}>
          <MotionReveal transitionKey={String(page)} direction={direction} distance={14}>
            {page === 0 ? <MapPage /> : page === 1 ? <LoopPage /> : page === 2 ? <FeaturesPage /> : <StartPage canCreate={canCreate} />}
          </MotionReveal>
          <View style={{ flexDirection: "row", alignItems: "center", gap: space[2] }}>
            <Dots page={page} />
            <View style={{ flex: 1 }} />
            {!last && (
              <Button quiet onPress={onClose}>
                {t("Skip")}
              </Button>
            )}
            {page > 0 && (
              <Button onPress={() => go(-1)}>
                {t("Back")}
              </Button>
            )}
            {last ? (
              <>
                {canCreate && <Button onPress={onClose}>{t("Not now")}</Button>}
                <Button
                  primary
                  icon={canCreate ? "Plus" : undefined}
                  onPress={canCreate ? onCreate : onClose}
                >
                  {canCreate ? t("Create project") : t("Done")}
                </Button>
              </>
            ) : (
              <Button primary onPress={() => go(1)}>
                {t("Next")}
              </Button>
            )}
          </View>
        </Theme.Provider>
      </Modal.Content>
    </Modal>
  );
}

/** Project → Card → Session, shown on the empty board so the map is never a dead end. */
export function ConceptStrip({ onTour }: { onTour(): void }) {
  const { colors } = useTheme();
  return (
    <View style={{ gap: space[2], alignItems: "center" }}>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space[1.5], alignItems: "center", justifyContent: "center" }}>
        {objects.map((item, index) => (
          <View key={item.icon} style={{ flexDirection: "row", alignItems: "center", gap: space[1.5] }}>
            {index > 0 && <Icon name="ChevronRight" size={14} color={colors.foregroundMuted} />}
            <View
              style={{
                flexDirection: "row",
                alignItems: "center",
                gap: space[1.5],
                paddingHorizontal: space[2],
                height: 28,
                borderRadius: radius.md,
                borderWidth: 1,
                borderColor: colors.border,
                backgroundColor: colors.surface1,
              }}
            >
              <Icon name={item.icon} size={13} color={colors.foregroundMuted} />
              <Label size={font.sm} selectable={false}>{item.name()}</Label>
            </View>
          </View>
        ))}
      </View>
      <Label muted size={font.sm}>{t("A project is a Paseo project, a card is a workspace, a session is an agent session.")}</Label>
      <Button quiet icon="CircleHelp" onPress={onTour}>
        {t("Take the tour")}
      </Button>
    </View>
  );
}

/** One quiet row above the board: a one-time tip (dismissible) or the empty-project hint (action, no dismiss). */
export function GuideBanner({
  text,
  actionLabel,
  onAction,
  dismissLabel,
  onDismiss,
}: {
  text: string;
  actionLabel?: string;
  onAction?(): void;
  dismissLabel?: string;
  onDismiss?(): void;
}) {
  const { colors } = useTheme();
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        flexWrap: "wrap",
        gap: space[2],
        marginHorizontal: space[3],
        marginTop: space[2],
        paddingHorizontal: space[3],
        paddingVertical: space[2],
        borderWidth: 1,
        borderColor: tint(colors.accent, 0.35),
        backgroundColor: tint(colors.accent, 0.08),
        borderRadius: radius.lg,
      }}
    >
      <Icon name="Lightbulb" size={14} color={colors.accent} />
      <View style={{ flex: 1, minWidth: 160 }}>
        <Label size={font.md}>{text}</Label>
      </View>
      {!!actionLabel && onAction && (
        <Button small primary onPress={onAction}>
          {actionLabel}
        </Button>
      )}
      {!!dismissLabel && onDismiss && (
        <Button small quiet onPress={onDismiss}>
          {dismissLabel}
        </Button>
      )}
    </View>
  );
}
