import { afterEach, describe, expect, test } from "vitest";
import { fixtures } from "./fake";

/**
 * Live check against a real Notion workspace (CONNECTORS-SPEC §16 acceptance).
 * Skipped unless NOTION_API_TOKEN is set, so CI and the normal suite never call out:
 *
 *   NOTION_API_TOKEN=… npx vitest run server/connectors/notion.live.test.ts
 */

const token = process.env.NOTION_API_TOKEN || "";
const base = "https://www.notion.so";

const env = fixtures();
afterEach(() => env.cleanup());

describe.skipIf(!token)("Notion live workspace", () => {
  const connect = async () => {
    const service = await env.service(fetch);
    const connection = await service.save({ provider: "notion", baseUrl: base, secret: token });
    return { service, connection };
  };

  test("the token verifies and returns a connected account without failing auth", async () => {
    const { connection } = await connect();
    expect(connection.account.length).toBeGreaterThan(0);
    expect(connection.authFailed).toBe(false);
  });

  test("recent pages, URL recognition, keyword search, and full Markdown detail work end to end", async () => {
    const { service, connection } = await connect();
    const recent = await service.search({ connectionId: connection.id, query: "" });
    expect(recent.results.length).toBeGreaterThan(0);
    const sample = recent.results[0]!;
    expect(sample.itemType).toBe("page");
    expect(sample.key).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);

    const recognized = await service.recognize(sample.url);
    expect(recognized).not.toBeNull();
    expect(recognized!.external.key).toBe(sample.key);

    const queryWord = (sample.summary.match(/[A-Za-z0-9\u4e00-\u9fff]{2,}/) || ["Notion"])[0]!;
    const searched = await service.search({ connectionId: connection.id, query: queryWord });
    expect(searched.results.length).toBeGreaterThan(0);

    const detail = await service.detail({ connectionId: connection.id, key: sample.key, itemType: "page" }, true);
    expect(detail.markdown).toContain(`# ${sample.summary}`);
    expect(detail.markdown).toContain("## Content");
    expect(detail.fingerprint).toBeTruthy();
    expect((await service.list())[0]!.authFailed).toBe(false);
    console.log(
      JSON.stringify({
        recentCount: recent.results.length,
        withContainer: recent.results.filter((r) => Boolean(r.container)).length,
        withStatus: recent.results.filter((r) => Boolean(r.status)).length,
        sampleUrlHost: new URL(sample.url).host,
        searchCount: searched.results.length,
        markdownBytes: Buffer.byteLength(detail.markdown),
        truncated: detail.truncated,
      }),
    );
  });
});
