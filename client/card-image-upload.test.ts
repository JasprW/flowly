import { expect, test } from "vitest";
import { thumbDimensions, uploadCardImages } from "./card-image-upload";
import type { Task } from "../shared/model";

const image = (name: string) => ({ name, mimeType: "image/png" as const, data: "AAAA" });

test("uploads chain the revision each add returns and keep going after a failure", async () => {
  const calls: { name: string; expectedRevision: number; thumb: boolean }[] = [];
  let revision = 4;
  const add = async (input: Parameters<Parameters<typeof uploadCardImages>[0]>[0]) => {
    calls.push({ name: input.image.name, expectedRevision: input.expectedRevision, thumb: !!input.thumb });
    if (input.image.name === "bad.png") throw new Error("bad.png is larger than 5 MB.");
    return { task: { revision: ++revision } as Task };
  };
  const thumbnail = async (x: { name: string }) => (x.name === "a.png" ? { mimeType: "image/webp" as const, data: "BB" } : null);
  const result = await uploadCardImages(add, "t", 4, [image("a.png"), image("bad.png"), image("c.png")], thumbnail, (e) => (e as Error).message);
  expect(calls).toEqual([
    { name: "a.png", expectedRevision: 4, thumb: true },
    { name: "bad.png", expectedRevision: 5, thumb: false },
    { name: "c.png", expectedRevision: 5, thumb: false },
  ]);
  expect(result).toEqual({ revision: 6, problems: ["bad.png is larger than 5 MB."] });
});

test("a thumbnail that fails is left out, the image still goes", async () => {
  const seen: boolean[] = [];
  const add = async (input: { thumb?: unknown }) => {
    seen.push(!!input.thumb);
    return { task: { revision: 2 } as Task };
  };
  const result = await uploadCardImages(add, "t", 1, [image("a.png")], () => Promise.reject(new Error("no canvas")), String);
  expect(seen).toEqual([false]);
  expect(result.problems).toEqual([]);
});

test("thumbnails keep the aspect ratio with the long edge at most 320 and never upscale", () => {
  expect(thumbDimensions(1600, 900)).toEqual({ width: 320, height: 180 });
  expect(thumbDimensions(900, 1600)).toEqual({ width: 180, height: 320 });
  expect(thumbDimensions(100, 50)).toEqual({ width: 100, height: 50 });
  expect(thumbDimensions(5000, 1)).toEqual({ width: 320, height: 1 });
  expect(thumbDimensions(0, 10)).toBeNull();
});
