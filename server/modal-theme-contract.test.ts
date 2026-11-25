import { readdirSync, readFileSync } from "node:fs";
import { expect, test } from "vitest";

/**
 * Node-side static contract over `client/*.tsx`: keeps `client/` free of Node
 * imports while ensuring no screen bypasses `./modal` or renders a React Native
 * `Modal` portal without bridging `Theme.Provider`.
 */
test("every client modal routes host Modal through ./modal and bridges Theme.Provider inside React Native Modal", () => {
  const clientDir = new URL("../client/", import.meta.url);
  const files = readdirSync(clientDir).filter((name) => name.endsWith(".tsx") && !name.endsWith(".test.tsx"));
  const directHostModalImports: string[] = [];
  const unbridgedNativeModals: string[] = [];
  for (const name of files) {
    const source = readFileSync(new URL(name, clientDir), "utf8");
    if (name !== "modal.tsx" && /import\s*\{[^}]*\bModal\b[^}]*\}\s*from\s*["']@getpaseo\/plugin\/client\/react-native["']/.test(source)) {
      directHostModalImports.push(name);
    }
    const rnModalImport = /import\s*\{[^}]*\bModal(?:\s+as\s+(\w+))?[^}]*\}\s*from\s*["']react-native["']/.exec(source);
    if (rnModalImport) {
      const localName = rnModalImport[1] || "Modal";
      const tag = new RegExp(`<${localName}\\b[^>]*>([\\s\\S]*?)<\\/${localName}>`, "g");
      let match: RegExpExecArray | null;
      while ((match = tag.exec(source))) {
        if (!/<Theme\.Provider\b/.test(match[1]!)) unbridgedNativeModals.push(name);
      }
    }
  }
  expect(directHostModalImports).toEqual([]);
  expect(unbridgedNativeModals).toEqual([]);
});
