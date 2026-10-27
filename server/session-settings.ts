import type { PaseoApi } from "@getpaseo/client";
import type { BoardStore } from "./store";
import { paseoHome } from "./service";
import { resolvePaseoCli, runPaseo } from "./paseo-cli";

type Run = (file: string, args: string[]) => Promise<string>;
const defaultRun: Run = (file, args) => runPaseo(args, { timeout: 20000, maxBuffer: 1 << 20 }, file);

export type SessionSettingsInput = {
  taskId: string;
  agentId: string;
  thinkingOptionId?: string;
  modeId?: string;
  stop?: boolean;
  title?: string;
};

/** Validated, card-scoped session setting changes for Kanban sessions. */
export class SessionSettingsService {
  constructor(
    readonly store: BoardStore,
    readonly run: Run = defaultRun,
    readonly cli: () => Promise<string> = () => resolvePaseoCli(),
  ) {}

  async apply(input: SessionSettingsInput, paseo: PaseoApi) {
    const board = await this.store.read();
    const task = board.tasks.find((t) => t.id === input.taskId);
    if (!task) throw new Error("Task not found.");
    const snapshot = await paseo.agents.ref(input.agentId).refresh();
    const agent = snapshot?.agent;
    if (!agent || agent.workspaceId !== task.workspaceId)
      throw new Error("Session is unavailable or belongs to a different workspace.");
    if (agent.archivedAt) throw new Error("Restore the session before changing its settings.");
    if (input.modeId && !agent.availableModes?.some((m) => m.id === input.modeId))
      throw new Error("That permission mode is not available for this session.");
    const bin = await this.cli();
    const home = ["--home", paseoHome()];
    const applied: string[] = [];
    if (input.stop) {
      await this.run(bin, ["agent", "stop", agent.id, ...home]);
      applied.push("stopped");
    }
    if (input.title !== undefined) {
      // One `--name=` argument: a title starting with "-" is never read as an option.
      await this.run(bin, ["agent", "update", agent.id, `--name=${input.title}`, ...home]);
      applied.push("title");
    }
    if (input.thinkingOptionId) {
      await this.run(bin, ["agent", "update", agent.id, "--thinking", input.thinkingOptionId, ...home]);
      applied.push("reasoning");
    }
    if (input.modeId) {
      await this.run(bin, ["agent", "mode", agent.id, input.modeId, ...home]);
      applied.push("permissions");
    }
    return { applied };
  }
}
