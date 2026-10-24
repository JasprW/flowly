import { z } from "zod";
import { connectorProviderSchema } from "../../shared/connectors";

/**
 * The only way connectors reach a service (CONNECTORS-SPEC §4.2): GET
 * requests to a fixed list of read endpoints, no redirects, a timeout, and a
 * login page treated as a refused token. Nothing here can write.
 */

export type ExternalErrorCode = "EXTERNAL_AUTH" | "EXTERNAL_NOT_FOUND" | "EXTERNAL_UNAVAILABLE" | "EXTERNAL_INVALID";
export class ExternalError extends Error {
  constructor(
    readonly code: ExternalErrorCode,
    message: string,
    /** Seconds the service asked us to wait (429, rate limits). */
    readonly retryAfter?: number,
  ) {
    super(message);
  }
}

export const storedConnection = z.object({
  id: z.string(),
  provider: connectorProviderSchema,
  name: z.string(),
  baseUrl: z.string(),
  email: z.string(),
  secret: z.string(),
  account: z.string(),
  /** GitHub/GitLab username of the token, for "my" searches; absent in older records. */
  login: z.string().default(""),
  verifiedAt: z.string(),
  authFailed: z.boolean(),
});
export type StoredConnection = z.infer<typeof storedConnection>;

export type Fetch = typeof fetch;

const MAX_BODY = 16 * 1024 * 1024;

export type HttpOptions = {
  /** API root without a trailing slash; paths are appended to it. */
  root: string;
  /** Path patterns (relative to `root`, before the query) a request may use. */
  endpoints: readonly RegExp[];
  /**
   * Read-only query endpoints that take their query in a POST body (Azure DevOps
   * WIQL). Only these paths may be POSTed to; anything else is refused.
   */
  queryEndpoints?: readonly RegExp[];
  headers: Record<string, string>;
  /** The service's name in messages: "Jira", "GitLab". */
  label: string;
  fetchImpl: Fetch;
  timeoutMs?: number;
  /** Provider rules for a failed response; undefined falls back to the shared mapping. */
  failure?(response: Response, body: string, path: string): ExternalError | undefined;
};

export class ReadOnlyHttp {
  constructor(readonly options: HttpOptions) {}
  get<T>(path: string, params: Record<string, string | number | undefined> = {}) {
    return this.send<T>("GET", path, params);
  }
  /** A read-only query sent as JSON (only the `queryEndpoints`). */
  query<T>(path: string, body: unknown, params: Record<string, string | number | undefined> = {}) {
    return this.send<T>("POST", path, params, body);
  }
  private async send<T>(method: "GET" | "POST", path: string, params: Record<string, string | number | undefined>, body?: unknown): Promise<{ data: T; headers: Headers }> {
    const { root, label } = this.options;
    const endpoints = method === "GET" ? this.options.endpoints : this.options.queryEndpoints || [];
    if (!endpoints.some((pattern) => pattern.test(path))) throw new ExternalError("EXTERNAL_INVALID", `Refused a request outside the read-only endpoints: ${path}`);
    const url = new URL(root + path);
    for (const [k, v] of Object.entries(params)) if (v !== undefined) url.searchParams.set(k, String(v));
    const abort = new AbortController();
    // The timeout covers the body too: a server that sends headers and stalls must not hang the caller.
    const timer = setTimeout(() => abort.abort(), this.options.timeoutMs ?? 15000);
    const unreachable = (error: unknown) =>
      new ExternalError("EXTERNAL_UNAVAILABLE", `${label} is unreachable (${error instanceof Error ? error.name : "network error"}).`);
    try {
      let response: Response;
      try {
        // Redirects are never followed (the token must not go elsewhere); a moved item answers 3xx.
        response = await this.options.fetchImpl(url, {
          method,
          headers: { Accept: "application/json", ...(method === "POST" ? { "Content-Type": "application/json" } : {}), ...this.options.headers },
          ...(method === "POST" ? { body: JSON.stringify(body) } : {}),
          redirect: "manual",
          signal: abort.signal,
        });
      } catch (error) {
        throw unreachable(error);
      }
      if (response.type === "opaqueredirect" || (response.status >= 300 && response.status < 400))
        throw new ExternalError("EXTERNAL_NOT_FOUND", `${label} says this moved (HTTP ${response.status || 3}xx), e.g. a renamed repository. Add its current link instead.`);
      if (!response.ok) {
        const text = await response.text().catch(() => "");
        throw this.options.failure?.(response, text, path) || failure(response, text, label);
      }
      // A login page instead of JSON means the token was not accepted.
      if (!(response.headers.get("content-type") || "").includes("json"))
        throw new ExternalError("EXTERNAL_AUTH", `${label} answered with a login page. Check the address and token.`);
      const size = Number(response.headers.get("content-length"));
      if (Number.isFinite(size) && size > MAX_BODY) throw new ExternalError("EXTERNAL_INVALID", `${label} sent a response too large to read (${Math.round(size / 1e6)} MB).`);
      const data = (await response.json().catch((error) => {
        throw abort.signal.aborted ? unreachable(error) : new ExternalError("EXTERNAL_INVALID", `${label} sent a response Flowly could not read.`);
      })) as T;
      return { data, headers: response.headers };
    } finally {
      clearTimeout(timer);
    }
  }
}

export const retryAfter = (headers: Headers) => {
  const seconds = Number(headers.get("retry-after"));
  return Number.isFinite(seconds) && seconds > 0 ? seconds : undefined;
};

function failure(response: Response, body: string, label: string): ExternalError {
  const status = response.status;
  if (status === 401 || status === 403) return new ExternalError("EXTERNAL_AUTH", `${label} refused the token. Update the connection in Flowly settings.`);
  if (status === 404) return new ExternalError("EXTERNAL_NOT_FOUND", "Not found, or this account can't see it.");
  if (status === 429 || status >= 500) return new ExternalError("EXTERNAL_UNAVAILABLE", `${label} is busy or unavailable (HTTP ${status}).`, retryAfter(response.headers));
  return new ExternalError("EXTERNAL_INVALID", `${label} rejected the request (HTTP ${status})${messageOf(body)}.`);
}

/** The first error message of a JSON error body, for the user. */
export function messageOf(body: string) {
  try {
    const parsed = JSON.parse(body) as { errorMessages?: string[]; message?: string; error?: string };
    const first = parsed.errorMessages?.[0] || parsed.message || parsed.error;
    return typeof first === "string" && first ? `: ${first.slice(0, 200)}` : "";
  } catch {
    return "";
  }
}

/** Runs `run` over `items` with at most `limit` at a time, keeping order. */
export async function mapLimit<T, R>(items: readonly T[], limit: number, run: (item: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const index = next++;
      out[index] = await run(items[index]!);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

/** Cuts Markdown to `limit` bytes with a pointer to the rest. */
export function cut(text: string, url: string, limit: number) {
  if (Buffer.byteLength(text) <= limit) return { markdown: text, truncated: false };
  let part = text.slice(0, limit);
  while (Buffer.byteLength(part) > limit - 200) part = part.slice(0, -200);
  return { markdown: `${part}\n\n…(truncated; read the rest at ${url})`, truncated: true };
}
