import type { ArtifactRole } from "../../shared/model";

/**
 * A fingerprint is the hash of everything that matters to an agent, optionally followed by `~` and the hash of the
 * discussion alone (comments and reviews). Both parts exist because an input watches all of it, while an output
 * the agent delivered itself must not turn unread at its own new commits (CONNECTORS-SPEC §3.2).
 */
const SEP = "~";
export const withDiscussion = (content: string, discussion?: string) => (discussion ? `${content}${SEP}${discussion}` : content);
const parts = (fingerprint: string) => {
  const at = fingerprint.indexOf(SEP);
  return at < 0 ? { content: fingerprint, discussion: "" } : { content: fingerprint.slice(0, at), discussion: fingerprint.slice(at + 1) };
};

/** Whether the item changed since `seen` for an agent reading it as `role`; false when either side is unknown. */
export function fingerprintChanged(role: ArtifactRole, seen: string | undefined, current: string): boolean {
  if (!seen || !current) return false;
  const was = parts(seen);
  const now = parts(current);
  if (role === "output" && now.discussion) return !!was.discussion && was.discussion !== now.discussion;
  return was.content !== now.content;
}
