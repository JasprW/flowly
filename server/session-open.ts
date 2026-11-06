import type { PaseoApi } from "@getpaseo/client";
import type { PluginSessionOpenRequest } from "@getpaseo/plugin/server";
import type { ToolServer } from "./tool-server";
import { logFailure } from "./error-report";

/**
 * The `before("agent.session_open")` hook: a Kanban-managed interactive
 * session gets its CLI environment and, at launch only, the `flowly` MCP
 * server (PASEO-SESSION-TOOLS-SPEC §4). Never throws: a failure here would
 * keep the session from opening, so it is logged and the request passes on.
 */
export async function openKanbanSession(
  request: PluginSessionOpenRequest,
  tools: Pick<ToolServer, "attach" | "sessionLaunch">,
  directory: string,
  paseo: PaseoApi,
): Promise<PluginSessionOpenRequest | void> {
  try {
    tools.attach(paseo);
    if (request.purpose !== "interactive") return;
    const launch = await tools.sessionLaunch(request.agentId, request.workspaceId, paseo);
    if (!launch) return;
    return {
      ...request,
      env: {
        ...request.env,
        FLOWLY_CONTEXT_FILE: launch.contextFile,
        FLOWLY_CLI: directory + "/flowly.mjs",
        FLOWLY_SKILL: directory + "/SKILL.md",
      },
      // Launch only: Paseo never saves it in the agent config.
      ...(launch.mcp ? { mcpServers: { ...request.mcpServers, flowly: launch.mcp } } : {}),
    };
  } catch (e) {
    logFailure("Kanban session tools unavailable:", e, request.agentId);
  }
}
