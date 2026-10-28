import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";

/**
 * phase B: `insights.guardrails` (GUARDRAILS-SPEC §7.5) is defined in shared/rpc.ts on the phase B branch; replace this
 * stub with that definition at the merge and delete the file. Until then the daemon does not answer it and the
 * Insights line stays hidden.
 */
export const readGuardrailLedger = defineRpc({
  name: "insights.guardrails",
  input: z.strictObject({ projectId: z.string().min(1).max(200), tz: z.string().max(100) }),
  output: z.object({
    deliveries: z.number(),
    reviewed: z.number(),
    firstPass: z.number(),
    judged: z.number(),
    misfires: z.number(),
    changes: z.object({ learned: z.number(), widened: z.number(), revived: z.number(), retired: z.number(), observing: z.number() }),
  }),
});
