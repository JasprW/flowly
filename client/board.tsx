import { useEffect, useId, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { Animated, Platform, Pressable, View, useWindowDimensions, type GestureResponderEvent } from "react-native";
import { Icon, ScrollView, useToast } from "@getpaseo/plugin/client/react-native";
import { Modal, useAfterModalClose } from "./modal";
import {
  usePaseo,
  useRpc,
  useSettings,
  type PluginSurfaceProps,
  type PluginWorkspacePanelProps,
  type PluginScreenParams,
} from "@getpaseo/plugin/client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import * as rpc from "../shared/rpc";
import {
  priorities,
  taskTypes,
  taskTypeLabels,
  type Status,
  type Task,
  type Project,
  type BoardEvent,
  type Idea,
  projectOrder,
} from "../shared/model";
import type { PaseoAgent } from "@getpaseo/client";
import {
  Theme,
  Label,
  CountPill,
  Button,
  Field,
  Choices,
  Notice,
  Row,
  Dot,
  Badge,
  Divider,
  Actions,
  IconButton,
  message,
  font,
  radius,
  space,
  touch,
  useTheme,
  verticalScroll,
  verticalContent, noFocusRing } from "./ui";
import { StatusIcon, priorityLabels } from "./status";
import {
  attentionBadgeText,
  allAttentionFromSources,
  attentionOpenToken,
  lastSessionSettings,
  type AttentionItem,
} from "./attention";
import { relativeTime } from "./ui";
import { Collapse } from "./disclosure";
import { currentWrapup } from "../shared/wrapup-state";
import { ProjectForm, TaskForm, type TaskSeed } from "./forms";
import { ideaDescription } from "../shared/ideas";
import { waitingOn } from "../shared/links";
import { LinkPicker } from "./task-links";
import { TaskDrawer } from "./drawer";
import { DeleteTaskDialog } from "./task-delete";
import { useBoardQuery, useLiveAgents, useResourcesQuery, useWorkflowInsightsQuery } from "./queries";
import { useStableCallback, useStableTheme } from "./stable";
import { isLegacyScope } from "../shared/scope";
import { LaneList } from "./lane-list";
import { perfConfigure, perfMark, usePerfRender } from "./perf";
import { laneRows, sameRows } from "./lane-rows";
import { LiveTaskCard, type CardDrag, type LiveTaskCardProps } from "./card";
import { useConnections } from "./connectors";
import { faceKey, familyOf } from "../shared/connectors";
import { cardProgress, useSummaries } from "./task-progress";
import { LocaleRoot } from "./i18n";
import { agentModelFromValues, effectiveAgentModel, startingAgent } from "../shared/agent-defaults";
import { SettingsFab, SettingsModal, type SettingsSection } from "./summary-settings";
import { SettingsOpenerContext } from "./settings-opener";
import { findingDescription, workflowInsightsSettings, workflowSettingsValues, type Finding } from "../shared/workflow-insights";
import { WrapupModal } from "./wrapup";
import { performanceLogOn, performanceSettings, ideasSettings, ideasSettingsValues, modelSettings, modelSettingsValues, wrapupSettings, wrapupSettingsValues } from "../shared/settings";
import { pickOutputSession } from "./card-output";
import { cardQuestions } from "../shared/progress";
import { hasOpenNextMoves } from "../shared/next-moves";
import { statusChanges } from "./changes";
import { Popover, type PopoverPlace } from "./popover";
import { ContextMenuProvider, eventPoint, menuHandlers, suppressNativeMenu, useMenuOpener, type MenuEntry } from "./context-menu";
import { DesktopColumns, OlderToggle, type Placement } from "./columns";
import { olderFinished } from "./finished-cards";
import { ResizeGrip } from "./resize";
import { drawerWidth, isCompactLayout } from "./geometry";
import { useSessionReads } from "./session-reads";
import { sessionAttentionSummary } from "../shared/session-attention";
import { MotionProvider, MotionReveal, useMotionPresence, lerp } from "./motion";
import { SortableList } from "./sortable-list";
import { useBoardView } from "./board-view";
import { OverviewBar } from "./overview-bar";
import { InsightsPage } from "./insights";
import { IdeasPage } from "./ideas-page";
import { lastViewedProject, pickProject, rememberViewedProject } from "./project-memory";
import { ProjectTabs } from "./project-tabs";
import { RemoveProjectDialog } from "./project-remove";
import { boardOverview } from "./overview";
import { enabledStatuses, laneName } from "../shared/lanes";
import { boardSortText, boardSorts, latestTurnEnds, sortTasks, turnEndActivity, type BoardSort } from "../shared/sort";
import { projectTagStats, tagPrefixes, taskMatchesSearch, taskMatchesTagFilter } from "../shared/tags";
import {
  parseIdeaLink,
  parseSessionLink,
  resolveSessionLink,
  sessionLinkKey,
  type SessionEntry,
} from "./session-link";
import {
  navigateGrid,
  parseBoardIntent,
  resolveShortcut,
  shortcutHelp,
  shortcutsBlocked,
  taskGrid,
  adjacentStatus,
  type ShortcutAction,
  type BoardIntent,
} from "./shortcuts";
import { ConceptStrip, GuideBanner, WelcomeTour, useOnboarding } from "./onboarding";
import { nextTip, welcomeDecision, type TipId } from "./onboarding-logic";
import { t, tn } from "../shared/i18n";
import { workpadEnabled, workpadSignal } from "../shared/workpad";
import { cardDisplay } from "../shared/card-display";
import { parentOf } from "../shared/subagents";

/** One-time tip texts (ONBOARDING-SPEC §5). */
const tipText: Record<TipId, () => string> = {
  "first-card": () => t("Your card moves by itself as the agent works. Open it any time to see its sessions, output and summary."),
  "needs-you": () => t("A card is waiting for you. Reply goes straight to the session."),
  "first-idea": () => t("An agent suggested follow-up work. Good idea starts a card or continues here; Dismiss removes it."),
  "first-done": () => t("Done cards can be wrapped up: their sessions and workspace are archived. Auto wrap up is in settings."),
  "first-artifact": () => t("Cards now collect artifacts: the files and links a task worked from and delivered. Agents add them as they work; you can add your own in the card."),
  "agent-question": () => t("An agent is asking you something. Open the card's session to answer it right there, no need to switch to Paseo."),
  "first-tag": () => t("Agents tag their cards by module and direction. Open a card and tap a tag to filter the board by it, or search #tag."),
  "next-move": () => t("When an agent finishes a turn, its suggested next steps sit above the message box. Tap one to fill it in; nothing is sent until you press Send. Some steps act on the card, like Move to Done."),
  "older-finished": () => t("Cards that finished a while ago fold under “Show older” at the bottom of Done and Cancelled. Settings → Workflow sets how long they stay."),
  "first-ticket": () => t("A card has an item from a connected service as an input. Agents read it every turn and see when it changes. Flowly never changes it there, and its status doesn't move the card."),
  "jira-connect": () => t("Work from Jira, Confluence, GitHub or GitLab: connect them in Settings → Connections, then start a card with From… or add items with the Artifacts +. Flowly only reads them."),
  connectors: () => t("The Artifacts + now adds Confluence pages and GitHub or GitLab issues and pull requests too, besides files, links and Jira tickets. Connect services in Settings → Connections."),
  "project-menu": () => t("Drag a project tab to reorder it. Right-click it for its settings, a new task, Insights, Ideas or Remove."),
  subagents: () => t("When a session starts subagents, a Subagents chip appears above its message box. Click it to see their status and open one in Paseo."),
  "ai-language": () => t("AI-written text follows Settings → AI features → AI output language. It starts as your interface language."),
  "first-workflow-insight": () => t("Workflow insights found repeated work worth keeping. Open Insights to turn a suggestion into a card."),
  "card-display": () => t("Cards too busy? Choose what they show in Settings → Cards, or from the Sort menu → Card display."),
  "attention-dismiss": () => t("Not ready to decide? Dismiss a card from Attention. It comes back when something new happens."),
  "sidebar-order": () => t("Arrange an open card your way: reorder its sections and choose which start open in Settings → Cards → Card sidebar."),
  "session-history": () => t("A session's output now starts at the beginning of its current turn. Press Load earlier at the top to read further back."),
  "first-workpad": () => t("This card has a workpad: the agent's acceptance criteria and checks. The card shows how many checks passed; open it to see which ran on which commit, and tick items yourself."),
};

/** RN-Web forwards React keyboard events on View; React Native's types omit them. */
type WebKeyEvent = {
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  repeat: boolean;
  nativeEvent?: { isComposing?: boolean };
  preventDefault(): void;
  stopPropagation(): void;
};

const noEvents: BoardEvent[] = [];
const noAgents: PaseoAgent[] = [];

// Module scope: a remounted board must not reopen a modal for a token it already handled.
const appliedAttentionTokens = new Set<string>();
const consumedIntents = new Set<string>();

export function BoardScreen(props: PluginSurfaceProps & { workspaceId?: string; params?: PluginScreenParams }) {
  return (
    <LocaleRoot>
      <BoardSurface {...props} />
    </LocaleRoot>
  );
}

function BoardSurface(props: PluginSurfaceProps & { workspaceId?: string; params?: PluginScreenParams }) {
  // Tablets get anchored menus with the desktop board; phones keep the bottom sheet.
  const windowWidth = useWindowDimensions().width;
  // The host may hand over a new theme object on unrelated renders; a new
  // context value would re-render every themed component (PERFORMANCE-SPEC §3).
  const theme = useStableTheme(props.theme);
  return (
    <MotionProvider>
      <Theme.Provider value={theme}>
        <ContextMenuProvider compact={isCompactLayout(props.layout.compact, props.layout.platform, windowWidth)}>
          <BoardContent {...props} theme={theme} />
        </ContextMenuProvider>
      </Theme.Provider>
    </MotionProvider>
  );
}

function BoardContent(
  props: PluginSurfaceProps & {
    workspaceId?: string;
    params?: PluginScreenParams;
  },
) {
  usePerfRender("board.render");
  const toast = useToast();
  const read = useRpc(rpc.readBoard),
    updateProject = useRpc(rpc.updateProject),
    updateTask = useRpc(rpc.updateTask),
    reorder = useRpc(rpc.moveTask),
    placeTask = useRpc(rpc.placeTask),
    paseo = usePaseo();
  const queryClient = useQueryClient();
  const linkMount = useId();
  const input = useMemo(() => {
    try {
      return { link: parseSessionLink(props.params), error: "" };
    } catch (error) {
      return { link: null, error: message(error) };
    }
  }, [
    props.params?.taskId,
    props.params?.sessionId,
    props.params?.workspaceId,
    props.params?.requestId,
  ]);
  const linkKey = input.link
    ? JSON.stringify([props.host.id, sessionLinkKey(input.link)])
    : "";
  const resolvedLink = useQuery({
    queryKey: ["flowly", "cardLink", linkMount, linkKey],
    queryFn: () => resolveSessionLink(paseo, () => read({}), input.link!),
    enabled: !!input.link,
    gcTime: 0,
    staleTime: Infinity,
    retry: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });
  const appliedLink = useRef("");
  // "Start a new task" from the native Ideas chip (NATIVE-SESSION-SPEC §7.3), applied once per request.
  const ideaInput = useMemo(() => {
    try {
      return { link: parseIdeaLink(props.params), error: "" };
    } catch (error) {
      return { link: null, error: message(error) };
    }
  }, [props.params?.ideaId, props.params?.requestId]);
  const appliedIdea = useRef(""),
    // An idea newer than this board copy: re-read the board once before calling it gone.
    ideaRetried = useRef("");
  const [sessionEntry, setSessionEntry] = useState<
    (SessionEntry & { taskId: string }) | null
  >(null);
  const { query: readState, receipts } = useSessionReads();
  // Unchanged reads are a tiny etag round trip; agents stream (PERFORMANCE-SPEC §3).
  const data = useBoardQuery({ refetchInterval: 3000 });
  const resources = useResourcesQuery({ refetchInterval: 15000 });
  const agents = useLiveAgents();
  const view = useBoardView();
  // Moving a card into Done/Cancelled asks whether to wrap it up, unless the
  // daemon does it automatically (Auto wrap up setting).
  const wrapupPrefs = useSettings(wrapupSettings);
  // The Ideas switch (IDEAS-INBOX-SPEC §10); on until the setting has loaded.
  const ideasPrefs = useSettings(ideasSettings);
  const ideasOn = ideasPrefs.status !== "ready" || ideasSettingsValues(ideasPrefs.values).ideas;
  // Developer timing log (off unless the host setting is on; PERFORMANCE-SPEC §3).
  const perfPrefs = useSettings(performanceSettings);
  const sendPerf = useRpc(rpc.perfReport);
  const perfOn = perfPrefs.status === "ready" && performanceLogOn(perfPrefs.values);
  useEffect(() => {
    perfConfigure(perfOn, (report) => void sendPerf(report).catch(() => undefined), Platform.OS);
    return () => perfConfigure(false, null);
  }, [perfOn]);
  const [wrapPrompt, setWrapPrompt] = useState("");
  const finished = (status?: Status) => status === "done" || status === "cancelled";
  const askWrapup = (id: string, from: Status | undefined, to: Status) => {
    if (!finished(to) || finished(from)) return;
    setMovedToFinished(true);
    if (wrapupPrefs.status !== "ready" || wrapupSettingsValues(wrapupPrefs.values).autoWrapup) return;
    setWrapPrompt(id);
  };
  const [projectId, setProject] = useState(""),
    [taskId, setTask] = useState(""),
    [search, setSearchState] = useState(""),
    [priority, setPriorityState] = useState("all"),
    [taskType, setTaskTypeState] = useState("all"),
    [tagFilter, setTagFilterState] = useState<string[]>([]),
    [archived, setArchivedState] = useState(false),
    [menu, setMenu] = useState<"projects" | "filters" | "status" | "attention" | "shortcuts" | "settings" | null>(null),
    // First-run welcome tour (ONBOARDING-SPEC): opened once automatically, or by hand.
    [welcomeOpen, setWelcomeOpen] = useState(false),
    // The user just moved a card into Done/Cancelled (drives the wrap-up tip).
    [movedToFinished, setMovedToFinished] = useState(false),
    [escapeRequest, setEscapeRequest] = useState<{ taskId: string; key: string } | null>(null),
    // Project-level page over the board area: Insights or Ideas (IDEAS-INBOX-SPEC §3.3).
    [page, setPage] = useState<"insights" | "ideas" | null>(null),
    // Ideas page: only this card's ideas ("All ideas" from a card).
    [ideaCard, setIdeaCard] = useState(""),
    // `idea`: Start session prefilled from an idea on the Ideas page (IDEAS-SPEC §6.3).
    [startRequest, setStartRequest] = useState<{ taskId: string; key: string; idea?: Idea } | null>(null),
    [mobileStatus, setMobileStatus] = useState<Status>("todo"),
    [actionTask, setActionTask] = useState<Task | null>(null),
    [projectForm, setProjectForm] = useState<"new" | "edit" | null>(null),
    [removing, setRemoving] = useState<Project | null>(null),
    [deleting, setDeleting] = useState<Task | null>(null),
    [linking, setLinking] = useState<Task | null>(null),
    [taskForm, setTaskForm] = useState<{ task?: Task; status: Status; seed?: TaskSeed } | null>(
      null,
    ),
    [error, setError] = useState(""),
    [pending, setPending] = useState(false),
    [surfaceWidth, setSurfaceWidth] = useState(0),
    [preferredWidth, setPreferredWidth] = useState(440);
  const mutationLock = useRef(false);
  // Filters are remembered (board-view settings): restored once, then written through.
  const filtersRestored = useRef(false);
  useEffect(() => {
    if (filtersRestored.current || !view.values) return;
    filtersRestored.current = true;
    setSearchState(view.values.filterSearch);
    setPriorityState(view.values.filterPriority);
    setTaskTypeState(view.values.filterType);
    setTagFilterState(view.values.filterTags);
    setArchivedState(view.values.showArchived);
  }, [!!view.values]);
  const searchSave = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (searchSave.current) clearTimeout(searchSave.current);
  }, []);
  const setSearch = (next: string) => {
    setSearchState(next);
    if (searchSave.current) clearTimeout(searchSave.current);
    searchSave.current = setTimeout(() => void view.update({ filterSearch: next.slice(0, 200) }), 500);
  };
  const setPriority = (next: string) => {
    setPriorityState(next);
    void view.update({ filterPriority: next as "all" });
  };
  const setTaskType = (next: string) => {
    setTaskTypeState(next);
    void view.update({ filterType: next as "all" });
  };
  const setTagFilter = (next: string[]) => {
    const value = next.slice(0, 20);
    setTagFilterState(value);
    void view.update({ filterTags: value });
  };
  // Clicking a tag in the drawer adds it to the filter (CARD-TAGS-SPEC §6.3).
  const filterByTag = useStableCallback((tag: string) => {
    if (!tagFilter.includes(tag)) setTagFilter([...tagFilter, tag]);
  });
  const setArchived = (next: boolean | ((current: boolean) => boolean)) => {
    setArchivedState((current) => {
      const value = typeof next === "function" ? next(current) : next;
      if (value !== current) void view.update({ showArchived: value });
      return value;
    });
  };
  useEffect(() => {
    setSessionEntry(null);
    setMenu(null);
    setActionTask(null);
    if (input.error || resolvedLink.error) setTask("");
  }, [linkKey, input.error, resolvedLink.error]);
  const attentionToken = attentionOpenToken(props.params);

  useEffect(() => {
    if (!attentionToken || appliedAttentionTokens.has(attentionToken)) return;
    appliedAttentionTokens.add(attentionToken);
    openAttentionMenu();
  }, [attentionToken]);
  useEffect(() => {
    const target = resolvedLink.data;
    if (
      !target ||
      !input.link ||
      sessionLinkKey(target.link) !== sessionLinkKey(input.link) ||
      appliedLink.current === linkKey
    )
      return;
    let cancelled = false;
    void (async () => {
      await queryClient.cancelQueries({
        queryKey: ["flowly", "board"],
        exact: true,
      });
      if (cancelled) return;
      appliedLink.current = linkKey;
      queryClient.setQueryData(["flowly", "board"], target.board);
      setProject(target.project.id);
      setTask(target.task.id);
      setSearch("");
      setPriority("all");
      setTaskType("all");
      setTagFilter([]);
      setArchived(
        (current) =>
          current || !!target.project.archivedAt || !!target.task.archivedAt,
      );
      setMobileStatus(target.task.status);
      setError("");
      // The chip opens the card's overview, not the session it was tapped in:
      // an empty session entry returns an already open card to its details.
      setSessionEntry({
        taskId: target.task.id,
        sessionId: "",
        requestId: target.link.requestId,
      });
    })().catch((error) => {
      if (!cancelled) {
        setTask("");
        setError(message(error));
      }
    });
    return () => {
      cancelled = true;
    };
  }, [resolvedLink.data, linkKey, queryClient]);
  const { colors } = props.theme;
  const compact = isCompactLayout(
    props.layout.compact,
    props.layout.platform,
    surfaceWidth,
  );
  const width = drawerWidth(preferredWidth, surfaceWidth || 1000);
  // While the drawer is being dragged the board keeps one width, the widest it can have (the
  // drawer overlays it), so columns neither reflow nor leave a blank gap when the drawer narrows.
  const [resizing, setResizing] = useState(false);
  const resizingFrom = resizing ? Math.max(0, surfaceWidth - 340 - 8 - 16) || null : null;
  const board = data.data;
  const linked = props.workspaceId
    ? board?.tasks.find((t) => t.workspaceId === props.workspaceId)
    : undefined;
  useEffect(() => {
    if (linked) {
      setProject(linked.projectId);
      setTask(linked.id);
    }
  }, [linked?.id]);
  // A dropped project shows in place until the refreshed board agrees.
  const [projectOrderOverride, setProjectOrderOverride] = useState<string[] | null>(null);
  const serverProjects = (board?.projects || [])
    .filter((p) => archived || !p.archivedAt)
    .sort(projectOrder);
  const serverProjectIds = serverProjects.map((p) => p.id).join(",");
  useEffect(() => {
    if (!projectOrderOverride) return;
    if (projectOrderOverride.join(",") === serverProjectIds) return setProjectOrderOverride(null);
    const timer = setTimeout(() => setProjectOrderOverride(null), 5000);
    return () => clearTimeout(timer);
  }, [projectOrderOverride, serverProjectIds]);
  const projects = projectOrderOverride
    ? serverProjects.slice().sort((a, b) => projectOrderOverride.indexOf(a.id) - projectOrderOverride.indexOf(b.id))
    : serverProjects;
  const boardSort: BoardSort = view.values?.boardSort || "manual";
  // What cards show (CARD-DISPLAY-SPEC); one object for all cards so memoized cards stay put.
  const cardActivity = view.values?.cardActivity, cardHiddenKey = (view.values?.cardHidden || []).join(",");
  const display = useMemo(() => cardDisplay({ cardActivity, cardHidden: cardHiddenKey.split(",") }), [cardActivity, cardHiddenKey]);
  const [settingsSection, setSettingsSection] = useState<SettingsSection | undefined>(undefined);
  const collapsedColumns = view.values?.collapsedColumns || [];
  const toggleCollapse = (status: Status) => {
    if (!view.values) return;
    const next = collapsedColumns.includes(status)
      ? collapsedColumns.filter((s) => s !== status)
      : [...collapsedColumns, status];
    void view.update({ collapsedColumns: next });
  };
  const chooseSort = (next: BoardSort) => {
    if (!view.values || next === boardSort) return;
    void view.update({ boardSort: next });
  };
  const project = pickProject(projects, projectId, lastViewedProject());
  // Returning to the board in this app run reopens the project viewed last; a cold start opens the first.
  useEffect(() => rememberViewedProject(project?.id), [project?.id]);
  const chooseProject = (id: string) => setProject(id);
  useEffect(() => {
    setActionTask(null);
  }, [project?.id]);
  const task = board?.tasks.find(
    (t) => t.id === taskId && t.projectId === project?.id,
  );
  // Phone with a card open: the board stays mounted and laid out under the
  // card's opaque overlay, so Back shows it at once with its scroll position
  // and neither direction re-lays it out (PERFORMANCE-SPEC §2).
  const boardHidden = compact && !!task;
  const covered = {
    pointerEvents: boardHidden ? ("none" as const) : ("auto" as const),
    accessibilityElementsHidden: boardHidden,
    importantForAccessibility: boardHidden ? ("no-hide-descendants" as const) : ("auto" as const),
  };
  const drawerTarget = useMemo(() => task && project ? {
    task, project, events: board?.events.filter((e) => e.taskId === task.id) || [],
  } : undefined, [task, project, board?.events]);
  const drawer = useMotionPresence(drawerTarget, drawerTarget ? `${drawerTarget.project.id}|${drawerTarget.task.id}` : "");
  const tasks = (board?.tasks || []).filter(
    (t) => t.projectId === project?.id && (archived || !t.archivedAt),
  );
  const visible = tasks.filter(
    (t) =>
      taskMatchesSearch(t, search) &&
      (priority === "all" || t.priority === priority) &&
      (taskType === "all" || t.type === taskType) &&
      taskMatchesTagFilter(t, tagFilter),
  );
  // The project's lanes are its workflow: enabled lanes in their configured order.
  const shownStatuses = enabledStatuses(project);
  const nameOf = (status: Status) => laneName(project, status);
  const wrapPromptTask = wrapPrompt
    ? board?.tasks.find((t) => t.id === wrapPrompt && !t.archivedAt)
    : undefined;
  // Compact: open each project on its first lane that has cards (once per
  // project; a linked card or the user's own tab choice wins afterwards).
  const autoLane = useRef("");
  useEffect(() => {
    if (!board || !project || autoLane.current === project.id) return;
    autoLane.current = project.id;
    if (taskId) return;
    const first = shownStatuses.find((s) => visible.some((t) => t.status === s));
    if (first) setMobileStatus(first);
  }, [board, project?.id]);
  useEffect(() => {
    if (!shownStatuses.includes(mobileStatus)) setMobileStatus(shownStatuses.includes("todo") ? "todo" : shownStatuses[0]);
  }, [shownStatuses.join(","), mobileStatus]);
  // Recent activity counts turn ends only (sort.ts turnEndActivity). Sessions that
  // record no turn events contribute the time they last went idle, remembered
  // across their next turn so the card holds its place while it runs.
  const settledAgents = useRef(new Map<string, { workspaceId: string; at: string }>());
  const turnEnds = useMemo(() => latestTurnEnds(board?.events || []), [board?.events]);
  const taskActivity = useMemo(() => {
    for (const a of agents.data || [])
      if (a.workspaceId && a.updatedAt && !turnEnds.agents.has(a.id) && a.status !== "running" && a.status !== "initializing")
        settledAgents.current.set(a.id, { workspaceId: a.workspaceId, at: a.updatedAt });
    const byWorkspace = new Map<string, string>();
    settledAgents.current.forEach(({ workspaceId, at }, id) => {
      if (!turnEnds.agents.has(id) && (byWorkspace.get(workspaceId) || "") < at) byWorkspace.set(workspaceId, at);
    });
    return turnEndActivity(board?.tasks || [], turnEnds.byTask, byWorkspace);
  }, [agents.data, board?.tasks, turnEnds]);
  // Old Done/Cancelled cards fold to the bottom of their lane (FINISHED-CARDS-SPEC); the open card always shows.
  const hideFinishedDays = view.values?.hideFinishedAfterDays ?? 14;
  const older = useMemo(
    () =>
      olderFinished(
        (board?.tasks || []).filter((t) => t.projectId === project?.id),
        board?.events || [],
        hideFinishedDays,
        Date.now(),
        taskId,
      ),
    [board?.tasks, board?.events, project?.id, hideFinishedDays, taskId],
  );
  const [olderShown, setOlderShown] = useState<Status[]>([]);
  useEffect(() => setOlderShown([]), [project?.id]);
  const toggleOlder = (status: Status) =>
    setOlderShown((shown) => (shown.includes(status) ? shown.filter((s) => s !== status) : [...shown, status]));
  const onScreen = visible.filter((t) => !older.has(t.id) || olderShown.includes(t.status));
  // Within a lane the older cards always come last, under their toggle.
  const sortColumn = (column: Task[]) => {
    const sorted = sortTasks(column, boardSort, taskActivity);
    return older.size ? [...sorted.filter((t) => !older.has(t.id)), ...sorted.filter((t) => older.has(t.id))] : sorted;
  };
  const laneAll = sortColumn(visible.filter((t) => t.status === mobileStatus));
  const list = laneAll.filter((t) => !older.has(t.id));
  const listOlder = laneAll.filter((t) => older.has(t.id));
  const laneRowsRef = useRef<ReturnType<typeof laneRows<Task>> | undefined>(undefined);
  const laneRowList = (laneRowsRef.current = sameRows(laneRowsRef.current, laneRows(list, listOlder, olderShown.includes(mobileStatus))));
  // Status-change flash: remember the last snapshot, emphasize cards that moved.
  const statusMemory = useRef<Map<string, string> | null>(null);
  const [flashing, setFlashing] = useState<ReadonlySet<string>>(new Set());
  const flashTimers = useRef(new Set<ReturnType<typeof setTimeout>>());
  useEffect(() => {
    if (!board) return;
    const { next, changed } = statusChanges(statusMemory.current, board.tasks);
    statusMemory.current = next;
    if (!changed.length) return;
    setFlashing((current) => new Set([...current, ...changed]));
    // Each flash owns its timer; a quick refetch must not cancel an earlier one.
    const timer = setTimeout(() => {
      flashTimers.current.delete(timer);
      setFlashing((current) => new Set([...current].filter((id) => !changed.includes(id))));
    }, 1600);
    flashTimers.current.add(timer);
  }, [board]);
  useEffect(
    () => () => {
      flashTimers.current.forEach(clearTimeout);
      flashTimers.current.clear();
    },
    [],
  );
  const managedRead = useRpc(rpc.managedSessions);
  const summaries = useSummaries();
  const managed = useQuery({
    queryKey: ["flowly", "managed"],
    queryFn: () => managedRead({}),
    refetchInterval: 10000,
  });
  const managedIds = useMemo(
    () => new Set((managed.data || []).map((m) => m.agentId)),
    [managed.data],
  );
  const readUnavailable = readState.isPending || readState.isError;
  // Dismissed cards stay out of every count until something new happens (ATTENTION-DISMISS-SPEC).
  const allAttention = useMemo(
    () =>
      allAttentionFromSources({ board, agents: agents.data, receipts, readUnavailable }) || [],
    [board, agents.data, receipts, readUnavailable],
  );
  const attention = useMemo(() => allAttention.filter((i) => !i.dismissed), [allAttention]);
  const dismissedAttention = useMemo(() => allAttention.filter((i) => i.dismissed), [allAttention]);
  const attentionByTask = useMemo(() => new Map(allAttention.map((i) => [i.task.id, i])), [allAttention]);
  const [dismissedOpen, setDismissedOpen] = useState(false);
  // The project's default model wins over the global one; with neither, the latest session's settings (MODEL-DEFAULTS-SPEC).
  const modelPrefs = useSettings(modelSettings);
  const globalModel = agentModelFromValues(modelPrefs.status === "ready" ? modelSettingsValues(modelPrefs.values) : null);
  const defaultModel = effectiveAgentModel(project, globalModel)?.model ?? null;
  const defaultModelKey = JSON.stringify(defaultModel);
  const sessionDefaults = useMemo(
    () =>
      startingAgent(
        lastSessionSettings(
          agents.data || [],
          new Set((board?.tasks || []).map((t) => t.workspaceId)),
        ),
        defaultModel,
      ),
    [agents.data, board?.tasks, defaultModelKey],
  );
  // Desktop: Attention drops down under the header bell; phones keep the sheet.
  const rootRef = useRef<View>(null),
    attentionRef = useRef<View>(null);
  const [attentionPlace, setAttentionPlace] = useState<PopoverPlace | null>(null);
  const openAttentionMenu = () => {
    const anchor = attentionRef.current,
      root = rootRef.current;
    if (compact || !anchor || !root) {
      setAttentionPlace(null);
      setMenu("attention");
      return;
    }
    root.measureInWindow((cx, cy, cw, ch) =>
      anchor.measureInWindow((x, y, w, h) => {
        // Not laid out yet (e.g. opened from a notification): fall back to the dialog.
        setAttentionPlace(w && cw ? { anchor: { x, y, width: w, height: h }, container: { x: cx, y: cy, width: cw, height: ch } } : null);
        setMenu("attention");
      }),
    );
  };
  const toggleAttentionMenu = () => (menu === "attention" ? setMenu(null) : openAttentionMenu());
  const attentionDropdown = menu === "attention" && !compact ? attentionPlace : null;
  // A resized surface moves the bell; close the dropdown rather than float in the wrong place.
  const dropdownOpen = useRef(false);
  dropdownOpen.current = !!attentionDropdown;
  useEffect(() => {
    if (dropdownOpen.current) setMenu(null);
  }, [surfaceWidth]);
  // Phones: the Needs attention sheet is a Modal; the card and session open once it has closed.
  const afterModalClose = useAfterModalClose();
  const openAttention = (item: AttentionItem) => {
    setMenu(null);
    const go = () => {
      setProject(item.project.id);
      setTask(item.task.id);
      setMobileStatus(item.task.status);
      if (item.sessionId)
        setSessionEntry({
          taskId: item.task.id,
          sessionId: item.sessionId,
          requestId: `attention-${Date.now()}`,
        });
    };
    if (compact) afterModalClose(go);
    else go();
  };
  // The project's tag vocabulary, plus prefix options for hierarchical tags (CARD-TAGS-SPEC §6.4).
  const projectTags = useMemo(
    () => (project ? projectTagStats(board?.tasks || [], project.id).map((x) => x.tag) : []),
    [board?.tasks, project?.id],
  );
  const tagFilterOptions = useMemo(() => {
    const all = [...new Set([...tagPrefixes(projectTags), ...projectTags, ...tagFilter])];
    return all;
  }, [projectTags, tagFilter]);
  const filterCount =
    Number(!!search) +
    Number(priority !== "all") +
    Number(taskType !== "all") +
    Number(tagFilter.length > 0);
  const refresh = () => {
    void data.refetch();
    void resources.refetch();
    void agents.refetch();
    void readState.refetch();
  };
  async function doAction(action: () => Promise<unknown>, success = "", after?: () => void) {
    if (mutationLock.current) return;
    mutationLock.current = true;
    setPending(true);
    setError("");
    try {
      await action();
      if (success) toast.show(success, { variant: "success" });
      after?.();
    } catch (e) {
      setError(message(e));
    } finally {
      mutationLock.current = false;
      setPending(false);
      refresh();
    }
  }
  const dismissRpc = useRpc(rpc.dismissAttention),
    restoreRpc = useRpc(rpc.restoreAttention);
  const dismissFromAttention = useStableCallback((item: AttentionItem) =>
    void doAction(
      () => dismissRpc({ taskId: item.task.id, signals: item.signals }),
      t("Dismissed. It comes back when something new happens."),
    ),
  );
  const restoreToAttention = useStableCallback((taskId: string) =>
    void doAction(() => restoreRpc({ taskId }), t("Back in Attention")),
  );
  const attentionMenuEntry = (card: Task) => {
    const item = attentionByTask.get(card.id);
    if (!item) return [];
    return [
      item.dismissed
        ? { id: "attention-restore", label: t("Restore to Attention"), icon: "Bell", disabled: pending, onPress: () => restoreToAttention(card.id) }
        : { id: "attention-dismiss", label: t("Dismiss from Attention"), icon: "BellOff", disabled: pending, onPress: () => dismissFromAttention(item) },
    ];
  };
  const move = (input: { id: string; revision: number; status: Status }) => {
    const from = data.data?.tasks.find((t) => t.id === input.id)?.status;
    void doAction(
      () => updateTask(input),
      t("Moved to {name}", { name: nameOf(input.status) }),
      () => askWrapup(input.id, from, input.status),
    );
  };
  const place = (input: Placement) => {
    const from = data.data?.tasks.find((t) => t.id === input.id)?.status;
    void doAction(
      () => placeTask(input),
      from === input.status ? "" : t("Moved to {name}", { name: nameOf(input.status) }),
      () => askWrapup(input.id, from, input.status),
    );
  };
  const openMenu = useMenuOpener();
  const cardMenu = (card: Task): MenuEntry[] => {
    const locked = pending || !!project?.archivedAt || !!card.archivedAt;
    return [
      { id: "open", label: t("Open details"), icon: "PanelRightOpen", onPress: () => setTask(card.id) },
      {
        id: "start",
        label: t("Start session"),
        icon: "Play",
        disabled: locked,
        onPress: () => {
          setTask(card.id);
          setStartRequest({ taskId: card.id, key: `start-${Date.now()}` });
        },
      },
      { id: "link", label: t("Link to a card…"), icon: "Link", disabled: locked, onPress: () => setLinking(card) },
      { id: "follow-up", label: t("New follow-up task"), icon: "CornerDownRight", disabled: locked, onPress: () => followUp(card) },
      ...attentionMenuEntry(card),
      { kind: "separator", id: "s1" },
      { kind: "label", id: "move", label: t("Move to") },
      ...shownStatuses.map((status) => ({
        id: `status-${status}`,
        label: nameOf(status),
        checked: status === card.status,
        disabled: locked,
        onPress: () => {
          if (status !== card.status) move({ id: card.id, revision: card.revision, status });
        },
      })),
      { kind: "separator", id: "s2" },
      {
        id: "up",
        label: t("Move up"),
        icon: "ArrowUp",
        disabled: locked,
        onPress: () => void doAction(() => reorder({ id: card.id, revision: card.revision, direction: "up" })),
      },
      {
        id: "down",
        label: t("Move down"),
        icon: "ArrowDown",
        disabled: locked,
        onPress: () => void doAction(() => reorder({ id: card.id, revision: card.revision, direction: "down" })),
      },
      { kind: "separator", id: "s3" },
      {
        id: "archive",
        label: card.archivedAt ? t("Restore card") : t("Archive card"),
        icon: card.archivedAt ? "ArchiveRestore" : "Archive",
        danger: !card.archivedAt,
        disabled: pending || !!project?.archivedAt,
        onPress: () =>
          void doAction(
            () => updateTask({ id: card.id, revision: card.revision, archived: !card.archivedAt }),
            card.archivedAt ? t("Card restored") : t("Card archived"),
          ),
      },
      {
        id: "delete",
        label: t("Delete permanently…"),
        icon: "Trash2",
        danger: true,
        disabled: pending || !!project?.archivedAt,
        onPress: () => setDeleting(card),
      },
    ];
  };
  // One pass over events/agents/workspaces per data change; cards only look up
  // (each card used to filter every event and agent on every render).
  const cardIndex = useMemo(() => {
    const eventsByTask = new Map<string, BoardEvent[]>();
    for (const e of board?.events || []) {
      const list = eventsByTask.get(e.taskId);
      if (list) list.push(e);
      else eventsByTask.set(e.taskId, [e]);
    }
    const agentsByWorkspace = new Map<string, PaseoAgent[]>();
    for (const a of agents.data || []) {
      if (!a.workspaceId) continue;
      const list = agentsByWorkspace.get(a.workspaceId);
      if (list) list.push(a);
      else agentsByWorkspace.set(a.workspaceId, [a]);
    }
    const workspaceIds = new Set((resources.data?.workspaces || []).map((w) => w.id));
    return { eventsByTask, agentsByWorkspace, workspaceIds };
  }, [board?.events, agents.data, resources.data]);
  const openIdeaCount = useMemo(() => {
    const counts = new Map<string, number>();
    if (ideasOn) for (const i of board?.ideas || []) if (i.status === "open") counts.set(i.taskId, (counts.get(i.taskId) || 0) + 1);
    return counts;
  }, [board?.ideas, ideasOn]);
  // Ticket, issue and PR keys per card for the card face (CONNECTORS-SPEC §2): the oldest first, then "+n"; pages are left out.
  const externalKeys = useMemo(() => {
    const keys = new Map<string, { key: string; family: ReturnType<typeof familyOf> }[]>();
    for (const a of board?.artifacts || []) {
      const key = a.external ? faceKey(a.external) : null;
      if (key) keys.set(a.taskId, [...(keys.get(a.taskId) || []), { key, family: familyOf(a.external!.provider) }]);
    }
    return new Map([...keys].map(([id, list]) => [id, { text: list.length > 1 ? `${list[0]!.key} +${list.length - 1}` : list[0]!.key, family: list[0]!.family }]));
  }, [board?.artifacts]);
  // Each card's workpad, for its checks signal (WORKPAD-SPEC §6.1).
  const workpadIndex = useMemo(() => new Map((board?.workpads || []).map((w) => [w.taskId, w])), [board?.workpads]);
  // Unresolved blockers per card, for the "Waiting on" signal (CARD-LINKS-SPEC §5.1).
  const waitingIndex = useMemo(() => {
    const index = new Map<string, { count: number; titles: string }>();
    if (!board?.links.length) return index;
    for (const t of board.tasks) {
      const blockers = waitingOn(board, t.id);
      if (blockers.length) index.set(t.id, { count: blockers.length, titles: blockers.map((b) => b.title).join(", ") });
    }
    return index;
  }, [board?.links, board?.tasks]);
  // Stable for every card (memoized cards; PERFORMANCE-SPEC §3).
  const openCard = useStableCallback((t: Task) => {
    perfMark("drawer.open");
    setTask(t.id);
  });
  const openCardActions = useStableCallback((t: Task) => setActionTask(t));
  const cardMenuFor = useStableCallback((t: Task) => cardMenu(t));
  // Stable drawer callbacks (memoized drawer).
  const closeDrawer = useStableCallback(() => setTask(""));
  const editDrawerTask = useStableCallback(() => task && setTaskForm({ task, status: task.status }));
  // IDEAS-SPEC §6: the new-task form, prefilled from the idea and its source card.
  const createFromIdea = useStableCallback((idea: Idea) =>
    setTaskForm({
      status: "todo",
      seed: {
        ideaId: idea.id,
        title: idea.title,
        description: ideaDescription(
          idea,
          board?.tasks.find((t) => t.id === idea.taskId),
          cardProgress(summaries.data, idea.taskId),
        ),
        type: idea.type,
        priority: idea.priority,
        tags: idea.tags,
      },
    }),
  );
  useEffect(() => {
    if (ideaInput.error) {
      setError(ideaInput.error);
      return;
    }
    const link = ideaInput.link;
    if (!link || !board || appliedIdea.current === link.requestId) return;
    const idea = board.ideas.find((i) => i.id === link.ideaId);
    const card = idea && board.tasks.find((x) => x.id === idea.taskId);
    // Never another idea: a gone or closed one is an error on the board.
    if (!idea || idea.status !== "open" || !card) {
      if (ideaRetried.current !== link.requestId) {
        ideaRetried.current = link.requestId;
        // Found after the re-read: the new board runs this effect again. Still missing (or an unchanged board): say so.
        void data.refetch().then((result) => {
          if (appliedIdea.current === link.requestId) return;
          if (result.data?.ideas.some((i) => i.id === link.ideaId && i.status === "open")) return;
          appliedIdea.current = link.requestId;
          setError(t("This idea is no longer open."));
        });
        return;
      }
      appliedIdea.current = link.requestId;
      setError(t("This idea is no longer open."));
      return;
    }
    appliedIdea.current = link.requestId;
    setError("");
    setPage(null);
    setProject(card.projectId);
    createFromIdea(idea);
  }, [ideaInput, board]);
  // WORKFLOW-INSIGHTS-SPEC §5.2: the new-task form, prefilled from a suggestion.
  const createFromFinding = useStableCallback((finding: Finding) =>
    setTaskForm({
      status: "todo",
      seed: {
        insightFindingId: finding.id,
        title: finding.title,
        description: findingDescription(
          finding,
          finding.cards.map((id) => board?.tasks.find((t) => t.id === id)?.title).filter((x): x is string => !!x),
        ),
        type: "chore",
        tags: ["agent-workflow", ...(finding.target === "paseo_script" || finding.target === "worktree_setup" ? ["paseo-json"] : [])],
      },
    }),
  );
  const openAiSettings = useStableCallback(() => {
    setSettingsSection("ai");
    setMenu("settings");
  });
  const openSettingsAt = useStableCallback((section: SettingsSection) => {
    setSettingsSection(section);
    setMenu("settings");
  });
  // CARD-LINKS-SPEC §5.5: the new-task form, linked as a follow-up of `source`.
  const followUp = useStableCallback((source: Task) =>
    setTaskForm({
      status: "todo",
      seed: { followUpOf: source.id, followUpTitle: source.title, title: "", description: "", type: source.type, priority: source.priority },
    }),
  );
  const linkFrom = useStableCallback((source: Task) => setLinking(source));
  const openTaskById = useStableCallback((id: string) => setTask(id));
  const togglePage = (next: "insights" | "ideas") => setPage((current) => (current === next ? null : next));
  const closePage = useStableCallback(() => setPage(null));
  // Turning Ideas off closes its page.
  useEffect(() => {
    if (!ideasOn) setPage((current) => (current === "ideas" ? null : current));
  }, [ideasOn]);
  const showCardIdeas = useStableCallback((id: string) => {
    setIdeaCard(id);
    setPage("ideas");
    setTask("");
  });
  // "Do it in a new session" from the Ideas page: the card's drawer opens its Start session form.
  const ideaInNewSession = useStableCallback((idea: Idea) => {
    setTask(idea.taskId);
    setStartRequest({ taskId: idea.taskId, key: `start-${Date.now()}`, idea });
  });
  const ideaSessionsOf = useStableCallback((id: string) => {
    const t = board?.tasks.find((x) => x.id === id);
    const list = (t && cardIndex.agentsByWorkspace.get(t.workspaceId)) || noAgents;
    return [...list].sort((a, b) => b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id));
  });
  const projectIdeaList = useMemo(() => (board?.ideas || []).filter((i) => i.projectId === project?.id), [board?.ideas, project?.id]);
  const projectOpenIdeas = useMemo(() => projectIdeaList.filter((i) => i.status === "open").length, [projectIdeaList]);
  const projectTasks = useMemo(() => (board?.tasks || []).filter((t) => t.projectId === project?.id), [board?.tasks, project?.id]);
  // A session of this project has a live Paseo child agent (SUBAGENTS-SPEC §7).
  const projectHasSubagent = useMemo(() => {
    const workspaces = new Set(projectTasks.filter((x) => !x.archivedAt).map((x) => x.workspaceId).filter(Boolean));
    const list = agents.data || [];
    const sessions = new Set(list.filter((a) => !!a.workspaceId && workspaces.has(a.workspaceId)).map((a) => a.id));
    return list.some((a) => { const parent = parentOf(a); return !!parent && sessions.has(parent); });
  }, [projectTasks, agents.data]);
  // Only to announce connectors to users without a connection (tip "jira-connect").
  const connections = useConnections();
  const projectAttention = useMemo(() => attention.filter((i) => i.project.id === project?.id), [attention, project?.id]);
  // First-run guidance (ONBOARDING-SPEC): the welcome tour, empty-board hint and one-time tips.
  const onboarding = useOnboarding();
  // Tip "first-workflow-insight": one read per project while the tip is unseen and the feature on; never polls.
  const workflowPrefs = useSettings(workflowInsightsSettings);
  const workflowOn = workflowPrefs.status === "ready" && workflowSettingsValues(workflowPrefs.values).enabled;
  const workflowTipDue = !!project && workflowOn && !!onboarding.values && !onboarding.values.tipsSeen.includes("first-workflow-insight");
  const workflowView = useWorkflowInsightsQuery(project?.id || "", workflowTipDue, false);
  const inPanel = !!props.workspaceId;
  const dialogOpen = !!menu || !!projectForm || !!taskForm || !!removing || !!deleting || !!wrapPrompt || !!linking;
  const welcome = welcomeDecision({
    settingsStatus: onboarding.status,
    welcomeSeen: onboarding.values?.welcomeSeen ?? false,
    boardLoaded: !!board,
    projectCount: board?.projects.length ?? 0,
    blocked: dialogOpen || !!taskId,
  });
  const welcomeHandled = useRef("");
  const tourTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (tourTimer.current) clearTimeout(tourTimer.current); }, []);
  useEffect(() => {
    if (inPanel || welcomeHandled.current === welcome) return;
    if (welcome === "show") {
      welcomeHandled.current = welcome;
      setWelcomeOpen(true);
    } else if (welcome === "mark-seen") {
      // Someone who already uses the board is never interrupted, and gets no first-time tips either.
      welcomeHandled.current = welcome;
      void onboarding.markExistingUserSeen();
    }
  }, [welcome, inPanel]);
  const closeWelcome = () => {
    setWelcomeOpen(false);
    if (!onboarding.values?.welcomeSeen) void onboarding.markWelcomeSeen();
  };
  const tip = inPanel || !board || !project || !!project.archivedAt || page
    ? null
    : nextTip({
        tipsSeen: onboarding.values?.tipsSeen ?? [],
        facts: {
          hasCard: !task && projectTasks.some((x) => !x.archivedAt),
          needsYou: projectAttention.length > 0,
          agentQuestion: projectAttention.some((i) => i.asks > 0),
          openIdea: ideasOn && projectOpenIdeas > 0,
          movedToFinished,
          hasArtifact: !task && board.artifacts.some((a) => a.projectId === project.id),
          hasAgentTag: !task && projectTasks.some((x) => !x.archivedAt && !!x.tags?.some((tag) => tag.by === "agent")),
          nextMove: projectTasks.some((x) => !x.archivedAt && hasOpenNextMoves(cardIndex.eventsByTask.get(x.id) || noEvents)),
          olderHidden: older.size > 0 && !(olderShown.includes("done") && olderShown.includes("cancelled")),
          hasTicket: !task && board.artifacts.some((a) => a.projectId === project.id && !!a.external),
          cardOpen: !!task,
          noConnection: !task && projectTasks.some((x) => !x.archivedAt) && connections.data?.connections.length === 0,
          projectTabs: !task && !compact && projects.length > 1,
          hasWorkpad: !task && workpadEnabled(project) && board.workpads.some((w) => w.projectId === project.id),
          busyBoard: !task && projectTasks.filter((x) => !x.archivedAt).length >= 6,
          hasSubagent: projectHasSubagent,
          crowdedAttention: attention.length >= 3 && dismissedAttention.length === 0,
          cardWithSession: !!task && !!cardIndex.agentsByWorkspace.get(task.workspaceId)?.length,
          fullSidebar: !!task && (board.artifacts.some((a) => a.taskId === task.id) || board.ideas.some((i) => i.taskId === task.id)),
          hasSummary: !task && !!summaries.data?.latest.some((e) => projectTasks.some((x) => x.id === e.taskId)),
          workflowSuggestion: workflowTipDue && !!workflowView.data?.findings.some((f) => f.status === "open"),
        },
        blocked: !onboarding.values || welcomeOpen || welcome === "show" || dialogOpen,
      });
  const dismissTip = (id: TipId) => {
    if (id === "first-done") setMovedToFinished(false);
    void onboarding.markTipSeen(id);
  };
  const emptyProjectHint = !!board && !!project && !project.archivedAt && !page && !welcomeOpen && projectTasks.length === 0;
  const deleteDrawerTask = useStableCallback(() => drawer.item && setDeleting(drawer.item.task));
  const drawerStatusChanged = useStableCallback((from: Status | undefined, to: Status) =>
    drawer.item && askWrapup(drawer.item.task.id, from, to),
  );
  const stableRefresh = useStableCallback(() => refresh());
  const drawerAttention = drawer.item ? attentionByTask.get(drawer.item.task.id) : undefined;
  const toggleDrawerAttention = useStableCallback(() => {
    if (!drawerAttention) return;
    if (drawerAttention.dismissed) restoreToAttention(drawerAttention.task.id);
    else dismissFromAttention(drawerAttention);
  });
  const sessionEntryConsumed = useStableCallback((requestId: string) =>
    setSessionEntry((current) =>
      current?.requestId === requestId &&
      current.taskId === drawer.item?.task.id &&
      current.sessionId === sessionEntry?.sessionId
        ? null
        : current,
    ),
  );
  const summaryState =
    agents.isPending || readState.isPending
      ? "loading"
      : agents.isError || readState.isError
        ? agents.data && readState.data
          ? "stale"
          : "unavailable"
        : "ready";
  // What a card shows, derived from events, sessions and receipts (each scans a
  // card's whole history). Cached per task object until one of those sources
  // changes, so opening a card, a menu or a filter does not recompute every
  // card of the lane in the same frame as its animation.
  const cardDerived = useMemo(
    () => new WeakMap<Task, Omit<LiveTaskCardProps, "selected" | "flash" | "drag" | "dragging" | "disabled" | "display" | "onOpen" | "onActions" | "menuFor">>(),
    [cardIndex, receipts, summaryState, attentionByTask, managedIds, summaries.data, !!board, openIdeaCount, externalKeys, project, workpadIndex, waitingIndex],
  );
  const derivedFor = (t: Task) => {
    let derived = cardDerived.get(t);
    if (derived) return derived;
    const sessions = cardIndex.agentsByWorkspace.get(t.workspaceId) || noAgents;
    const events = cardIndex.eventsByTask.get(t.id) || noEvents;
    derived = {
      task: t,
      legacy: !!project && isLegacyScope(t, project),
      available: cardIndex.workspaceIds.has(t.workspaceId),
      wrapped: (t.status === "done" || t.status === "cancelled") && !!currentWrapup(events, t.id),
      running: sessions.filter((a) => a.status === "running").length,
      sessions: sessions.length,
      summary: sessionAttentionSummary(sessions, t, receipts, events),
      summaryState,
      attentionDismissed: !!attentionByTask.get(t.id)?.dismissed,
      outputSession: pickOutputSession(sessions, t.workspaceId, managedIds),
      progress: cardProgress(summaries.data, t.id),
      questions: board ? cardQuestions(t, events).length : 0,
      ideas: openIdeaCount.get(t.id) || 0,
      externalKey: externalKeys.get(t.id)?.text,
      externalFamily: externalKeys.get(t.id)?.family,
      workpad: project && workpadEnabled(project) ? workpadSignal(t, workpadIndex.get(t.id), events) : null,
      waiting: waitingIndex.get(t.id)?.count || 0,
      waitingTitles: waitingIndex.get(t.id)?.titles || "",
    };
    cardDerived.set(t, derived);
    return derived;
  };
  const renderCard = (t: Task, drag?: CardDrag, dragging = false) => (
    <LiveTaskCard
      key={t.id}
      {...derivedFor(t)}
      selected={taskId === t.id}
      display={display}
      flash={flashing.has(t.id)}
      drag={drag}
      dragging={dragging}
      disabled={pending || !!project?.archivedAt || !!t.archivedAt}
      onOpen={openCard}
      onActions={openCardActions}
      menuFor={cardMenuFor}
    />
  );
  const projectMenuClose = () => setMenu(null);
  const moveProjectRpc = useRpc(rpc.moveProject);
  const reorderProject = (id: string, move: { direction: "up" | "down" | "top" } | { to: number }) =>
    void doAction(async () => {
      try {
        await moveProjectRpc({ id, ...move });
      } catch (e) {
        setProjectOrderOverride(null);
        throw e;
      }
    });
  // Drag reorder from the chooser or the tabs: `to` is an index in the visible list; the server orders all projects.
  const dropProject = (id: string, to: number) => {
    const ids = projects.map((q) => q.id);
    const all = (board?.projects || []).slice().sort(projectOrder).map((q) => q.id);
    const next = ids.filter((q) => q !== id);
    next.splice(to, 0, id);
    setProjectOrderOverride(next);
    reorderProject(id, { to: all.indexOf(ids[to]) });
  };
  // Project tab context menu (PROJECT-TABS-SPEC): actions that need the board switch to that project first.
  const projectTabMenu = (p: Project, index: number): MenuEntry[] => {
    const openIn = (open: () => void) => {
      chooseProject(p.id);
      open();
    };
    return [
      { id: "settings", label: t("Project settings"), icon: "SlidersHorizontal", onPress: () => openIn(() => setProjectForm("edit")) },
      { id: "new-task", label: t("New task"), icon: "Plus", disabled: !!p.archivedAt, onPress: () => openIn(() => setTaskForm({ status: "todo" })) },
      { kind: "separator", id: "pages" },
      { id: "insights", label: t("Insights"), icon: "Activity", onPress: () => openIn(() => setPage("insights")) },
      ...(ideasOn
        ? [{ id: "ideas", label: t("Ideas"), icon: "Lightbulb", onPress: () => openIn(() => { setIdeaCard(""); setPage("ideas"); }) }]
        : []),
      { kind: "separator", id: "order" },
      { id: "left", label: t("Move left"), icon: "ChevronLeft", disabled: index === 0 || pending, onPress: () => reorderProject(p.id, { direction: "up" }) },
      { id: "right", label: t("Move right"), icon: "ChevronRight", disabled: index === projects.length - 1 || pending, onPress: () => reorderProject(p.id, { direction: "down" }) },
      ...(p.archivedAt
        ? [{ id: "restore", label: t("Restore"), icon: "ArchiveRestore", disabled: pending, onPress: () => void doAction(() => updateProject({ id: p.id, revision: p.revision, archived: false })) }]
        : []),
      { kind: "separator", id: "danger" },
      { id: "remove", label: t("Remove…"), icon: "Trash2", danger: true, disabled: pending, onPress: () => setRemoving(p) },
    ];
  };
  const shortcutsOn = Platform.OS === "web" && !compact;
  const withKey = (text: string, key: string) =>
    shortcutsOn ? `${text} (${key})` : text;
  function runIntent(intent: BoardIntent | Exclude<ShortcutAction, BoardIntent>) {
    // The dropdown is not a dialog, so shortcuts still reach the board: any other one closes it.
    if (attentionDropdown && intent !== "attention") {
      setMenu(null);
      if (intent === "escape") return true;
    }
    switch (intent) {
      case "new-task":
        if (!project || project.archivedAt) return false;
        setTaskForm({ status: "todo" });
        return true;
      case "filters":
        if (!project) return false;
        setMenu("filters");
        return true;
      case "attention":
        toggleAttentionMenu();
        return true;
      case "projects":
      case "shortcuts":
        setMenu(intent);
        return true;
      case "welcome":
        setWelcomeOpen(true);
        return true;
      case "insights":
        if (!project) return false;
        togglePage("insights");
        return true;
      case "ideas":
        if (!project || !ideasOn) return false;
        setIdeaCard("");
        togglePage("ideas");
        return true;
      case "escape":
        if (!task && page) {
          setPage(null);
          return true;
        }
        if (!task) return false;
        setEscapeRequest({ taskId: task.id, key: `escape-${Date.now()}` });
        return true;
      case "edit":
        if (!task || task.archivedAt || project?.archivedAt) return false;
        setTaskForm({ task, status: task.status });
        return true;
      case "move-left":
      case "move-right": {
        if (!task || task.archivedAt || project?.archivedAt || pending) return false;
        const target = adjacentStatus(shownStatuses, task.status, intent);
        if (!target) return false;
        move({ id: task.id, revision: task.revision, status: target });
        return true;
      }
      default: {
        if (compact || page) return false;
        const expanded = shownStatuses.filter((s) => !collapsedColumns.includes(s));
        const next = navigateGrid(taskGrid(expanded, onScreen, sortColumn), task?.id || "", intent);
        if (!next) return false;
        if (next !== task?.id) setTask(next);
        return true;
      }
    }
  }
  const onKeyDown = (e: WebKeyEvent) => {
    const action = resolveShortcut(
      { ...e, isComposing: e.nativeEvent?.isComposing },
      shortcutsOn && !shortcutsBlocked(),
    );
    if (action && runIntent(action)) {
      e.preventDefault();
      e.stopPropagation();
    }
  };
  const keyboardProps = shortcutsOn ? { focusable: true, onKeyDown } : {};

  useEffect(() => {
    if (data.isPending) return;
    const parsed = parseBoardIntent(props.params);
    if (!parsed || consumedIntents.has(parsed.key)) return;
    consumedIntents.add(parsed.key);
    runIntent(parsed.intent);
  }, [props.params?.intent, props.params?.at, data.isPending]);
  const attentionDetail = (item: AttentionItem) =>
    `${item.project.title} · ${laneName(item.project, item.task.status)} · ${[
      item.questions && tn(item.questions, "{n} question", "{n} questions"),
      item.permissions && tn(item.permissions, "{n} approval", "{n} approvals"),
      item.errors && tn(item.errors, "{n} error", "{n} errors"),
      item.unread &&
        (item.silent
          ? item.silent === item.unread
            ? t("{unread} unread (no report)", { unread: item.unread })
            : t("{unread} unread ({silent} no report)", { unread: item.unread, silent: item.silent })
          : t("{unread} unread", { unread: item.unread })),
    ]
      .filter(Boolean)
      .join(" · ")}`;
  // The Dismiss/Restore button sits beside the row, so pressing it never opens the card.
  const attentionRow = (item: AttentionItem) => (
    <View key={item.task.id} style={{ flexDirection: "row", alignItems: "center", opacity: item.dismissed ? 0.7 : 1 }}>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Row
          title={item.task.title}
          detail={attentionDetail(item)}
          label={t("Open {title}", { title: item.task.title })}
          leading={
            <Dot
              size={8}
              color={
                item.dismissed
                  ? colors.foregroundMuted
                  : item.permissions || item.questions
                    ? colors.statusWarning
                    : item.errors
                      ? colors.statusDanger
                      : colors.statusSuccess
              }
            />
          }
          trailing={
            <Label muted size={font.xs} lines={1} selectable={false}>
              {relativeTime(item.updatedAt)}
            </Label>
          }
          onPress={() => openAttention(item)}
        />
      </View>
      {item.dismissed ? (
        <IconButton
          icon="Bell"
          label={t("Restore {title} to Attention", { title: item.task.title })}
          disabled={pending}
          onPress={() => restoreToAttention(item.task.id)}
        />
      ) : (
        <IconButton
          icon="BellOff"
          label={t("Dismiss {title} from Attention", { title: item.task.title })}
          disabled={pending}
          onPress={() => dismissFromAttention(item)}
        />
      )}
    </View>
  );
  const attentionList = (
    <>
      {readUnavailable && (
        <View style={{ paddingBottom: space[2] }}>
          <Notice tone="warning">
            {t("Read state is unavailable, so finished-but-unread sessions are not listed. Approvals and errors still are.")}</Notice>
        </View>
      )}
      {!attention.length ? (
        <View style={{ paddingVertical: space[6], alignItems: "center", gap: space[2] }}>
          <Icon name="BellOff" size={20} color={colors.foregroundMuted} />
          <Label muted>{dismissedAttention.length ? t("Nothing new needs your attention.") : t("Nothing needs your attention.")}</Label>
        </View>
      ) : (
        attention.map((item) => attentionRow(item))
      )}
      {dismissedAttention.length > 0 && (
        <View style={{ paddingTop: space[2], borderTopWidth: 1, borderTopColor: colors.border, marginTop: space[2] }}>
          <Row
            title={t("Dismissed · {n}", { n: dismissedAttention.length })}
            label={dismissedOpen ? t("Hide dismissed cards") : t("Show dismissed cards")}
            icon={dismissedOpen ? "ChevronDown" : "ChevronRight"}
            onPress={() => setDismissedOpen((open) => !open)}
          />
          <Collapse open={dismissedOpen} id="dismissed-attention">
            {dismissedAttention.map((item) => attentionRow(item))}
          </Collapse>
        </View>
      )}
    </>
  );
  const drawerView = drawer.item && (
    <Animated.View
      testID="task-drawer-motion"
      pointerEvents={drawer.active ? "auto" : "none"}
      accessibilityElementsHidden={!drawer.active}
      importantForAccessibility={drawer.active ? "auto" : "no-hide-descendants"}
      style={{
        // Phone: an opaque overlay above the still laid-out board, so opening
        // or closing re-lays out nothing underneath (PERFORMANCE-SPEC §3).
        ...(compact
          ? { position: "absolute", top: 0, bottom: 0, left: 0, right: 0, zIndex: 30, backgroundColor: colors.surface0 }
          : resizingFrom != null
            ? { position: "absolute", top: 0, bottom: 0, right: 0, width: width + 8, minHeight: 0, zIndex: 20, backgroundColor: colors.surface0 }
            : { width: width + 8, minHeight: 0, flexShrink: 0 }),
        flexDirection: "row",
        // Only while opening or closing: at rest no animated props, so a stale native write cannot stay (MotionReveal).
        ...(drawer.settled ? null : { opacity: drawer.progress, transform: [{ translateX: lerp(drawer.progress, [32, 0]) }] }),
      }}
    >
      {!compact && (
        <ResizeGrip
          width={width}
          maxWidth={drawerWidth(720, surfaceWidth || 1000)}
          onStart={() => setResizing(true)}
          onEnd={() => setResizing(false)}
          onChange={(next) =>
            setPreferredWidth(drawerWidth(next, surfaceWidth))
          }
        />
      )}
      <TaskDrawer
        key={drawer.item.task.id}
        active={drawer.active}
        task={drawer.item.task}
        project={drawer.item.project}
        events={drawer.item.events}
        compact={compact}
        width={width}
        navigation={props.navigation}
        hostId={props.host.id}
        onClose={closeDrawer}
        onEdit={editDrawerTask}
        onFilterTag={filterByTag}
        onDelete={deleteDrawerTask}
        onCreateFromIdea={ideasOn ? createFromIdea : undefined}
        onLink={linkFrom}
        onFollowUp={followUp}
        onOpenTask={openTaskById}
        onStatusChanged={drawerStatusChanged}
        refresh={stableRefresh}
        sessionDefaults={sessionDefaults}
        escapeRequest={
          escapeRequest?.taskId === drawer.item.task.id ? escapeRequest.key : undefined
        }
        startRequest={
          startRequest?.taskId === drawer.item.task.id ? startRequest.key : undefined
        }
        startIdea={startRequest?.taskId === drawer.item.task.id ? startRequest.idea : undefined}
        onAllIdeas={showCardIdeas}
        sessionEntry={
          sessionEntry?.taskId === drawer.item.task.id && drawer.active ? sessionEntry : undefined
        }
        onSessionEntryConsumed={sessionEntryConsumed}
        attention={drawerAttention ? (drawerAttention.dismissed ? "dismissed" : "active") : undefined}
        onAttention={toggleDrawerAttention}
        sectionOrder={(view.values?.drawerOrder || []).join(",")}
        sectionOpen={JSON.stringify(view.values?.drawerOpen || {})}
      />
    </Animated.View>
  );
  return (
    <SettingsOpenerContext.Provider value={openSettingsAt}>
    <Theme.Provider value={props.theme}>
      <View
        ref={rootRef}
        {...(keyboardProps as {})}
        {...({ onContextMenu: suppressNativeMenu } as object)}
        onLayout={(e) => setSurfaceWidth(e.nativeEvent.layout.width)}
        // The root only takes focus to receive shortcuts; it must not draw a focus ring.
        style={{ flex: 1, minHeight: 0, overflow: "hidden", backgroundColor: colors.surface0, outlineStyle: "none" } as never}
      >
        {(
          <View
            {...covered}
            style={{
              paddingHorizontal: space[3],
              height: touch ? 56 : 48,
              gap: space[2],
              flexDirection: "row",
              alignItems: "center",
              borderBottomWidth: project ? 0 : 1,
              borderColor: colors.border,
            }}
          >
            {compact || projects.length === 0 ? (
              <ProjectSwitcher
                title={project?.title || t("Projects")}
                archived={!!project?.archivedAt}
                shortcut={shortcutsOn ? "P" : ""}
                onPress={() => setMenu("projects")}
              />
            ) : (
              <ProjectTabs
                projects={projects}
                activeId={project?.id || ""}
                shortcut={shortcutsOn ? "P" : ""}
                onSelect={chooseProject}
                onManage={() => setMenu("projects")}
                onCreate={() => setProjectForm("new")}
                menuFor={projectTabMenu}
                onMove={dropProject}
                reorderDisabled={pending}
              />
            )}
            {!compact && !!project && filterCount > 0 && (
              // The overview counts the whole project; with filters on, say how many are shown.
              <Label muted size={font.sm} selectable={false}>
                {t("{n} shown", { n: visible.length })}
              </Label>
            )}
            {!!project && (
              // Opens the project's own settings (name, lanes, auto status) at once, not through the chooser.
              <IconButton
                icon="SlidersHorizontal"
                label={t("Project settings")}
                onPress={() => setProjectForm("edit")}
              />
            )}
            {(compact || projects.length === 0) && <View style={{ flex: 1 }} />}
            {!compact && (
              <IconButton icon="CircleHelp" label={t("Welcome tour")} onPress={() => setWelcomeOpen(true)} />
            )}
            {shortcutsOn && (
              <IconButton
                icon="Keyboard"
                label={withKey(t("Keyboard shortcuts"), "?")}
                onPress={() => setMenu("shortcuts")}
              />
            )}
            <View ref={attentionRef} collapsable={false}>
              <AttentionButton
                count={attention.length}
                compact={compact}
                open={!!attentionDropdown}
                shortcut={shortcutsOn ? "A" : ""}
                onPress={toggleAttentionMenu}
              />
            </View>
            <SortButton
              mode={boardSort}
              compact={compact}
              onPress={(event) =>
                openMenu?.(eventPoint(event), t("Sort cards"), [
                  { kind: "label", id: "label", label: t("Sort cards in each column") },
                  ...boardSorts.map((mode) => ({
                    id: mode,
                    label: t(boardSortText[mode].label),
                    icon: sortIcons[mode],
                    checked: mode === boardSort,
                    onPress: () => chooseSort(mode),
                  })),
                  { kind: "separator", id: "display" },
                  {
                    id: "card-display",
                    label: t("Card display…"),
                    icon: "LayoutList",
                    onPress: () => {
                      setSettingsSection("cards");
                      setMenu("settings");
                    },
                  },
                ])
              }
            />
            <FilterButton
              count={filterCount}
              compact={compact}
              shortcut={shortcutsOn ? "/" : ""}
              onPress={() => setMenu("filters")}
            />
            {project && (
              <Button
                primary
                icon="Plus"
                label={withKey(t("New task"), "N")}
                disabled={!!project.archivedAt}
                onPress={() =>
                  setTaskForm({ status: "todo" })
                }
              >
                {compact ? "" : t("New task")}
              </Button>
            )}
          </View>
        )}
        {project && board && (
          <View {...covered}>
          <OverviewBar
            overview={boardOverview(project, board.tasks, agents.data || [], attention)}
            nameOf={nameOf}
            onAttention={openAttentionMenu}
            onInsights={() => togglePage("insights")}
            insightsShortcut={shortcutsOn ? "I" : ""}
            openIdeas={ideasOn ? projectOpenIdeas : null}
            onIdeas={() => {
              setIdeaCard("");
              togglePage("ideas");
            }}
            ideasShortcut={shortcutsOn ? "B" : ""}
            onLane={(status) => {
              setPage(null);
              if (compact) setMobileStatus(status);
              else if (collapsedColumns.includes(status)) toggleCollapse(status);
            }}
          />
          </View>
        )}
        {emptyProjectHint && (
          <GuideBanner
            text={t("Add your first task. It gets its own workspace and sessions.")}
            actionLabel={t("New task")}
            onAction={() => setTaskForm({ status: "todo" })}
          />
        )}
        {!emptyProjectHint && !!tip && (
          <GuideBanner
            text={tipText[tip]()}
            dismissLabel={t("Got it")}
            onDismiss={() => dismissTip(tip)}
          />
        )}
        {(data.error || error) && (
          <View style={{ paddingHorizontal: space[3], paddingTop: space[3], gap: space[2] }}>
            <Notice>{error || message(data.error)}</Notice>
            <View style={{ flexDirection: "row" }}>
              <Button
                quiet
                icon="RefreshCw"
                onPress={() => {
                  setError("");
                  refresh();
                }}
              >
                {t("Retry")}</Button>
            </View>
          </View>
        )}
        {!!input.link && resolvedLink.isPending && (
          <View style={{ paddingHorizontal: space[4], paddingTop: space[3] }}>
            <Label muted>{t("Opening linked card…")}</Label>
          </View>
        )}
        {!!(input.error || resolvedLink.error) && (
          <View style={{ paddingHorizontal: space[3], paddingTop: space[3], gap: space[2] }}>
            <Notice>{input.error || message(resolvedLink.error)}</Notice>
            {!input.error && (
              <View style={{ flexDirection: "row" }}>
                <Button quiet icon="RefreshCw" onPress={() => void resolvedLink.refetch()}>
                  {t("Retry linked card")}</Button>
              </View>
            )}
          </View>
        )}
        {data.isPending ? (
          <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
            <Label muted>{t("Loading board…")}</Label>
          </View>
        ) : !project ? (
          <View
            style={{ flex: 1, justifyContent: "center", alignItems: "center", padding: space[6] }}
          >
            <View style={{ maxWidth: 360, gap: space[3], alignItems: "center" }}>
              <Icon name="PanelsTopLeft" size={28} color={colors.foregroundMuted} />
              <Label bold size={font.lg}>
                {t("No projects yet")}</Label>
              <View style={{ paddingBottom: space[2] }}>
                <Label muted size={font.md}>
                  {t("A project maps to one Paseo project root. Add tasks to it and each task gets its own workspace and sessions.")}</Label>
              </View>
              <Button primary icon="Plus" onPress={() => setProjectForm("new")}>
                {t("Create project")}</Button>
              <View style={{ paddingTop: space[3] }}>
                <ConceptStrip onTour={() => setWelcomeOpen(true)} />
              </View>
            </View>
          </View>
        ) : (
          <View style={{ flex: 1, minHeight: 0, flexDirection: "row", ...(resizing ? { userSelect: "none" } : null) } as never}>
            {(
              <MotionReveal
                transitionKey={`${project.id}|${page || (compact ? mobileStatus : "columns")}`}
                direction={-1}
                distance={compact ? 0 : 18}
                {...covered}
                style={
                  resizingFrom == null
                    ? { flex: 1, minWidth: 0, minHeight: 0 }
                    : { width: resizingFrom, flexGrow: 0, flexShrink: 0, minHeight: 0, overflow: "hidden" }
                }
              >
                {page === "insights" && board ? (
                  <InsightsPage
                    project={project}
                    tasks={projectTasks}
                    attention={projectAttention}
                    revision={board.revision}
                    compact={compact}
                    active={!(compact && drawer.active)}
                    nameOf={nameOf}
                    onOpenTask={openTaskById}
                    onBack={closePage}
                    onCreateFromFinding={createFromFinding}
                    onOpenSettings={openAiSettings}
                  />
                ) : page === "ideas" && ideasOn && board ? (
                  <IdeasPage
                    project={project}
                    tasks={projectTasks}
                    ideas={projectIdeaList}
                    compact={compact}
                    cardFilter={ideaCard}
                    nameOf={nameOf}
                    sessionsOf={ideaSessionsOf}
                    onCardFilter={setIdeaCard}
                    onOpenTask={openTaskById}
                    onCreate={createFromIdea}
                    onNewSession={ideaInNewSession}
                    onBack={closePage}
                  />
                ) : compact ? (
                  <>
                    <View style={{ paddingHorizontal: space[2], paddingTop: space[2] }}>
                      <Row
                        title={nameOf(mobileStatus)}
                        label={t("Choose task status")}
                        leading={<StatusIcon status={mobileStatus} size={16} />}
                        trailing={
                          <View style={{ flexDirection: "row", alignItems: "center", gap: space[2] }}>
                            <Label muted size={font.md} selectable={false}>{laneAll.length}</Label>
                            <Icon name="ChevronsUpDown" size={14} color={colors.foregroundMuted} />
                          </View>
                        }
                        onPress={() => setMenu("status")}
                      />
                    </View>
                    <LaneList
                      key={mobileStatus}
                      data={laneRowList}
                      keyOf={(row) => row.key}
                      renderItem={(row) =>
                        row.kind === "task" ? (
                          renderCard(row.task)
                        ) : row.kind === "older" ? (
                          <OlderToggle count={listOlder.length} shown={olderShown.includes(mobileStatus)} onPress={() => toggleOlder(mobileStatus)} />
                        ) : row.hasOlder ? (
                          <View style={{ paddingVertical: space[4], alignItems: "center" }}>
                            <Label muted selectable={false}>{t("No recent tasks")}</Label>
                          </View>
                        ) : (
                          <View style={{ paddingVertical: space[6], gap: space[3], alignItems: "center" }}>
                            <Label muted selectable={false}>
                              {filterCount
                                ? t("No tasks match these filters.")
                                : t("No tasks in {lane}.", { lane: nameOf(mobileStatus) })}
                            </Label>
                            <Button
                              icon="Plus"
                              disabled={!!project.archivedAt}
                              onPress={() =>
                                setTaskForm({ status: mobileStatus })
                              }
                            >
                              {t("Add task")}</Button>
                          </View>
                        )
                      }
                    />
                  </>
                ) : (
                  <DesktopColumns
                    statuses={shownStatuses}
                    tasks={visible}
                    disabled={pending || !!project.archivedAt}
                    cancelKey={`${project.id}|${search}|${priority}|${taskType}|${tagFilter.join(",")}|${archived}|${shownStatuses.join(",")}|${taskId}|${menu}|${actionTask?.id}|${projectForm}|${!!taskForm}`}
                    sortColumn={sortColumn}
                    manualOrder={boardSort === "manual"}
                    collapsed={collapsedColumns}
                    older={older}
                    olderShown={olderShown}
                    onToggleOlder={toggleOlder}
                    nameOf={nameOf}
                    onToggleCollapse={toggleCollapse}
                    onReorderBlocked={() =>
                      toast.show(t("Sorted by {sort}. Drop on another lane to change status; switch to Manual to reorder within a column.", { sort: t(boardSortText[boardSort].label) }), { variant: "info" })
                    }
                    renderCard={renderCard}
                    onAdd={(status) => setTaskForm({ status })}
                    onDrop={place}
                  />
                )}
              </MotionReveal>
            )}
            {!compact && drawerView}
          </View>
        )}

        <Modal
          open={menu === "projects"}
          title={t("Projects")}
          onOpenChange={(open) => {
            if (!open) projectMenuClose();
          }}
        >
          <Modal.Content contentContainerStyle={{ padding: space[3], gap: space[1] }}>
            <Theme.Provider value={props.theme}>
              <SortableList
                items={projects}
                gap={space[1]}
                disabled={pending || touch}
                onMove={dropProject}
                renderItem={(p, index, pressable) => (
                  <Row
                    title={p.title}
                    detail={p.primaryPath}
                    icon={p.archivedAt ? "Archive" : "Folder"}
                    selected={project?.id === p.id}
                    leading={
                      !touch && projects.length > 1 ? (
                        // Grip on the left, tucked against the folder icon.
                        <View
                          accessibilityLabel={t("Drag to reorder")}
                          style={{ width: 14, marginLeft: -space[1.5], marginRight: -space[1.5], alignItems: "center", ...({ cursor: "grab" } as object) }}
                        >
                          <Icon name="GripVertical" size={14} color={colors.foregroundMuted} />
                        </View>
                      ) : undefined
                    }
                    trailing={
                      <View style={{ flexDirection: "row", alignItems: "center", gap: 2 }}>
                        {p.archivedAt && <Badge>{t("Archived")}</Badge>}
                        {touch && projects.length > 1 && (
                          <>
                            <IconButton icon="ChevronUp" size={36} label={t("Move {title} up", { title: p.title })} disabled={index === 0 || pending} onPress={() => reorderProject(p.id, { direction: "up" })} />
                            <IconButton icon="ChevronDown" size={36} label={t("Move {title} down", { title: p.title })} disabled={index === projects.length - 1 || pending} onPress={() => reorderProject(p.id, { direction: "down" })} />
                          </>
                        )}
                      </View>
                    }
                    onPress={() => {
                      if (!pressable()) return;
                      chooseProject(p.id);
                      setTask("");
                      projectMenuClose();
                    }}
                  />
                )}
              />
              <Divider style={{ marginVertical: space[2] }} />
              {project && (
                <>
                  <Row
                    title={t("Edit {title}", { title: project.title })}
                    icon="Pencil"
                    onPress={() => {
                      projectMenuClose();
                      afterModalClose(() => setProjectForm("edit"));
                    }}
                  />
                  {project.archivedAt && (
                    // Archiving was folded into Remove; older archived projects can still come back.
                    <Row
                      title={t("Restore {title}", { title: project.title })}
                      icon="ArchiveRestore"
                      disabled={pending}
                      onPress={() => {
                        projectMenuClose();
                        void doAction(() => updateProject({ id: project.id, revision: project.revision, archived: false }));
                      }}
                    />
                  )}
                  <Row
                    title={t("Remove “{title}”…", { title: project.title })}
                    icon="Trash2"
                    iconColor={colors.statusDanger}
                    disabled={pending}
                    onPress={() => {
                      projectMenuClose();
                      afterModalClose(() => setRemoving(project));
                    }}
                  />
                </>
              )}
              <Row
                title={t("New project")}
                icon="Plus"
                onPress={() => {
                  projectMenuClose();
                  afterModalClose(() => setProjectForm("new"));
                }}
              />
            </Theme.Provider>
          </Modal.Content>
        </Modal>
        <Modal
          open={menu === "filters"}
          title={t("Filters")}
          onOpenChange={(open) => {
            if (!open) setMenu(null);
          }}
        >
          <Modal.Content>
            <Theme.Provider value={props.theme}>
              <Field
                title={t("Search")}
                value={search}
                onChange={setSearch}
                // Filtering re-renders the whole board: keep it out of the keystroke path.
                commitDelay={150}
                placeholder={t("Title, description or #tag")}
              />
              {!!(projectTags.length || tagFilter.length) && (
                <View style={{ gap: space[1.5] }}>
                  <Label medium size={font.sm} muted>
                    {t("Tags")}
                  </Label>
                  <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space[1] }}>
                    {tagFilterOptions.map((tag) => (
                      <TagToggle
                        key={tag}
                        tag={tag}
                        selected={tagFilter.includes(tag)}
                        onToggle={() =>
                          setTagFilter(tagFilter.includes(tag) ? tagFilter.filter((x) => x !== tag) : [...tagFilter, tag])
                        }
                      />
                    ))}
                  </View>
                </View>
              )}
              <Choices
                title={t("Type")}
                value={taskType}
                options={[
                  { value: "all", label: t("All") },
                  ...taskTypes.map((t) => ({ value: t, label: taskTypeLabels[t] })),
                ]}
                onChange={setTaskType}
              />
              <Choices
                title={t("Priority")}
                value={priority}
                options={[
                  { value: "all", label: t("All") },
                  ...priorities.map((p) => ({ value: p, label: priorityLabels[p] })),
                ]}
                onChange={setPriority}
              />
              <Actions>
                <Button
                  quiet
                  disabled={!filterCount}
                  onPress={() => {
                    setSearch("");
                    setPriority("all");
                    setTaskType("all");
                    setTagFilter([]);
                  }}
                >
                  {t("Reset filters")}</Button>
                <Button icon="RefreshCw" onPress={refresh}>
                  {t("Refresh")}</Button>
                <Button primary onPress={() => setMenu(null)}>
                  {t("Done")}</Button>
              </Actions>
            </Theme.Provider>
          </Modal.Content>
        </Modal>
        <Modal
          open={menu === "attention" && !attentionDropdown}
          title={t("Needs attention")}
          onOpenChange={(open) => {
            if (!open) setMenu(null);
          }}
        >
          <Modal.Content contentContainerStyle={{ padding: space[3], gap: space[1] }}>
            <Theme.Provider value={props.theme}>
              {attentionList}
            </Theme.Provider>
          </Modal.Content>
        </Modal>
        <Modal
          open={menu === "shortcuts"}
          title={t("Keyboard shortcuts")}
          onOpenChange={(open) => {
            if (!open) setMenu(null);
          }}
        >
          <Modal.Content contentContainerStyle={{ padding: space[4], gap: space[3] }}>
            <Theme.Provider value={props.theme}>
              <Label muted size={font.md}>
                {t("Board shortcuts work on desktop while focus is inside the board: click an empty part of the board or a card first. They pause while typing or while a dialog is open. From anywhere in Paseo, open the Command Center and search “Flowly”.")}</Label>
              <View style={{ gap: space[1] }}>
                {shortcutHelp.map((item) => (
                  <View
                    key={item.title}
                    style={{ flexDirection: "row", alignItems: "center", gap: space[3], minHeight: 32 }}
                  >
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Label size={font.base} selectable={false}>{t(item.title)}</Label>
                    </View>
                    <View style={{ flexDirection: "row", gap: space[1] }}>
                      {item.keys.map((key) => (
                        <KeyHint key={key}>{key}</KeyHint>
                      ))}
                    </View>
                  </View>
                ))}
              </View>
            </Theme.Provider>
          </Modal.Content>
        </Modal>
        <Modal
          open={menu === "status"}
          title={t("Status")}
          onOpenChange={(open) => {
            if (!open) setMenu(null);
          }}
        >
          <Modal.Content contentContainerStyle={{ padding: space[3], gap: space[1] }}>
            <Theme.Provider value={props.theme}>
              {shownStatuses.map((s) => (
                <Row
                  key={s}
                  title={nameOf(s)}
                  leading={<StatusIcon status={s} size={16} />}
                  selected={s === mobileStatus}
                  trailing={
                    <Label muted size={font.md} selectable={false}>
                      {visible.filter((t) => t.status === s).length}
                    </Label>
                  }
                  onPress={() => {
                    setMobileStatus(s);
                    setMenu(null);
                  }}
                />
              ))}
            </Theme.Provider>
          </Modal.Content>
        </Modal>
        <Modal
          open={!!actionTask}
          title={actionTask?.title || t("Task actions")}
          onOpenChange={(open) => {
            if (!open) setActionTask(null);
          }}
        >
          <Modal.Content contentContainerStyle={{ padding: space[3], gap: space[1] }}>
            <Theme.Provider value={props.theme}>
              {actionTask && (
                <>
                  <Row
                    title={t("Open details")}
                    icon="PanelRightOpen"
                    onPress={() => {
                      setTask(actionTask.id);
                      setActionTask(null);
                    }}
                  />
                  <Row
                    title={t("Start session")}
                    icon="Play"
                    disabled={!!project?.archivedAt || !!actionTask.archivedAt}
                    onPress={() => {
                      setTask(actionTask.id);
                      setStartRequest({ taskId: actionTask.id, key: `start-${Date.now()}` });
                      setActionTask(null);
                    }}
                  />
                  <Row
                    title={t("Link to a card…")}
                    icon="Link"
                    disabled={!!project?.archivedAt || !!actionTask.archivedAt}
                    onPress={() => {
                      setLinking(actionTask);
                      setActionTask(null);
                    }}
                  />
                  <Row
                    title={t("New follow-up task")}
                    icon="CornerDownRight"
                    disabled={!!project?.archivedAt || !!actionTask.archivedAt}
                    onPress={() => {
                      followUp(actionTask);
                      setActionTask(null);
                    }}
                  />
                  {attentionMenuEntry(actionTask).map((entry) => (
                    <Row
                      key={entry.id}
                      title={entry.label}
                      icon={entry.icon}
                      disabled={entry.disabled}
                      onPress={() => {
                        entry.onPress();
                        setActionTask(null);
                      }}
                    />
                  ))}
                  {(["up", "down"] as const).map((direction) => (
                    <Row
                      key={direction}
                      title={direction === "up" ? t("Move up") : t("Move down")}
                      icon={direction === "up" ? "ArrowUp" : "ArrowDown"}
                      disabled={
                        pending ||
                        !!project?.archivedAt ||
                        !!actionTask.archivedAt
                      }
                      onPress={() => {
                        const t = actionTask;
                        setActionTask(null);
                        void doAction(() =>
                          reorder({
                            id: t.id,
                            revision: t.revision,
                            direction,
                          }),
                        );
                      }}
                    />
                  ))}
                  <Divider style={{ marginVertical: space[2] }} />
                  <View style={{ paddingHorizontal: space[3], paddingBottom: space[1] }}>
                    <Label medium muted size={font.sm} selectable={false}>
                      {t("Move to")}</Label>
                  </View>
                  {shownStatuses.map((s) => (
                    <Row
                      key={s}
                      title={nameOf(s)}
                      label={t("Move to: {name}", { name: nameOf(s) })}
                      leading={<StatusIcon status={s} size={16} />}
                      selected={s === actionTask.status}
                      disabled={
                        pending ||
                        !!project?.archivedAt ||
                        !!actionTask.archivedAt
                      }
                      onPress={() => {
                        if (s !== actionTask.status)
                          move({
                            id: actionTask.id,
                            revision: actionTask.revision,
                            status: s,
                          });
                        setActionTask(null);
                      }}
                    />
                  ))}
                </>
              )}
            </Theme.Provider>
          </Modal.Content>
        </Modal>
        {removing && (
          <RemoveProjectDialog
            project={removing}
            theme={props.theme}
            onClose={() => setRemoving(null)}
            onRemoved={({ removedTasks, paseo }) => {
              setRemoving(null);
              setTask("");
              if (projectId === removing.id) setProject("");
              const cards = removedTasks ? tn(removedTasks, "{n} card", "{n} cards") : "";
              if (paseo?.error)
                toast.error(cards ? t("{title} removed from the board with {cards}, but Paseo kept the project: {error}", { title: removing.title, cards, error: paseo.error }) : t("{title} removed from the board, but Paseo kept the project: {error}", { title: removing.title, error: paseo.error }));
              else
                toast.show(
                  paseo?.removed
                    ? cards
                      ? t("{title} removed from the board with {cards} and from Paseo; files stay on disk", { title: removing.title, cards })
                      : t("{title} removed from the board and from Paseo; files stay on disk", { title: removing.title })
                    : cards
                      ? t("{title} removed from the board with {cards}; it stays in Paseo", { title: removing.title, cards })
                      : t("{title} removed from the board; it stays in Paseo", { title: removing.title }),
                  { variant: "success" },
                );
              refresh();
            }}
          />
        )}
        {deleting && (
          <DeleteTaskDialog
            task={deleting}
            theme={props.theme}
            onClose={() => setDeleting(null)}
            onDeleted={({ archived }) => {
              setDeleting(null);
              if (taskId === deleting.id) setTask("");
              toast.show(
                !archived
                  ? t("{title} deleted", { title: deleting.title })
                  : archived.workspace
                    ? tn(archived.sessions, "{title} deleted; workspace and {n} session archived", "{title} deleted; workspace and {n} sessions archived", { title: deleting.title })
                    : tn(archived.sessions, "{title} deleted; {n} session archived", "{title} deleted; {n} sessions archived", { title: deleting.title }),
                { variant: "success" },
              );
              refresh();
            }}
          />
        )}
        {projectForm && (
          <ProjectForm
            key={projectForm}
            project={projectForm === "edit" ? project : undefined}
            laneCounts={Object.fromEntries(
              shownStatuses.map((s) => [s, tasks.filter((t) => t.status === s && !t.archivedAt).length]),
            )}
            showArchived={archived}
            onShowArchived={setArchived}
            onClose={() => setProjectForm(null)}
            onSaved={(id, restored) => {
              chooseProject(id);
              setProjectForm(null);
              refresh();
              if (restored) toast.show(tn(restored.restored, "Restored {title} with {n} card.", "Restored {title} with {n} cards.", { title: restored.title }), { variant: "success" });
            }}
          />
        )}
        {taskForm && project && (
          <TaskForm
            key={taskForm.task?.id || taskForm.seed?.ideaId || taskForm.seed?.insightFindingId || taskForm.seed?.followUpOf || taskForm.status}
            project={project}
            task={taskForm.task}
            seed={taskForm.seed}
            defaultStatus={taskForm.status}
            onClose={() => setTaskForm(null)}
            agentDefaults={sessionDefaults}
            onSaved={(id, launch, status) => {
              if (taskForm.task && status) askWrapup(id, taskForm.task.status, status);
              setTask(id);
              setTaskForm(null);
              if (launch?.sessionId) toast.show(t("Task created and its agent started"), { variant: "success" });
              else if (launch?.error) toast.error(t("Task created, but the agent did not start: {error}. Start it from the task.", { error: launch.error }));
              // The suggestion now shows "Card created".
              if (taskForm.seed?.insightFindingId) void queryClient.invalidateQueries({ queryKey: ["flowly", "workflow-insights", project.id] });
              refresh();
            }}
          />
        )}
        {linking && project && (
          <LinkPicker
            key={linking.id}
            task={linking}
            project={project}
            onClose={() => setLinking(null)}
          />
        )}
        {compact && drawerView}
        {!(compact && task) && (
          <SettingsFab
            open={menu === "settings"}
            onPress={() => {
              setSettingsSection(undefined);
              setMenu("settings");
            }}
          />
        )}
        <SettingsModal
          open={menu === "settings"}
          section={settingsSection}
          theme={props.theme}
          onClose={() => setMenu(null)}
          onTour={() => {
            // One dialog at a time: Settings is its own modal, so let it close before the tour opens.
            setMenu(null);
            if (tourTimer.current) clearTimeout(tourTimer.current);
            tourTimer.current = setTimeout(() => setWelcomeOpen(true), 450);
          }}
        />
        <WelcomeTour
          open={welcomeOpen}
          theme={props.theme}
          canCreate={(board?.projects.length ?? 0) === 0}
          onClose={closeWelcome}
          onCreate={() => {
            closeWelcome();
            setProjectForm("new");
          }}
        />
        {wrapPromptTask && (
          <WrapupModal
            key={wrapPromptTask.id}
            prompt
            task={wrapPromptTask}
            open
            onClose={() => setWrapPrompt("")}
            onDone={(summary) => {
              setWrapPrompt("");
              toast.show(summary, { variant: "success" });
              refresh();
            }}
          />
        )}
        <Popover
          place={attentionDropdown}
          title={t("Needs attention")}
          trailing={
            attention.length ? (
              <Label muted size={font.sm} selectable={false}>
                {tn(attention.length, "{n} card", "{n} cards")}
              </Label>
            ) : undefined
          }
          onClose={() => setMenu(null)}
        >
          {attentionList}
        </Popover>
      </View>
    </Theme.Provider>
    </SettingsOpenerContext.Provider>
  );
}

