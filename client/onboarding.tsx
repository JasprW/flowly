import { useEffect, useRef, useState } from "react";
import { View } from "react-native";
import { Icon } from "@getpaseo/plugin/client/react-native";
import { useSettings } from "@getpaseo/plugin/client";
import type { PluginTheme } from "@getpaseo/plugin";
import { onboardingSettings, onboardingSettingsValues, type OnboardingSettings } from "../shared/settings";
import { FlowlyMark } from "./brand-icons";
import { Modal } from "./modal";
import { Disclosure } from "./disclosure";
import { MotionReveal } from "./motion";
import { stepPage, tipIds, welcomePageCount, withTipSeen, type TipId } from "./onboarding-logic";
import { Button, Label, Theme, font, radius, space, tint, useTheme } from "./ui";
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
  { icon: "Folder", name: () => t("Project"), paseo: () => t("Paseo project"), note: () => t("One folder") },
  { icon: "SquarePlus", name: () => t("Card"), paseo: () => t("Paseo workspace"), note: () => t("One task") },
  { icon: "MessagesSquare", name: () => t("Session"), paseo: () => t("Paseo agent session"), note: () => t("A chat with an agent") },
] as const;

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

/** Small caps-like heading that splits page 1 into its two parts. */
function Eyebrow({ children }: { children: string }) {
  return <Label bold muted size={font.sm} selectable={false}>{children}</Label>;
}

/** Who does a step: you (accent) or the agent (neutral). */
function RoleBadge({ agent }: { agent: boolean }) {
  const { colors } = useTheme();
  const c = agent ? colors.foregroundMuted : colors.accent;
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 4,
        width: 72,
        height: 22,
        paddingHorizontal: space[1.5],
        borderRadius: radius.full,
        backgroundColor: tint(c, 0.14),
      }}
    >
      <Icon name={agent ? "Bot" : "User"} size={12} color={c} />
      <Label bold size={font.sm} color={c} selectable={false}>{agent ? t("Agent") : t("You")}</Label>
    </View>
  );
}

/** Todo → … → Done: the middle lanes are moved by the agent, the ends are yours. */
function LaneStrip() {
  const { colors } = useTheme();
  const lanes = [
    { name: t("Todo"), agent: false },
    { name: t("Design"), agent: true },
    { name: t("Development"), agent: true },
    { name: t("Test"), agent: true },
    { name: t("In review"), agent: true },
    { name: t("Done"), agent: false },
  ];
  return (
    <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", rowGap: space[1.5], columnGap: 4 }}>
      {lanes.map((lane, index) => (
        <View key={lane.name} style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
          {index > 0 && <Icon name="ChevronRight" size={12} color={colors.foregroundMuted} />}
          <View
            style={{
              height: 24,
              justifyContent: "center",
              paddingHorizontal: space[2],
              borderRadius: radius.md,
              borderWidth: 1,
              borderColor: lane.agent ? colors.border : tint(colors.accent, 0.45),
              backgroundColor: lane.agent ? colors.surface1 : tint(colors.accent, 0.1),
            }}
          >
            <Label size={font.sm} color={lane.agent ? undefined : colors.accent} selectable={false}>{lane.name}</Label>
          </View>
        </View>
      ))}
    </View>
  );
}

function HowPage() {
  const { colors } = useTheme();
  const steps = [
    { agent: false, text: t("Make a project from a folder, add a task and start an agent.") },
    { agent: true, text: t("Moves the card through the lanes. When it needs you, the card says Needs you.") },
    { agent: false, text: t("Review the result and move the card to Done.") },
  ];
  return (
    <View style={{ gap: space[4] }}>
      <PageTitle
        title={t("How Flowly works")}
        detail={t("Everything on the board is a real Paseo object, so you can always open it in Paseo.")}
      />
      <View style={{ gap: space[2] }}>
        <Eyebrow>{t("Three things")}</Eyebrow>
        <View style={{ flexDirection: "row", alignItems: "stretch", gap: space[1] }}>
          {objects.map((item, index) => (
            <View key={item.icon} style={{ flex: 1, minWidth: 0, flexDirection: "row", alignItems: "center", gap: space[1] }}>
              {index > 0 && <Icon name="ChevronRight" size={14} color={colors.foregroundMuted} />}
              <View
                style={{
                  flex: 1,
                  minWidth: 0,
                  alignSelf: "stretch",
                  gap: space[1.5],
                  padding: 10,
                  borderRadius: radius.lg,
                  borderWidth: 1,
                  borderColor: colors.border,
                  backgroundColor: colors.surface1,
                }}
              >
                <IconTile name={item.icon} />
                <Label bold size={font.base} selectable={false}>{item.name()}</Label>
                <Label size={font.sm}>{item.note()}</Label>
                <Label muted size={font.sm}>{item.paseo()}</Label>
              </View>
            </View>
          ))}
        </View>
      </View>
      <View style={{ gap: space[2] }}>
        <Eyebrow>{t("The loop")}</Eyebrow>
        <LaneStrip />
        <View style={{ gap: space[2], marginTop: space[1] }}>
          {steps.map((step) => (
            <View key={step.text} style={{ flexDirection: "row", gap: space[2], alignItems: "flex-start" }}>
              <RoleBadge agent={step.agent} />
              <View style={{ flex: 1, minWidth: 0, paddingTop: 2 }}>
                <Label size={font.md}>{step.text}</Label>
              </View>
            </View>
          ))}
        </View>
      </View>
    </View>
  );
}

