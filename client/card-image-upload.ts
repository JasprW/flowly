import type { OutgoingImage } from "../shared/composer";
import type { Task } from "../shared/model";

type Add = (input: {
  taskId: string;
  expectedRevision: number;
  image: { name: string; mimeType: OutgoingImage["mimeType"]; data: string };
  thumb?: OutgoingImage;
}) => Promise<{ task: Task }>;

/**
 * Uploads images to a card one by one after the card is saved
 * (CARD-IMAGES-SPEC §4.2), each with the revision the previous add returned.
 * A failed image is reported and the rest still go; nothing is retried.
 */
export async function uploadCardImages<Image extends OutgoingImage & { name: string }>(
  add: Add,
  taskId: string,
  revision: number,
  images: readonly Image[],
  thumbnail: (image: Image) => Promise<OutgoingImage | null>,
  describe: (error: unknown) => string,
) {
  const problems: string[] = [];
  let current = revision;
  for (const image of images) {
    try {
      const thumb = await thumbnail(image).catch(() => null);
      const { task } = await add({
        taskId,
        expectedRevision: current,
        image: { name: image.name, mimeType: image.mimeType, data: image.data },
        ...(thumb ? { thumb } : {}),
      });
      current = task.revision;
    } catch (e) {
      problems.push(describe(e));
    }
  }
  return { revision: current, problems };
}

/** Longest thumbnail edge (CARD-IMAGES-SPEC §4.2). */
export const thumbEdge = 320;

/** Thumbnail size for an image: longest edge at most `edge`, never upscaled. */
export function thumbDimensions(width: number, height: number, edge = thumbEdge) {
  if (!(width > 0 && height > 0)) return null;
  const scale = Math.min(1, edge / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}
