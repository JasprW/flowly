import { openLocalDaemon } from "./local-daemon";

const versionText = /^\d+\.\d+\.\d+(?:[-+.][\w.-]{1,20})?$/;

/**
 * COMPAT(sdk-paseo-version): the plugin SDK does not expose the host's version, so read it from
 * the `server_info` the daemon sends on a short-lived local connection (TELEMETRY-SPEC §11.3).
 * Only the version number is kept; "" when it is unavailable or not a plain version.
 */
export async function readPaseoVersion(home: string): Promise<string> {
  let client: Awaited<ReturnType<typeof openLocalDaemon>> | undefined;
  try {
    client = await openLocalDaemon(home, "flowly-telemetry", [], "");
    const version = client.getLastServerInfoMessage()?.version;
    return typeof version === "string" && versionText.test(version) ? version : "";
  } catch {
    return "";
  } finally {
    await client?.close().catch(() => undefined);
  }
}