function FeaturesPage() {
  const { colors } = useTheme();
  const [moreOpen, setMoreOpen] = useState(false);
  // The headline features, shown as tiles; everything else folds under More features.
  const highlights = [
    { icon: "Activity", color: colors.accent, title: t("Automatic status"), text: t("Cards follow the agent's work through the lanes. Done stays yours.") },
    { icon: "Bell", color: colors.statusWarning, title: t("Needs-you reminders"), text: t("Questions, approvals and errors light up the card. Answer them right there.") },
    { icon: "Brain", color: colors.accent, title: t("Run summaries"), text: t("After every turn a cheap model keeps the card's state, recap and next step up to date.") },
    { icon: "Sparkles", color: colors.accent, title: t("Suggested next steps"), text: t("Tap one to fill in the message box. Nothing is sent until you send it.") },
  ];
  const more = [
    { icon: "ListChecks", color: colors.statusSuccess, title: t("Workpad"), text: t("Agents set the card's type and tags and write a workpad before they start: acceptance criteria, checks marked passed, failed or not run on a named commit, and what confused them. Delivering without them needs a note.") },
    { icon: "Lightbulb", color: colors.statusSuccess, title: t("Follow-up ideas"), text: t("Work an agent finds along the way lands in the Ideas inbox. Good idea or Dismiss.") },
    { icon: "BookMarked", color: colors.accent, title: t("Project memory"), text: t("Decisions and pitfalls you confirm carry over to new cards' sessions. Agents and the review of finished cards suggest them; you edit or delete them any time.") },
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
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space[2] }}>
        {highlights.map((item) => (
          <View
            key={item.icon}
            style={{
              flexGrow: 1,
              flexBasis: "45%",
              minWidth: 200,
              gap: space[2],
              padding: space[3],
              borderRadius: radius.lg,
              borderWidth: 1,
              borderColor: colors.border,
              backgroundColor: colors.surface1,
            }}
          >
            <View style={{ flexDirection: "row", alignItems: "center", gap: space[2] }}>
              <IconTile name={item.icon} color={item.color} />
              <View style={{ flex: 1, minWidth: 0 }}>
                <Label bold size={font.base} selectable={false}>{item.title}</Label>
              </View>
            </View>
            <Label muted size={font.md}>{item.text}</Label>
          </View>
        ))}
      </View>
      <Disclosure title={t("More features ({n})", { n: more.length })} open={moreOpen} onChange={setMoreOpen} flush>
        {more.map((item) => (
          <View key={item.icon} style={{ flexDirection: "row", gap: space[2], alignItems: "flex-start" }}>
            <View style={{ paddingTop: 2 }}>
              <Icon name={item.icon} size={15} color={item.color} />
            </View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Label size={font.md}>
                <Label bold size={font.md} selectable={false}>{item.title}</Label>
                {"  "}
                <Label muted size={font.md}>{item.text}</Label>
              </Label>
            </View>
          </View>
        ))}
      </Disclosure>
    </View>
  );
}

function StartPage({ canCreate }: { canCreate: boolean }) {
  const { colors } = useTheme();
  const checklist = [
    { icon: "Folder", text: t("Pick a folder to make a project.") },
    { icon: "SquarePlus", text: t("Add your first task and start an agent.") },
    { icon: "Bell", text: t("Reply when a card says Needs you.") },
  ];
  return (
    <View style={{ gap: space[4] }}>
      <PageTitle
        title={t("Ready when you are")}
        detail={canCreate ? t("Your first three steps. Nothing is created until you confirm.") : t("Your first three steps.")}
      />
      <View
        style={{
          borderRadius: radius.lg,
          borderWidth: 1,
          borderColor: colors.border,
          backgroundColor: colors.surface1,
        }}
      >
        {checklist.map((item, index) => (
          <View
            key={item.icon}
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: space[3],
              padding: space[3],
              borderTopWidth: index > 0 ? 1 : 0,
              borderTopColor: colors.border,
            }}
          >
            <Icon name="Circle" size={16} color={colors.foregroundMuted} />
            <View style={{ flex: 1, minWidth: 0 }}>
              <Label size={font.base}>{item.text}</Label>
            </View>
            <Icon name={item.icon} size={15} color={colors.accent} />
          </View>
        ))}
      </View>
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
 * First-run welcome tour: three short pages. Closing it any way (Skip, Esc,
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
            {page === 0 ? <HowPage /> : page === 1 ? <FeaturesPage /> : <StartPage canCreate={canCreate} />}
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
