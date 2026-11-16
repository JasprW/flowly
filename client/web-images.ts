import { Platform } from "react-native";
import { imageMimeTypes, maxImageBytes, maxImages, type OutgoingImage } from "../shared/composer";
import { t } from "../shared/i18n";
import { thumbDimensions } from "./card-image-upload";

/**
 * Web-only image input for the session composer (paste, drag-and-drop, file
 * picker). The plugin host exposes no image picker module, so on web this is
 * the one place that touches browser events; nothing is rendered as HTML.
 * Native clients have no plugin-accessible picker: `imageInputSupported` is false.
 */
export type Attachment = OutgoingImage & { id: string; uri: string; name: string };

type BrowserFile = { name: string; type: string; size: number };
type FileList = ArrayLike<BrowserFile>;
type Transfer = { files?: FileList; items?: ArrayLike<{ kind: string; type: string; getAsFile(): BrowserFile | null }> };
type Listener = (event: { preventDefault(): void; clipboardData?: Transfer; dataTransfer?: Transfer & { dropEffect?: string } }) => void;
type EventNode = { addEventListener(type: string, listener: Listener): void; removeEventListener(type: string, listener: Listener): void };

const browser = globalThis as unknown as {
  document?: { createElement(tag: "input"): BrowserInput; createElement(tag: "canvas"): BrowserCanvas };
  Image?: new () => BrowserImage;
  FileReader?: new () => { onload: null | (() => void); onerror: null | (() => void); result: unknown; readAsDataURL(file: BrowserFile): void };
};
type BrowserImage = { onload: null | (() => void); onerror: null | (() => void); src: string; naturalWidth: number; naturalHeight: number };
type BrowserCanvas = {
  width: number;
  height: number;
  getContext(kind: "2d"): { drawImage(image: BrowserImage, x: number, y: number, w: number, h: number): void } | null;
  toDataURL(type: string, quality?: number): string;
};
type BrowserInput = {
  type: string;
  accept: string;
  multiple: boolean;
  files: FileList | null;
  onchange: null | (() => void);
  click(): void;
};

export const imageInputSupported = Platform.OS === "web" && !!browser.document && !!browser.FileReader;

let sequence = 0;

function readFile(file: BrowserFile): Promise<Attachment> {
  return new Promise((resolve, reject) => {
    const reader = new browser.FileReader!();
    reader.onerror = () => reject(new Error(t("Could not read {name}.", { name: file.name || t("the image") })));
    reader.onload = () => {
      const uri = String(reader.result || "");
      const comma = uri.indexOf(",");
      resolve({
        id: `image-${Date.now()}-${++sequence}`,
        uri,
        name: file.name || t("Pasted image"),
        data: uri.slice(comma + 1),
        mimeType: file.type as OutgoingImage["mimeType"],
      });
    };
    reader.readAsDataURL(file);
  });
}

/**
 * Reads image files, keeping at most `room` of them. Returns readable
 * reasons for anything skipped (type, size, count).
 */
export async function readImages(files: readonly BrowserFile[], room: number, tooMany = t("At most {maxImages} images per message.", { maxImages })) {
  const problems: string[] = [];
  const accepted: BrowserFile[] = [];
  for (const file of files) {
    if (!(imageMimeTypes as readonly string[]).includes(file.type)) problems.push(t("{name} is not a PNG, JPEG, GIF or WebP image.", { name: file.name || t("File") }));
    else if (file.size > maxImageBytes) problems.push(t("{name} is larger than 5 MB.", { name: file.name || t("Image") }));
    else if (accepted.length >= room) problems.push(tooMany);
    else accepted.push(file);
  }
  const images = await Promise.all(accepted.map(readFile));
  return { images, problems: [...new Set(problems)] };
}

function imageFiles(transfer: Transfer | undefined): BrowserFile[] {
  if (!transfer) return [];
  const fromItems = Array.from(transfer.items || [])
    .filter((item) => item.kind === "file")
    .map((item) => item.getAsFile())
    .filter((file): file is BrowserFile => !!file);
  const files = fromItems.length ? fromItems : Array.from(transfer.files || []);
  return files.filter((file) => file.type.startsWith("image/"));
}

/** Opens the browser's file chooser for images. Resolves empty when cancelled. */
export function pickImageFiles(): Promise<BrowserFile[]> {
  return new Promise((resolve) => {
    if (!imageInputSupported) return resolve([]);
    const input = browser.document!.createElement("input");
    input.type = "file";
    input.accept = imageMimeTypes.join(",");
    input.multiple = true;
    input.onchange = () => resolve(Array.from(input.files || []));
    input.click();
  });
}

/**
 * Listens for pasted and dropped images on a rendered composer node. Text
 * pastes and non-image drops keep their default behaviour. Returns cleanup.
 */
export function listenForImages(node: unknown, onFiles: (files: BrowserFile[]) => void): () => void {
  const target = node as Partial<EventNode> | null;
  if (!imageInputSupported || typeof target?.addEventListener !== "function") return () => undefined;
  const paste: Listener = (event) => {
    const files = imageFiles(event.clipboardData);
    if (!files.length) return;
    event.preventDefault();
    onFiles(files);
  };
  const over: Listener = (event) => {
    if (!imageFiles(event.dataTransfer).length && !Array.from(event.dataTransfer?.items || []).some((i) => i.kind === "file")) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
  };
  const drop: Listener = (event) => {
    const files = imageFiles(event.dataTransfer);
    if (!files.length) return;
    event.preventDefault();
    onFiles(files);
  };
  target.addEventListener!("paste", paste);
  target.addEventListener!("dragover", over);
  target.addEventListener!("drop", drop);
  return () => {
    target.removeEventListener?.("paste", paste);
    target.removeEventListener?.("dragover", over);
    target.removeEventListener?.("drop", drop);
  };
}

/**
 * A small WebP (else JPEG) copy of an attachment drawn on a canvas, for card
 * image thumbnails. Resolves null when the browser cannot make one; the
 * daemon then serves the full image instead.
 */
export function makeThumbnail(attachment: Pick<Attachment, "uri">): Promise<OutgoingImage | null> {
  return new Promise((resolve) => {
    if (!imageInputSupported || !browser.Image) return resolve(null);
    const image = new browser.Image();
    image.onerror = () => resolve(null);
    image.onload = () => {
      try {
        const size = thumbDimensions(image.naturalWidth, image.naturalHeight);
        const canvas = browser.document!.createElement("canvas");
        const context = size && canvas.getContext("2d");
        if (!size || !context) return resolve(null);
        canvas.width = size.width;
        canvas.height = size.height;
        context.drawImage(image, 0, 0, size.width, size.height);
        let uri = canvas.toDataURL("image/webp", 0.8);
        // Browsers without WebP encoding return PNG.
        if (!uri.startsWith("data:image/webp")) uri = canvas.toDataURL("image/jpeg", 0.8);
        const mimeType = uri.slice(5, uri.indexOf(";")) as OutgoingImage["mimeType"];
        const data = uri.slice(uri.indexOf(",") + 1);
        resolve((imageMimeTypes as readonly string[]).includes(mimeType) && data ? { mimeType, data } : null);
      } catch {
        resolve(null);
      }
    };
    image.src = attachment.uri;
  });
}
