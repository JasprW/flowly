import type { PaseoApi } from "@getpaseo/client";

/** How long a background-work read may take before Flowly carries on without it. */
const READ_TIMEOUT_MS = 5000;

type Item = { kind: string; description: string | null; command?: string; startedAt: string };

/** One readable line per item: kind, then what it runs. */
export function describeWork(item: Item) {
  const what = (item.description || item.command || "").replace(/\s+/g, " ").trim().slice(0, 200);
  return `${item.kind || "other"}${what ? `: ${what}` : ""} (since ${item.startedAt})`;
}

/**
 * The background tasks still running in a session (Paseo 0.16 `backgroundWork.list`, PASEO-0.16-SPEC
 * §3.2), one line each, at most 20. Undefined on a host without background work, or when the read
 * fails or times out: callers then go on as before (AUTO-REVIEW-SPEC §4.4).
 */
export async function deliveringBackgroundWork(paseo: PaseoApi, agentId: string): Promise<string[] | undefined> {
  try {
    const work = (paseo.agents.ref(agentId) as { backgroundWork?: { list?: (o: { timeout: number }) => Promise<Item[]> } }).backgroundWork;
    if (typeof work?.list !== "function") return undefined;
    const items = await work.list({ timeout: READ_TIMEOUT_MS });
    return items.slice(0, 20).map(describeWork);
  } catch {
    return undefined;
  }
}
