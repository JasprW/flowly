import type { PaseoApi } from "@getpaseo/client";
import { readFile, stat, realpath } from "node:fs/promises";
import { extname } from "node:path";
import type { BoardStore } from "./store";
import { displayableImage, localImagePath } from "../shared/images";

const MAX_BYTES = 8 * 1024 * 1024;
const mime: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
};

/**
 * Serves images referenced by a card session's own transcript (pasted images
 * live as local paths on the daemon machine, which clients cannot read). Not a
 * general file reader: the path must be an image file referenced in that
 * session's recent timeline, and the session must belong to the card.
 */
export class SessionImageService {
  private cache = new Map<string, { at: number; text: string }>();
  constructor(readonly store: BoardStore) {}

  private async transcript(agentId: string, paseo: PaseoApi) {
    const hit = this.cache.get(agentId);
    if (hit && Date.now() - hit.at < 15000) return hit.text;
    const response = await paseo.agents.ref(agentId).timeline.refetch({ direction: "tail", limit: 500, projection: "projected" });
    const text = JSON.stringify(response.entries || []);
    this.cache.set(agentId, { at: Date.now(), text });
    return text;
  }

  async read(input: { taskId: string; agentId: string; src: string }, paseo: PaseoApi) {
    const path = localImagePath(input.src);
    if (!path || !displayableImage(input.src)) throw new Error("Not a local image reference.");
    const board = await this.store.read();
    const task = board.tasks.find((t) => t.id === input.taskId);
    if (!task) throw new Error("Task not found.");
    const agent = (await paseo.agents.ref(input.agentId).refresh())?.agent;
    if (!agent || agent.workspaceId !== task.workspaceId)
      throw new Error("Session is unavailable or belongs to a different workspace.");
    // JSON-escaped form is what appears inside the serialized timeline.
    if (!(await this.transcript(input.agentId, paseo)).includes(JSON.stringify(path).slice(1, -1)))
      throw new Error("That image is not part of this session.");
    // Screenshots are often temporary files that are gone by the time the timeline is read.
    const real = await realpath(path).catch((e: NodeJS.ErrnoException) => {
      throw e.code === "ENOENT" || e.code === "ENOTDIR" ? new Error("The image file no longer exists.") : e;
    });
    const type = mime[extname(real).toLowerCase()];
    if (!type) throw new Error("Unsupported image type.");
    const info = await stat(real);
    if (!info.isFile()) throw new Error("Not a file.");
    if (info.size > MAX_BYTES) throw new Error("Image is larger than 8 MB.");
    return { dataUri: `data:${type};base64,${(await readFile(real)).toString("base64")}` };
  }
}