function ProjectSwitcher({
  title,
  archived,
  shortcut,
  onPress,
}: {
  title: string;
  archived: boolean;
  shortcut: string;
  onPress(): void;
}) {
  const { colors } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={t(shortcut ? "Project: {title}. Choose or manage projects ({shortcut})" : "Project: {title}. Choose or manage projects", { title, shortcut: shortcut ?? "" })}
      onPress={onPress}
      style={(state) => {
        const { pressed, hovered: hover, focused } = state as typeof state & { hovered?: boolean; focused?: boolean };
        const hovered = hover || focused;
        return {
          ...noFocusRing,
          flexDirection: "row",
          alignItems: "center",
          gap: space[2],
          height: touch ? 44 : 32,
          paddingHorizontal: space[2],
          marginLeft: -space[1],
          borderRadius: radius.md,
          flexShrink: 1,
          minWidth: 0,
          backgroundColor: hovered || pressed ? colors.surface2 : "transparent",
        };
      }}
    >
      <Icon name={archived ? "Archive" : "Folder"} size={15} color={colors.foregroundMuted} />
      <View style={{ flexShrink: 1, minWidth: 0 }}>
        <Label bold size={font.base} lines={1} selectable={false}>
          {title}
        </Label>
      </View>
      <Icon name="ChevronsUpDown" size={14} color={colors.foregroundMuted} />
    </Pressable>
  );
}

