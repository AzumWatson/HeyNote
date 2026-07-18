import type { ImageMedia } from "./types";
import { resolveOriginalImageUrl } from "./data/heybox";

const HEYBOX_ORIGIN = "https://www.xiaoheihe.cn";

export interface ImageActionTarget {
  image: ImageMedia;
  title: string;
  index: number;
  /** The full-size image that is already visible in the lightbox, when available. */
  resolvedUrl?: string;
}

interface InternalActionResponse {
  ok?: boolean;
  error?: string;
  dataUrl?: string;
}

function previewUrlFor(image: ImageMedia): string {
  return image.thumbnail || image.url;
}

async function bestAvailableImageUrl(target: ImageActionTarget): Promise<string> {
  if (target.resolvedUrl) return target.resolvedUrl;
  const preview = previewUrlFor(target.image);
  try {
    const resolved = await resolveOriginalImageUrl(preview);
    if (resolved !== preview) return resolved;
  } catch {
    // The logical image URL below is still a better fallback than aborting the action.
  }
  return target.image.url || preview;
}

export function imageActionFilename(target: ImageActionTarget, url: string): string {
  const safeTitle = target.title
    .normalize("NFKC")
    .replace(/[\\/:*?"<>|\u0000-\u001f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 72) || "HeyNote图片";
  const dataType = url.match(/^data:image\/([a-z0-9.+-]+)/i)?.[1]?.toLowerCase();
  let extension = dataType === "jpeg" ? "jpg" : dataType === "svg+xml" ? "svg" : dataType;
  if (!extension) {
    try {
      extension = new URL(url, HEYBOX_ORIGIN).pathname.match(/\.([a-z0-9]{2,5})$/i)?.[1]?.toLowerCase();
    } catch {
      extension = undefined;
    }
  }
  return `${safeTitle}-${target.index + 1}.${extension || "jpg"}`;
}

function dataUrlToBlob(dataUrl: string): Blob {
  const match = /^data:(image\/png);base64,([a-z0-9+/=]+)$/i.exec(dataUrl);
  if (!match) throw new Error("复制图片时收到的图片数据无效");
  const binary = atob(match[2]);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return new Blob([bytes], { type: match[1].toLowerCase() });
}

async function requestPngBlob(urlPromise: Promise<string>): Promise<Blob> {
  const url = await urlPromise;
  if (typeof chrome !== "undefined" && chrome.runtime?.id) {
    const response = await chrome.runtime.sendMessage({
      channel: "xiaoheishu-internal",
      operation: "copy-image",
      url
    }) as InternalActionResponse | undefined;
    if (!response?.ok || !response.dataUrl) {
      throw new Error(response?.error || "图片复制失败");
    }
    return dataUrlToBlob(response.dataUrl);
  }

  const response = await fetch(url, { credentials: "omit", referrerPolicy: "no-referrer" });
  if (!response.ok) throw new Error(`图片读取失败（HTTP ${response.status}）`);
  const source = await response.blob();
  const bitmap = await createImageBitmap(source);
  try {
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("浏览器无法处理这张图片");
    context.drawImage(bitmap, 0, 0);
    return await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("图片格式转换失败")), "image/png");
    });
  } finally {
    bitmap.close();
  }
}

/**
 * Starts Clipboard.write synchronously from the menu click. The image bytes can arrive
 * later, while the browser retains the user activation through ClipboardItem's promise.
 */
export function copyImageAction(target: ImageActionTarget): Promise<void> {
  if (!navigator.clipboard?.write || typeof ClipboardItem === "undefined") {
    return Promise.reject(new Error("当前浏览器不支持复制图片"));
  }
  let imageDataError: unknown;
  const pngBlob = requestPngBlob(bestAvailableImageUrl(target)).catch((error) => {
    imageDataError = error;
    throw error;
  });
  return navigator.clipboard.write([new ClipboardItem({ "image/png": pngBlob })]).catch((error) => {
    throw imageDataError || error;
  });
}

export async function downloadImageAction(target: ImageActionTarget): Promise<void> {
  const url = await bestAvailableImageUrl(target);
  const filename = imageActionFilename(target, url);
  if (typeof chrome !== "undefined" && chrome.runtime?.id) {
    const response = await chrome.runtime.sendMessage({
      channel: "xiaoheishu-internal",
      operation: "download-image",
      url,
      filename
    }) as InternalActionResponse | undefined;
    if (response?.ok) return;
    throw new Error(response?.error || "图片下载失败");
  }

  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.target = "_blank";
  anchor.rel = "noopener noreferrer";
  anchor.click();
}
