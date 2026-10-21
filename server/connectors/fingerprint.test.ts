import { expect, test } from "vitest";
import { fingerprintChanged, withDiscussion } from "./fingerprint";

test("a fingerprint is the whole-content hash, plus a discussion hash where the provider has one", () => {
  expect(withDiscussion("aaaa", "dddd")).toBe("aaaa~dddd");
  expect(withDiscussion("aaaa")).toBe("aaaa");
});

test("an input is changed by any content change; fingerprints from before the discussion part still compare", () => {
  expect(fingerprintChanged("input", "aaaa", "aaaa~dddd")).toBe(false);
  expect(fingerprintChanged("input", "aaaa~dddd", "bbbb~dddd")).toBe(true);
  expect(fingerprintChanged("input", "aaaa~dddd", "aaaa~dddd")).toBe(false);
});

test("an output is changed by new comments or reviews, not by new commits or an edited description", () => {
  expect(fingerprintChanged("output", "aaaa~dddd", "bbbb~dddd")).toBe(false);
  expect(fingerprintChanged("output", "aaaa~dddd", "aaaa~eeee")).toBe(true);
});

test("an output has no baseline to compare when the last read predates the discussion part; providers without one compare the whole content", () => {
  expect(fingerprintChanged("output", "aaaa", "bbbb~dddd")).toBe(false);
  expect(fingerprintChanged("output", "aaaa", "bbbb")).toBe(true);
  expect(fingerprintChanged("output", "", "bbbb")).toBe(false);
  expect(fingerprintChanged("input", "aaaa", "")).toBe(false);
});