function AttentionButton({
  count,
  compact,
  open,
  shortcut,
  onPress,
}: {
  count: number;
  compact: boolean;
  /** Its dropdown is showing. */
  open: boolean;
  shortcut: string;
  onPress(): void;
}) {
  const { colors } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${count ? tn(count, "Needs attention, {n} card", "Needs attention, {n} cards") : t("Needs attention")}${shortcut ? ` (${shortcut})` : ""}`}
      accessibilityState={{ expanded: open }}
      onPress={onPress}
      style={(state) => {
        const { pressed, hovered: hover, focused } = state as typeof state & { hovered?: boolean; focused?: boolean };
        const hovered = hover || focused;
        return {
          ...noFocusRing,
          flexDirection: "row",
          alignItems: "center",
          gap: space[1.5],
          height: touch ? 44 : 32,
          minWidth: touch ? 44 : 32,
          justifyContent: "center",
          paddingHorizontal: compact ? 0 : space[2] + 2,
          borderRadius: radius.md,
          backgroundColor: open || hovered || pressed ? colors.surface2 : "transparent",
        };
      }}
    >
      <Icon name="Bell" size={15} color={count ? colors.foreground : colors.foregroundMuted} />
      {!compact && (
        <Label size={font.md} medium muted={!count} selectable={false}>
          {t("Attention")}</Label>
      )}
      {!!count && <CountPill text={attentionBadgeText(count) || ""} />}
    </Pressable>
  );
}

const sortIcons: Record<BoardSort, string> = {
  manual: "GripVertical",
  activity: "Activity",
  priority: "SignalHigh",
  created: "CalendarPlus",
  title: "ArrowDownAZ",
};

function SortButton({ mode, compact, onPress }: { mode: BoardSort; compact: boolean; onPress(event: GestureResponderEvent): void }) {
  const { colors } = useTheme();
  const custom = mode !== "manual";
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={t("Sort cards: {label}", { label: t(boardSortText[mode].label) })}
      onPress={onPress}
      style={(state) => {
        const { pressed, hovered: hover, focused } = state as typeof state & { hovered?: boolean; focused?: boolean };
        return {
          ...noFocusRing,
          flexDirection: "row",
          alignItems: "center",
          gap: space[1.5],
          height: touch ? 44 : 32,
          minWidth: touch ? 44 : 32,
          justifyContent: "center",
          paddingHorizontal: compact ? 0 : space[2] + 2,
          borderRadius: radius.md,
          backgroundColor: hover || focused || pressed ? colors.surface2 : "transparent",
        };
      }}
    >
      <Icon name="ArrowUpDown" size={15} color={custom ? colors.foreground : colors.foregroundMuted} />
      {!compact && (
        <Label size={font.md} medium muted={!custom} selectable={false}>
          {custom ? t(boardSortText[mode].label) : t("Sort")}
        </Label>
      )}
    </Pressable>
  );
}

function FilterButton({
  count,
  compact,
  shortcut,
  onPress,
}: {
  count: number;
  compact: boolean;
  shortcut: string;
  onPress(): void;
}) {
  const { colors } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${count ? t("Task filters, {count} active", { count }) : t("Task filters")}${shortcut ? ` (${shortcut})` : ""}`}
      onPress={onPress}
      style={(state) => {
        const { pressed, hovered: hover, focused } = state as typeof state & { hovered?: boolean; focused?: boolean };
        const hovered = hover || focused;
        return {
          ...noFocusRing,
          flexDirection: "row",
          alignItems: "center",
          gap: space[1.5],
          height: touch ? 44 : 32,
          minWidth: touch ? 44 : 32,
          justifyContent: "center",
          paddingHorizontal: compact ? 0 : space[2] + 2,
          borderRadius: radius.md,
          backgroundColor: hovered || pressed ? colors.surface2 : "transparent",
        };
      }}
    >
      <Icon name="ListFilter" size={15} color={count ? colors.foreground : colors.foregroundMuted} />
      {!compact && (
        <Label size={font.md} medium muted={!count} selectable={false}>
          {t("Filter")}</Label>
      )}
      {!!count && (
        <View
          style={{
            minWidth: 16,
            height: 16,
            paddingHorizontal: 4,
            borderRadius: 8,
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: colors.accent,
          }}
        >
          <Label size={font.xs} bold color={colors.accentForeground} selectable={false}>
            {String(count)}
          </Label>
        </View>
      )}
    </Pressable>
  );
}

