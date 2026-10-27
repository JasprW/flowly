import { expect, test } from "vitest";
import { paseoInvocation } from "./paseo-cli";

const desktop = "C:\\Users\\me\\AppData\\Local\\Programs\\Paseo\\resources\\bin\\paseo.cmd";
const npmShim = "C:\\Users\\me\\AppData\\Roaming\\npm\\paseo.cmd";

test("non-Windows platforms and non-shim files run the CLI directly", async () => {
  expect(await paseoInvocation("/Applications/Paseo.app/Contents/Resources/bin/paseo", ["agent", "stop", "a1"], "darwin")).toEqual({
    file: "/Applications/Paseo.app/Contents/Resources/bin/paseo",
    args: ["agent", "stop", "a1"],
  });
  expect(await paseoInvocation("C:\\tools\\paseo.exe", ["ls"], "win32")).toEqual({ file: "C:\\tools\\paseo.exe", args: ["ls"] });
});

test("the desktop app's paseo.cmd becomes Paseo.exe with the bundled runner, no shell", async () => {
  const seen: string[] = [];
  const run = await paseoInvocation(desktop, ["agent", "update", "a1", "--name=a & b %PATH%"], "win32", { KEEP: "1" }, "C:\\x\\Paseo.exe", async (p) => {
    seen.push(p);
    return true;
  });
  const resources = "C:\\Users\\me\\AppData\\Local\\Programs\\Paseo\\resources";
  expect(run.file).toBe("C:\\Users\\me\\AppData\\Local\\Programs\\Paseo\\Paseo.exe");
  expect(run.args).toEqual([
    "--disable-warning=DEP0040",
    `${resources}\\app.asar.unpacked\\dist\\daemon\\node-entrypoint-runner.js`,
    "node-script",
    `${resources}\\app.asar\\node_modules\\@getpaseo\\cli\\dist\\index.js`,
    "agent", "update", "a1", "--name=a & b %PATH%",
  ]);
  expect(run.env).toMatchObject({ KEEP: "1", ELECTRON_RUN_AS_NODE: "1", PASEO_NODE_ENV: "production", PASEO_DESKTOP_MANAGED: "1", PASEO_CLI: desktop });
  expect(seen).toContain(run.file);
});

test("npm's paseo.cmd runs the package's bin script with the daemon's runtime", async () => {
  const script = "C:\\Users\\me\\AppData\\Roaming\\npm\\node_modules\\@getpaseo\\cli\\bin\\paseo";
  const run = await paseoInvocation(npmShim, ["project", "create", "C:\\repo"], "win32", {}, "C:\\node\\node.exe", async (p) => p === script);
  expect(run).toEqual({ file: "C:\\node\\node.exe", args: [script, "project", "create", "C:\\repo"], env: { ELECTRON_RUN_AS_NODE: "1" } });
});

test("an unknown shim layout fails with a clear error instead of going through cmd.exe", async () => {
  await expect(paseoInvocation("D:\\odd\\paseo.cmd", [], "win32", {}, "node", async () => false)).rejects.toThrow(/Cannot start the Paseo CLI from paseo\.cmd/);
});
