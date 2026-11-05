import { describe, expect, test } from "vitest";
import { repoVerdict } from "./repos";

/** CONNECTORS-SPEC §4.3: a picked GitHub/GitLab item's repository vs a project's repositories. */
describe("repoVerdict", () => {
  test("a repository of the project is a member, whatever the case", () => {
    expect(repoVerdict("acme/web", ["acme/web", "other/app"])).toBe("member");
    expect(repoVerdict("Acme/Web", ["acme/web"])).toBe("member");
    // GitLab paths keep their nested groups.
    expect(repoVerdict("group/sub/proj", ["group/sub/proj"])).toBe("member");
  });

  test("a repository the project does not have is foreign", () => {
    expect(repoVerdict("hybrid/paseo-sync", ["jasprw/flowly"])).toBe("foreign");
    expect(repoVerdict("acme/web ", ["acme/other"])).toBe("foreign");
  });

  test("an empty container or an empty repository list cannot be judged and never warns", () => {
    expect(repoVerdict("", ["acme/web"])).toBe("unknown");
    expect(repoVerdict("   ", ["acme/web"])).toBe("unknown");
    expect(repoVerdict("acme/web", [])).toBe("unknown");
  });
});