function KeyHint({ children }: { children: string }) {
  const { colors } = useTheme();
  return (
    <View
      style={{
        minWidth: 22,
        height: 22,
        paddingHorizontal: space[1.5],
        borderRadius: radius.sm,
        borderWidth: 1,
        borderColor: colors.border,
        backgroundColor: colors.surface1,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <Label size={font.sm} medium selectable={false}>{children}</Label>
    </View>
  );
}


export function WorkspaceBoard(props: PluginWorkspacePanelProps) {
  return <BoardScreen {...props} workspaceId={props.workspaceId} />;
}

/** A tag option in the board filter; "module/" options match by prefix. */
function TagToggle({ tag, selected, onToggle }: { tag: string; selected: boolean; onToggle(): void }) {
  const { colors } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={tag.endsWith("/") ? t("Tags starting with {prefix}", { prefix: tag }) : t("Tag {tag}", { tag })}
      accessibilityState={{ selected }}
      onPress={onToggle}
      style={(state) => ({
        ...noFocusRing,
        height: touch ? 32 : 26,
        paddingHorizontal: space[2],
        justifyContent: "center",
        borderRadius: radius.md,
        borderWidth: 1,
        borderColor: selected ? colors.foregroundMuted : colors.border,
        backgroundColor: selected ? colors.surface2 : (state as { hovered?: boolean }).hovered ? colors.surface1 : "transparent",
      })}
    >
      <Label size={font.sm} medium={selected} muted={!selected} selectable={false}>{`#${tag}${tag.endsWith("/") ? "…" : ""}`}</Label>
    </Pressable>
  );
}
