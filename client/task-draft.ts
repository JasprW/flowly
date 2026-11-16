import { enabledStatuses } from "../shared/lanes";
import { priorities, taskTypes, type Project, type Status, type Task, type TaskType } from "../shared/model";
import { connectorLimits, type ConnectorProvider, type ExternalSummary } from "../shared/connectors";
import { draftField, type FormDraftFields } from "../shared/form-drafts";

const workspaceModes = ["directory", "worktree", "existing"] as const;
/** A New task draft's fields, read defensively: anything unexpected is ignored. */
export function restoredTask(fields: FormDraftFields | undefined, project: Project, defaultStatus: Status) {
  const text = (name: string) => draftField.text(fields, name);
  const status = text("status") as Status | undefined;
  const priority = text("priority") as Task["priority"] | undefined;
  const type = text("type");
  const mode = text("mode");
  let externals: { item: ExternalSummary; provider: ConnectorProvider }[] = [];
  try {
    const parsed: unknown = JSON.parse(text("externals") || "[]");
    if (Array.isArray(parsed))
      externals = parsed
        .filter((x) => x && typeof x.provider === "string" && x.item && typeof x.item.key === "string" && typeof x.item.connectionId === "string")
        .slice(0, connectorLimits.perCreate);
  } catch {
    externals = [];
  }
  const provider = text("provider");
  return {
    title: text("title"),
    description: text("description"),
    status: status && enabledStatuses(project).includes(status) && (status === defaultStatus || (status !== "done" && status !== "cancelled")) ? status : undefined,
    priority: priority && (priorities as readonly string[]).includes(priority) ? priority : undefined,
    type: type === "" || (type && (taskTypes as readonly string[]).includes(type)) ? (type as TaskType | "") : undefined,
    tags: draftField.list(fields, "tags"),
    mode: mode && (workspaceModes as readonly string[]).includes(mode) ? (mode as (typeof workspaceModes)[number]) : undefined,
    workspaceId: text("workspaceId"),
    branchName: text("branchName"),
    baseRef: text("baseRef"),
    startAgent: draftField.flag(fields, "startAgent"),
    agent: provider !== undefined ? { provider, model: text("model") || "", mode: text("agentMode") || "", thinking: text("thinking") || "" } : null,
    prompt: text("prompt"),
    externals,
    operationId: /^card-[A-Za-z0-9-]{1,100}$/.test(text("operationId") || "") ? text("operationId") : undefined,
  };
}
