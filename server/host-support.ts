/**
 * Which Paseo 0.16 capabilities this host has (PASEO-0.16-SPEC §2). The plugin cannot read
 * `server_info.features`, so a capability is learned the first time it is used:
 *
 * - A, the contribution or method exists (`typeof handle.setMetadata === "function"`);
 * - B, the call is made and an older host's refusal ("Update the host to use metadata.") is recognized;
 * - C, the host's version, only when neither can tell (`paseoVersionAtLeast`).
 *
 * A "no" is kept until the plugin restarts (a daemon restart reloads it), so later calls go straight to the
 * 0.15 path. A refusal is an older host, not a failure: it is logged, never reported as `$exception`.
 * `server/background-agent.ts` keeps its own copy of this for background agents, which also knows the
 * 0.15 refusals of `background`.
 */
const known = new Map<string, boolean>();

/** The prefix of every refusal a 0.16 `DaemonClient` gives for a capability the daemon lacks. */
const REFUSAL = "Update the host to use ";

export function isHostRefusal(error: unknown) {
  const text = error instanceof Error ? error.message : String(error);
  return text.includes(REFUSAL);
}

/** true or false once learned, null before the first try. */
export function hostSupports(feature: string): boolean | null {
  return known.get(feature) ?? null;
}

/** Records what was learned; a "no" is logged once, as an older host (not a failure). */
export function learnHostSupport(feature: string, supported: boolean, reason = "") {
  const before = known.get(feature);
  known.set(feature, supported);
  if (!supported && before !== false) console.log(`Flowly: this Paseo has no ${feature}; using the older path${reason ? ` (${reason})` : ""}.`);
}

/** Tests only. */
export function resetHostSupport() {
  known.clear();
}

/**
 * Runs a call that needs `feature`. `run` returns `undefined` when the method is missing (method A);
 * an older host's refusal (method B) is caught. Both answer `{ ok: false }` and are remembered; any other
 * failure is thrown to the caller as its ordinary failure.
 */
export async function withHostFeature<T>(feature: string, run: () => Promise<T> | undefined): Promise<{ ok: true; value: T } | { ok: false }> {
  if (known.get(feature) === false) return { ok: false };
  let pending: Promise<T> | undefined;
  try {
    pending = run();
  } catch (error) {
    if (!isHostRefusal(error)) throw error;
    learnHostSupport(feature, false, error instanceof Error ? error.message : String(error));
    return { ok: false };
  }
  if (pending === undefined) {
    learnHostSupport(feature, false, "method missing");
    return { ok: false };
  }
  try {
    const value = await pending;
    known.set(feature, true);
    return { ok: true, value };
  } catch (error) {
    if (!isHostRefusal(error)) throw error;
    learnHostSupport(feature, false, error instanceof Error ? error.message : String(error));
    return { ok: false };
  }
}

/**
 * Method C: whether a plain host version (`server/paseo-version.ts`) is at least `min`. A pre-release counts as
 * its release (0.16.0-beta.2 is 0.16), since the betas carry the new API. null when the version is unknown.
 */
export function paseoVersionAtLeast(version: string, min: string): boolean | null {
  const parse = (text: string) => {
    const match = /^(\d+)\.(\d+)\.(\d+)/.exec(text);
    return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : null;
  };
  const have = parse(version),
    need = parse(min);
  if (!have || !need) return null;
  for (let i = 0; i < 3; i++) if (have[i] !== need[i]) return have[i] > need[i];
  return true;
}
