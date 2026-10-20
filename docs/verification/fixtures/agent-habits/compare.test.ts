import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { FLAG_MIN, habits, withMoveDetails } from "../../../../shared/agent-habits";
import { flowEntrySchema } from "../../../../shared/insights";

/**
 * Acceptance check for WORKFLOW-INSIGHTS-SPEC §12: the counters, run on a frozen copy of the
 * flow log, equal an independent hand count of the same frozen flow log (handcount.mjs, a second
 * implementation that imports nothing from the plugin).
 *
 *   mkdir /tmp/flowly-habits && cp ~/.paseo/plugin-data/flowly/board.json /tmp/flowly-habits/board.frozen.json
 *   cp ~/.paseo/plugin-data/flowly/flow/<projectId>.jsonl /tmp/flowly-habits/flow.frozen.jsonl
 *   HABITS_FROZEN_DIR=/tmp/flowly-habits HABITS_DAY=2026-10-20 HABITS_TZ=Asia/Shanghai npx vitest run docs/verification/fixtures/agent-habits
 *
 * Skipped unless HABITS_FROZEN_DIR is set (the copies hold private board data and are not committed).
 */
const dir = process.env.HABITS_FROZEN_DIR;
const day = process.env.HABITS_DAY ?? "";
const tz = process.env.HABITS_TZ ?? "UTC";

describe.skipIf(!dir)("counters equal the hand count of the frozen board", () => {
  const here = new URL(".", import.meta.url).pathname;
  const hand = () =>
    JSON.parse(execFileSync(process.execPath, [join(here, "handcount.mjs"), join(dir!, "flow.frozen.jsonl"), join(dir!, "board.frozen.json"), day, tz], { encoding: "utf8" }));
  const entries = () =>
    readFileSync(join(dir!, "flow.frozen.jsonl"), "utf8")
      .split("\n")
      .filter(Boolean)
      .map((line) => flowEntrySchema.parse(JSON.parse(line)));
  const board = () => JSON.parse(readFileSync(join(dir!, "board.frozen.json"), "utf8")) as { events: never[] };

  it("matches per day, in total and in the flags", () => {
    const expected = hand();
    const actual = habits(withMoveDetails(entries(), board().events), { day, tz, modelOf: () => "history" });
    expect(actual.days.map((d) => d.day)).toEqual(expected.days);
    for (const d of actual.days) {
      const { day: _day, ...counts } = d;
      expect({ day: d.day, ...counts }).toEqual({ day: d.day, ...expected.perDay[d.day] });
    }
    expect(actual.total).toEqual(expected.total);
    // Per model: turns with a stamped model keep it, the rest are grouped as "history" (modelOf above).
    const used = (c: Record<string, number>) => c.deliveries + c.results + c.questions + c.movesAny + c.ideas > 0;
    const wantModels = Object.fromEntries(Object.entries(expected.perModel as Record<string, Record<string, number>>).filter(([, c]) => used(c)));
    expect(Object.fromEntries(actual.models.map(({ model, ...counts }) => [model, counts]))).toEqual(wantModels);

    const flags = (list: { kind: string; miss: string; n: number; agentId?: string }[]) =>
      list.filter((f) => f.kind === "session").map((f) => `${f.agentId}:${f.miss}:${f.n}`).sort();
    const want = Object.entries(expected.perSession as Record<string, Record<string, number>>).flatMap(([agentId, c]) => [
      ...(c.deliveries + c.results >= FLAG_MIN && c.moves === 0 ? [`${agentId}:moves:${c.deliveries + c.results}`] : []),
      ...(c.deliveries >= FLAG_MIN && c.ideas === 0 ? [`${agentId}:ideas:${c.deliveries}`] : []),
    ]);
    expect(flags(actual.flags)).toEqual(want.sort());
    // eslint-disable-next-line no-console
    console.log(JSON.stringify({ day, tz, total: actual.total, today: actual.days.at(-1), sessionFlags: flags(actual.flags) }));
  });
});
