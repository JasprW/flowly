import type { PluginClientContext, PluginComposer, PluginComposerSelector } from "@getpaseo/plugin/client";

/*
 * Paseo 0.16 client capabilities (PASEO-0.16-SPEC §2, method A). The SDK modules come from the host at run time, so
 * on a 0.15 host the 0.16 contribution points and exports are simply missing: check before every use, never at
 * module load, and keep the 0.15 path when they are absent.
 */
type Composers = (selector: PluginComposerSelector) => readonly PluginComposer[];

/** `client.composers`, or null on a host without composer access. */
export function composersOf(client: Partial<Pick<PluginClientContext, "composers">> | null | undefined): Composers | null {
  const composers = client?.composers;
  return typeof composers === "function" ? (selector) => composers.call(client, selector) : null;
}
