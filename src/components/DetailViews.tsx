import {
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type RefObject
} from "react";
import type {
  CommentItem,
  ContentBlock,
  FavoriteFolder,
  FeedPost,
  ImageMedia,
  PostDetail,
  VideoMedia
} from "../types";
import { resolveOriginalImageUrl } from "../data/heybox";
import { heyboxEmojiFromCode, heyboxEmojiFromId, heyboxEmojiSprite } from "../data/heybox-emoji";
import { formatCount } from "../format";
import { CommentIcon, StarIcon, ThumbUpIcon } from "../icons";
import type { ImageActionTarget } from "../image-actions";
import { GeneratedTextCover } from "./GeneratedTextCover";
import { HeyboxText } from "./HeyboxText";
import { VideoPlayer } from "./VideoPlayer";
import { IMAGE_CONTEXT_MENU_OPEN_ATTRIBUTE } from "./ImageContextMenu";

export interface DetailViewsProps {
  detail: PostDetail;
  error?: string;
  onClose: () => void;
  onToggleFollow?: () => void;
  followLoading?: boolean;
  onTogglePostLike?: () => void;
  onTogglePostFavorite?: () => void;
  postActionLoading?: "like" | "favorite";
  favoriteFolders?: FavoriteFolder[];
  favoritePickerOpen?: boolean;
  onSelectFavoriteFolder?: (folderId: string) => void;
  onCloseFavoritePicker?: () => void;
  onToggleCommentLike?: (commentId: string) => void;
  likingCommentIds?: ReadonlySet<string>;
  onRetry?: () => void;
  onLoadMoreComments?: () => void;
  loadingMoreComments?: boolean;
  onLoadMoreReplies?: (rootCommentId: string) => void;
  loadingReplyIds?: ReadonlySet<string>;
  onImageContextMenu: ImageContextMenuHandler;
}

interface ImageLightboxState {
  images: ImageMedia[];
  activeIndex: number;
  title: string;
}

type OpenImageLightbox = (images: ImageMedia[], activeIndex: number, title: string) => void;
type ImageContextMenuHandler = (event: ReactMouseEvent<HTMLElement>, target: ImageActionTarget) => void;

const ALLOWED_TAGS = new Set([
  "A", "B", "BLOCKQUOTE", "BR", "CODE", "DEL", "DIV", "EM", "FIGCAPTION",
  "FIGURE", "H1", "H2", "H3", "H4", "H5", "H6", "HR", "I", "IMG", "LI",
  "OL", "P", "PRE", "S", "SMALL", "SPAN", "STRONG", "SUB", "SUP", "U", "UL"
]);
const DROP_WITH_CONTENT = new Set(["IFRAME", "OBJECT", "SCRIPT", "STYLE", "TEMPLATE"]);
const HEYBOX_ORIGIN = "https://www.xiaoheihe.cn";

function isSafeRemoteUrl(value: string): boolean {
  try {
    const parsed = new URL(value, HEYBOX_ORIGIN);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

function resolvedRemoteUrl(value: string): string {
  return new URL(value, HEYBOX_ORIGIN).href;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

/** Sanitizes article HTML before it reaches React's HTML renderer. */
export function sanitizeRichHtml(html: string): string {
  if (typeof DOMParser === "undefined") return escapeHtml(html);
  const documentNode = new DOMParser().parseFromString(html, "text/html");

  function makeEmojiElement(emoji: NonNullable<ReturnType<typeof heyboxEmojiFromCode>>): HTMLSpanElement {
    const element = documentNode.createElement("span");
    const sprite = heyboxEmojiSprite(emoji);
    element.className = `heybox-inline-emoji post-rich-text__emoji hb-emoji hb-emoji-${emoji.group} hb-emoji-${emoji.group}_${emoji.id}`;
    element.dataset.emoji = emoji.code;
    element.setAttribute("role", "img");
    element.setAttribute("aria-label", `[${emoji.label}]`);
    element.setAttribute("title", emoji.label);
    element.style.width = "20px";
    element.style.height = "20px";
    element.style.backgroundImage = sprite.backgroundImage;
    element.style.backgroundSize = sprite.backgroundSize;
    element.style.backgroundPosition = sprite.backgroundPosition;
    return element;
  }

  function replaceEmojiTokens(node: Text) {
    const value = node.nodeValue ?? "";
    const pattern = /\[([^\]_]+)_([^\]_]+)\]/g;
    const fragment = documentNode.createDocumentFragment();
    let cursor = 0;
    let replaced = false;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(value))) {
      const emoji = heyboxEmojiFromCode(`${match[1]}_${match[2]}`);
      if (!emoji) continue;
      fragment.append(value.slice(cursor, match.index), makeEmojiElement(emoji));
      cursor = match.index + match[0].length;
      replaced = true;
    }
    if (!replaced) return;
    fragment.append(value.slice(cursor));
    node.replaceWith(fragment);
  }

  function safeImageSource(node: Element, attributes: readonly string[]): string | null {
    for (const attribute of attributes) {
      const raw = node.getAttribute(attribute)?.trim();
      if (!raw) continue;
      const candidates = [raw];
      if (raw.startsWith("{")) {
        try {
          const themed = JSON.parse(raw) as Record<string, unknown>;
          candidates.unshift(...[themed.light, themed.dark].filter((value): value is string => typeof value === "string"));
        } catch {
          // Invalid theme metadata is ignored; a later safe source may still work.
        }
      }
      const safe = candidates.find(isSafeRemoteUrl);
      if (safe) return safe;
    }
    return null;
  }

  function safeImageDimension(node: Element, dataAttribute: string, attribute: string): string | null {
    const raw = node.getAttribute(dataAttribute) || node.getAttribute(attribute);
    const value = Number(raw);
    return Number.isFinite(value) && value > 0 && value <= 100_000 ? String(Math.round(value)) : null;
  }

  function clean(parent: ParentNode) {
    Array.from(parent.childNodes).forEach((node) => {
      if (node.nodeType === Node.COMMENT_NODE) {
        node.parentNode?.removeChild(node);
        return;
      }
      if (node instanceof Text) {
        replaceEmojiTokens(node);
        return;
      }
      if (!(node instanceof Element)) return;

      if (DROP_WITH_CONTENT.has(node.tagName)) {
        node.remove();
        return;
      }
      if (!ALLOWED_TAGS.has(node.tagName)) {
        clean(node);
        node.replaceWith(...Array.from(node.childNodes));
        return;
      }

      const dataEmoji = node.getAttribute("data-emoji");
      const classEmoji = (node.getAttribute("class") ?? "").match(/(?:^|\s)hb-emoji-([a-z0-9-]+)_([0-9]+)(?:\s|$)/i);
      const emoji = (dataEmoji ? heyboxEmojiFromCode(dataEmoji) : undefined)
        || (classEmoji ? heyboxEmojiFromId(classEmoji[1], classEmoji[2]) : undefined);
      if (node.tagName === "SPAN" && emoji) {
        node.replaceWith(makeEmojiElement(emoji));
        return;
      }

      const href = node.tagName === "A" ? node.getAttribute("href") : null;
      const source = node.tagName === "IMG"
        ? safeImageSource(node, ["data-thumbnail", "data-thumb", "src", "data-src", "data-url", "data-original"])
        : null;
      const fullSource = node.tagName === "IMG"
        ? safeImageSource(node, ["data-full-src", "data-original", "data-url", "data-src", "src"])
        : null;
      const alt = node.tagName === "IMG" ? node.getAttribute("alt") : null;
      const width = node.tagName === "IMG" ? safeImageDimension(node, "data-width", "width") : null;
      const height = node.tagName === "IMG" ? safeImageDimension(node, "data-height", "height") : null;
      Array.from(node.attributes).forEach((attribute) => node.removeAttribute(attribute.name));

      if (node.tagName === "A" && href && isSafeRemoteUrl(href)) {
        node.setAttribute("href", resolvedRemoteUrl(href));
        node.setAttribute("target", "_blank");
        node.setAttribute("rel", "noopener noreferrer");
      }
      if (node.tagName === "IMG") {
        if (!source) {
          node.remove();
          return;
        }
        const previewSource = resolvedRemoteUrl(source);
        node.setAttribute("src", previewSource);
        node.setAttribute("data-preview-src", previewSource);
        if (fullSource) node.setAttribute("data-full-src", resolvedRemoteUrl(fullSource));
        node.setAttribute("alt", alt || "帖子插图");
        node.setAttribute("loading", "lazy");
        node.setAttribute("decoding", "async");
        node.setAttribute("referrerpolicy", "no-referrer");
        if (width && /^\d{1,5}$/.test(width)) node.setAttribute("width", width);
        if (height && /^\d{1,5}$/.test(height)) node.setAttribute("height", height);
      }
      clean(node);
    });
  }

  clean(documentNode.body);
  return documentNode.body.innerHTML;
}

function ChevronGlyph({ direction }: { direction: "left" | "right" }) {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d={direction === "left" ? "m14.5 5-7 7 7 7" : "m9.5 5 7 7-7 7"} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}

function ZoomGlyph({ direction }: { direction: "in" | "out" }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="10.5" cy="10.5" r="6.5" fill="none" stroke="currentColor" strokeWidth="1.8" />
      <path d="m15.5 15.5 4.2 4.2M7.5 10.5h6" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      {direction === "in" && <path d="M10.5 7.5v6" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />}
    </svg>
  );
}

function SizeModeGlyph({ actual }: { actual: boolean }) {
  if (actual) {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <rect x="4" y="4" width="16" height="16" rx="3" fill="none" stroke="currentColor" strokeWidth="1.7" />
        <path d="M8.2 9.1v5.8m-1.1-4.6 1.1-1.2M12 12h.01M15.8 9.1v5.8m-1.1-4.6 1.1-1.2" fill="none" stroke="currentColor" strokeWidth="1.45" strokeLinecap="round" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M9 4H6a2 2 0 0 0-2 2v3m11-5h3a2 2 0 0 1 2 2v3M9 20H6a2 2 0 0 1-2-2v-3m11 5h3a2 2 0 0 0 2-2v-3" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <rect x="8" y="8" width="8" height="8" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}

function RotateGlyph() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <rect x="7" y="9" width="11" height="10" rx="2" fill="none" stroke="currentColor" strokeWidth="1.7" />
      <path d="M5 10a7.5 7.5 0 0 1 11.8-5.2L19 7M19 3v4h-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function DownloadGlyph() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 4v10m-4-4 4 4 4-4M5 17v2a1.5 1.5 0 0 0 1.5 1.5h11A1.5 1.5 0 0 0 19 19v-2" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function clampViewerValue(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

interface ViewportSize {
  width: number;
  height: number;
}

interface AdaptiveImageDetailLayout {
  height: number;
  mediaWidth: number;
  sideWidth: number;
}

type AdaptiveDetailStyle = CSSProperties & {
  "--detail-height"?: string;
  "--detail-media-width"?: string;
  "--detail-side-width"?: string;
};

function validImageRatio(width: number | undefined, height: number | undefined): number | undefined {
  if (!Number.isFinite(width) || !Number.isFinite(height) || !width || !height || width <= 0 || height <= 0) return undefined;
  return clampViewerValue(width / height, .1, 10);
}

function currentViewportSize(): ViewportSize {
  return {
    width: Math.max(1, typeof window === "undefined" ? 1440 : window.innerWidth),
    height: Math.max(1, typeof window === "undefined" ? 900 : window.innerHeight)
  };
}

function useViewportSize(): ViewportSize {
  const [viewport, setViewport] = useState(currentViewportSize);

  useEffect(() => {
    let frame = 0;
    const update = () => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(() => {
        const next = currentViewportSize();
        setViewport((current) => current.width === next.width && current.height === next.height ? current : next);
      });
    };
    window.addEventListener("resize", update, { passive: true });
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("resize", update);
    };
  }, []);

  return viewport;
}

function adaptiveImageDetailLayout(ratio: number, viewport: ViewportSize): AdaptiveImageDetailLayout | undefined {
  if (viewport.width <= 960) return undefined;
  const gap = viewport.width >= 1424 ? 32 : 24;
  const sideWidth = viewport.width >= 1424 ? 440 : viewport.width >= 1192 ? 400 : 360;
  const height = Math.max(1, Math.round(viewport.height - gap * 2));
  const idealWidth = height * Math.min(ratio, 1);
  const availableWidth = Math.max(sideWidth, viewport.width - sideWidth - gap * 4 - 80);
  const mediaWidth = Math.round(Math.max(sideWidth, Math.min(idealWidth, availableWidth)));
  return { height, mediaWidth, sideWidth };
}

interface LoadedViewerImage {
  url: string;
  width: number;
  height: number;
  isOriginal: boolean;
}

const viewerImageRequests = new Map<string, Promise<LoadedViewerImage>>();
const viewerOriginalResolutions = new Map<string, LoadedViewerImage>();

function previewUrlFor(image: ImageMedia): string {
  const thumbnail = image.thumbnail?.trim();
  return thumbnail && thumbnail !== image.url ? thumbnail : image.url;
}

function fallbackViewerResolution(image: ImageMedia): LoadedViewerImage {
  return {
    url: previewUrlFor(image),
    width: Math.max(1, image.width || 1),
    height: Math.max(1, image.height || 1),
    isOriginal: false
  };
}

function viewerImageKey(image: ImageMedia): string {
  return `${previewUrlFor(image)}\n${image.url}`;
}

function cachedViewerOriginal(image: ImageMedia): LoadedViewerImage | undefined {
  return viewerOriginalResolutions.get(viewerImageKey(image));
}

function looksLikeImageThumbnail(url: string): boolean {
  try {
    const parsed = new URL(url, HEYBOX_ORIGIN);
    return /(?:^|\/)thumb(?:\.[a-z0-9]+)?$/i.test(parsed.pathname)
      || /(?:^|[_./-])thumb(?:nail)?(?:[_./-]|$)/i.test(parsed.pathname)
      || parsed.search.includes("imageMogr2");
  } catch {
    return false;
  }
}

function loadViewerImage(url: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const loader = new Image();
    let settled = false;
    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeout);
      loader.onload = null;
      loader.onerror = null;
      callback();
    };
    const timeout = window.setTimeout(() => {
      finish(() => {
        loader.src = "";
        reject(new Error("图片加载超时"));
      });
    }, 60_000);
    loader.decoding = "async";
    loader.referrerPolicy = "no-referrer";
    loader.onload = () => {
      const width = loader.naturalWidth;
      const height = loader.naturalHeight;
      if (!(width > 0 && height > 0)) {
        finish(() => reject(new Error("图片尺寸无效")));
        return;
      }
      void loader.decode().catch(() => undefined).then(() => {
        finish(() => resolve({ width, height }));
      });
    };
    loader.onerror = () => {
      finish(() => reject(new Error("图片加载失败")));
    };
    loader.src = url;
  });
}

async function loadOriginalForViewer(image: ImageMedia): Promise<LoadedViewerImage> {
  const previewUrl = previewUrlFor(image);
  let resolvedUrl = previewUrl;
  try {
    resolvedUrl = await resolveOriginalImageUrl(previewUrl);
  } catch {
    // Invalid or unsupported sources continue to use the already visible preview.
  }

  const candidates = [
    resolvedUrl !== previewUrl ? resolvedUrl : undefined,
    image.url !== previewUrl ? image.url : undefined
  ].filter((url, index, urls): url is string => Boolean(url) && urls.indexOf(url) === index);

  for (const url of candidates) {
    try {
      const size = await loadViewerImage(url);
      return { url, ...size, isOriginal: true };
    } catch {
      // Try the next known full-size candidate before falling back to the preview.
    }
  }

  const previewIsOriginal = !image.thumbnail && image.url === previewUrl && !looksLikeImageThumbnail(previewUrl);
  if (previewIsOriginal) {
    try {
      const size = await loadViewerImage(previewUrl);
      return { url: previewUrl, ...size, isOriginal: true };
    } catch {
      // The DOM preview keeps its own broken-image fallback behavior below.
    }
  }

  return fallbackViewerResolution(image);
}

function ensureViewerOriginal(image: ImageMedia): Promise<LoadedViewerImage> {
  const key = viewerImageKey(image);
  const cached = viewerOriginalResolutions.get(key);
  if (cached) return Promise.resolve(cached);
  const pending = viewerImageRequests.get(key);
  if (pending) return pending;
  const request = loadOriginalForViewer(image).then((result) => {
    viewerImageRequests.delete(key);
    if (result.isOriginal) viewerOriginalResolutions.set(key, result);
    return result;
  }, (error) => {
    viewerImageRequests.delete(key);
    throw error;
  });
  viewerImageRequests.set(key, request);
  return request;
}

interface ArticleImageScheduler {
  load: (image: ImageMedia) => Promise<LoadedViewerImage>;
  dispose: () => void;
}

function createArticleImageScheduler(concurrency = 2): ArticleImageScheduler {
  const queue: Array<{
    key: string;
    image: ImageMedia;
    resolve: (value: LoadedViewerImage) => void;
    reject: (reason?: unknown) => void;
  }> = [];
  const requests = new Map<string, Promise<LoadedViewerImage>>();
  let active = 0;
  let disposed = false;

  const drain = () => {
    if (disposed) return;
    while (active < concurrency && queue.length) {
      const queued = queue.shift();
      if (!queued) return;
      active += 1;
      void ensureViewerOriginal(queued.image).then(queued.resolve, queued.reject).finally(() => {
        active -= 1;
        drain();
      });
    }
  };

  return {
    load(image) {
      if (disposed) return Promise.reject(new Error("文章图片加载已取消"));
      const key = viewerImageKey(image);
      const pending = requests.get(key);
      if (pending) return pending;
      const request = new Promise<LoadedViewerImage>((resolve, reject) => {
        queue.push({ key, image, resolve, reject });
        drain();
      });
      requests.set(key, request);
      void request.then(
        () => { if (requests.get(key) === request) requests.delete(key); },
        () => { if (requests.get(key) === request) requests.delete(key); }
      );
      return request;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      const error = new Error("文章图片加载已取消");
      queue.splice(0).forEach((queued) => queued.reject(error));
      requests.clear();
    }
  };
}

function viewerImageFilename(title: string, index: number, url: string): string {
  const safeTitle = title.normalize("NFKC").replace(/[\\/:*?"<>|\u0000-\u001f]+/g, " ").trim().slice(0, 72) || "HeyNote图片";
  const dataType = url.match(/^data:image\/([a-z0-9.+-]+)/i)?.[1]?.toLowerCase();
  let extension = dataType === "jpeg" ? "jpg" : dataType === "svg+xml" ? "svg" : dataType;
  if (!extension) {
    try {
      extension = new URL(url, HEYBOX_ORIGIN).pathname.match(/\.([a-z0-9]{2,5})$/i)?.[1]?.toLowerCase();
    } catch {
      extension = undefined;
    }
  }
  return `${safeTitle}-${index + 1}.${extension || "jpg"}`;
}

async function downloadViewerImage(image: ImageMedia, title: string, index: number): Promise<void> {
  const filename = viewerImageFilename(title, index, image.url);
  if (typeof chrome !== "undefined" && chrome.runtime?.id) {
    try {
      const response = await chrome.runtime.sendMessage({
        channel: "xiaoheishu-internal",
        operation: "download-image",
        url: image.url,
        filename
      }) as { ok?: boolean } | undefined;
      if (response?.ok) return;
    } catch {
      // Development previews and older installed builds use the browser fallback below.
    }
  }

  const anchor = document.createElement("a");
  anchor.href = image.url;
  anchor.download = filename;
  anchor.target = "_blank";
  anchor.rel = "noopener noreferrer";
  anchor.click();
}

function ShareGlyph() {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="18" cy="5.5" r="2.2" fill="none" stroke="currentColor" strokeWidth="1.6" /><circle cx="6" cy="12" r="2.2" fill="none" stroke="currentColor" strokeWidth="1.6" /><circle cx="18" cy="18.5" r="2.2" fill="none" stroke="currentColor" strokeWidth="1.6" /><path d="m8 10.9 8-4.3m-8 6.5 8 4.3" fill="none" stroke="currentColor" strokeWidth="1.6" /></svg>;
}

function richTextImageElementMedia(image: HTMLImageElement): ImageMedia {
  const preview = image.dataset.previewSrc || image.currentSrc || image.src;
  const url = image.dataset.fullSrc || preview;
  return {
    kind: "image",
    url,
    thumbnail: preview !== url || looksLikeImageThumbnail(preview) ? preview : undefined,
    width: Number(image.getAttribute("width")) || image.naturalWidth || image.width || undefined,
    height: Number(image.getAttribute("height")) || image.naturalHeight || image.height || undefined
  };
}

function richTextImageMedia(root: HTMLElement): ImageMedia[] {
  return Array.from(root.querySelectorAll<HTMLImageElement>("img")).map(richTextImageElementMedia);
}

function SafeRichText({ html, title, onImageOpen, onImageContextMenu, progressiveImageRoot, progressiveImageScheduler }: {
  html: string;
  title: string;
  onImageOpen?: OpenImageLightbox;
  onImageContextMenu: ImageContextMenuHandler;
  progressiveImageRoot?: RefObject<HTMLElement | null>;
  progressiveImageScheduler?: ArticleImageScheduler;
}) {
  const safeHtml = useMemo(() => sanitizeRichHtml(html), [html]);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!onImageOpen) return;
    rootRef.current?.querySelectorAll<HTMLImageElement>("img").forEach((image) => {
      image.tabIndex = 0;
      image.setAttribute("role", "button");
      image.setAttribute("aria-label", `${image.alt || "文章插图"}，点击放大查看`);
    });
  }, [onImageOpen, safeHtml]);

  useEffect(() => {
    const root = rootRef.current;
    const scrollRoot = progressiveImageRoot?.current;
    if (!root || !scrollRoot || !progressiveImageScheduler || typeof IntersectionObserver === "undefined") return;
    let cancelled = false;
    const previewLoadListeners = new Map<HTMLImageElement, () => void>();
    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        const image = entry.target;
        if (!(image instanceof HTMLImageElement)) return;
        observer.unobserve(image);
        const media = richTextImageElementMedia(image);
        const preview = media.thumbnail || media.url;
        void progressiveImageScheduler.load(media).then((resolution) => {
          if (cancelled || !resolution.isOriginal || !image.isConnected) return;
          image.dataset.fullSrc = resolution.url;
          image.dataset.imageResolution = "original";
          if (resolution.url === preview) return;
          window.requestAnimationFrame(() => {
            if (!cancelled && image.isConnected) image.src = resolution.url;
          });
        }).catch(() => undefined);
      });
    }, { root: scrollRoot, rootMargin: "360px 0px", threshold: .01 });
    root.querySelectorAll<HTMLImageElement>("img").forEach((image) => {
      image.dataset.previewSrc ||= image.currentSrc || image.src;
      image.dataset.imageResolution = "preview";
      const observe = () => {
        previewLoadListeners.delete(image);
        if (!cancelled && image.isConnected) observer.observe(image);
      };
      if (image.complete && image.naturalWidth > 0) observe();
      else {
        previewLoadListeners.set(image, observe);
        image.addEventListener("load", observe, { once: true });
      }
    });
    return () => {
      cancelled = true;
      previewLoadListeners.forEach((listener, image) => image.removeEventListener("load", listener));
      observer.disconnect();
    };
  }, [progressiveImageRoot, progressiveImageScheduler, safeHtml]);

  function openTargetImage(target: EventTarget | null) {
    if (!onImageOpen || !(target instanceof Element)) return false;
    const image = target.closest<HTMLImageElement>("img");
    const root = rootRef.current;
    if (!image || !root?.contains(image)) return false;
    const images = richTextImageMedia(root);
    const activeIndex = Array.from(root.querySelectorAll("img")).indexOf(image);
    if (activeIndex < 0 || !images.length) return false;
    onImageOpen(images, activeIndex, title);
    return true;
  }

  function contextTargetImage(event: ReactMouseEvent<HTMLDivElement>) {
    if (!(event.target instanceof Element)) return;
    const image = event.target.closest<HTMLImageElement>("img");
    const root = rootRef.current;
    if (!image || !root?.contains(image)) return;
    const images = richTextImageMedia(root);
    const activeIndex = Array.from(root.querySelectorAll("img")).indexOf(image);
    const active = images[activeIndex];
    if (!active) return;
    onImageContextMenu(event, {
      image: active,
      title,
      index: activeIndex
    });
  }

  return (
    <div
      ref={rootRef}
      className="post-rich-text post-rich-text--zoomable"
      dangerouslySetInnerHTML={{ __html: safeHtml }}
      onClick={(event) => {
        if (!openTargetImage(event.target)) return;
        event.preventDefault();
        event.stopPropagation();
      }}
      onKeyDown={(event) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        if (!openTargetImage(event.target)) return;
        event.preventDefault();
        event.stopPropagation();
      }}
      onContextMenu={contextTargetImage}
    />
  );
}

function ArticleContentImage({ image, index, title, scrollRoot, scheduler, onImageOpen, onImageContextMenu }: {
  image: ImageMedia;
  index: number;
  title: string;
  scrollRoot?: RefObject<HTMLElement | null>;
  scheduler?: ArticleImageScheduler;
  onImageOpen?: OpenImageLightbox;
  onImageContextMenu: ImageContextMenuHandler;
}) {
  const imageRef = useRef<HTMLImageElement>(null);
  const previewUrl = previewUrlFor(image);
  const imageKey = viewerImageKey(image);
  const [resolution, setResolution] = useState<LoadedViewerImage>();
  const displayUrl = resolution?.isOriginal ? resolution.url : previewUrl;
  const displayedImage: ImageMedia = resolution?.isOriginal ? {
    ...image,
    url: resolution.url,
    thumbnail: previewUrl !== resolution.url || looksLikeImageThumbnail(previewUrl) ? previewUrl : undefined,
    width: resolution.width,
    height: resolution.height
  } : image;

  useEffect(() => {
    setResolution(undefined);
  }, [imageKey]);

  useEffect(() => {
    const element = imageRef.current;
    const root = scrollRoot?.current;
    if (!element || !root || !scheduler || typeof IntersectionObserver === "undefined") return;
    let cancelled = false;
    const observe = () => {
      if (!cancelled && element.isConnected) observer.observe(element);
    };
    const observer = new IntersectionObserver((entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return;
      observer.disconnect();
      void scheduler.load(image).then((loaded) => {
        if (cancelled || !loaded.isOriginal) return;
        window.requestAnimationFrame(() => {
          if (!cancelled && element.isConnected) setResolution(loaded);
        });
      }).catch(() => undefined);
    }, { root, rootMargin: "360px 0px", threshold: .01 });
    if (element.complete && element.naturalWidth > 0) observe();
    else element.addEventListener("load", observe, { once: true });
    return () => {
      cancelled = true;
      element.removeEventListener("load", observe);
      observer.disconnect();
    };
  }, [image.height, image.thumbnail, image.url, image.width, imageKey, scheduler, scrollRoot]);

  return (
    <figure className="content-block content-block--image">
      <button
        className="content-block__image-button"
        type="button"
        aria-label="放大查看文章插图"
        onClick={() => onImageOpen?.([displayedImage], 0, title)}
        onContextMenu={(event) => onImageContextMenu(event, { image: displayedImage, title, index })}
      >
        <img
          ref={imageRef}
          src={displayUrl}
          width={image.width}
          height={image.height}
          alt="文章插图"
          loading="lazy"
          decoding="async"
          data-preview-src={previewUrl}
          data-full-src={displayedImage.url}
          data-image-resolution={resolution?.isOriginal ? "original" : "preview"}
          referrerPolicy="no-referrer"
        />
      </button>
    </figure>
  );
}

function ContentBlocks({ blocks, fallback, article = false, title, onImageOpen, onImageContextMenu, progressiveImageRoot, progressiveImageScheduler }: {
  blocks: ContentBlock[];
  fallback?: string;
  article?: boolean;
  title: string;
  onImageOpen?: OpenImageLightbox;
  onImageContextMenu: ImageContextMenuHandler;
  progressiveImageRoot?: RefObject<HTMLElement | null>;
  progressiveImageScheduler?: ArticleImageScheduler;
}) {
  const renderable = blocks.filter((block) => article || block.kind !== "image");
  if (!renderable.length && fallback) return <p className="post-copy"><HeyboxText value={fallback} /></p>;

  return (
    <div className={article ? "content-blocks content-blocks--article" : "content-blocks content-blocks--detail"}>
      {renderable.map((block, index) => {
        if (block.kind === "text") return <p className="content-block content-block--text" key={`text-${index}`}><HeyboxText value={block.text} /></p>;
        if (block.kind === "html") return <SafeRichText html={block.html} title={title} onImageOpen={onImageOpen} onImageContextMenu={onImageContextMenu} progressiveImageRoot={article ? progressiveImageRoot : undefined} progressiveImageScheduler={article ? progressiveImageScheduler : undefined} key={`html-${index}`} />;
        const image: ImageMedia = { kind: "image", url: block.url, thumbnail: block.thumbnail, width: block.width, height: block.height };
        return (
          <ArticleContentImage
            key={`${block.url}-${index}`}
            image={image}
            index={index}
            title={title}
            scrollRoot={progressiveImageRoot}
            scheduler={progressiveImageScheduler}
            onImageOpen={onImageOpen}
            onImageContextMenu={onImageContextMenu}
          />
        );
      })}
    </div>
  );
}

function Avatar({ src, name, className = "" }: { src?: string; name: string; className?: string }) {
  return src
    ? <img className={`detail-avatar ${className}`.trim()} src={src} alt={`${name}的头像`} loading="eager" referrerPolicy="no-referrer" />
    : <span className={`detail-avatar detail-avatar--fallback ${className}`.trim()} aria-hidden="true">{name.trim().slice(0, 1) || "盒"}</span>;
}

function levelTone(level: string): "gray" | "green" | "blue" | "purple" | "orange" | "pink" | "black" {
  const numericLevel = Number(level.match(/\d+/)?.[0]);
  if (!Number.isFinite(numericLevel) || numericLevel <= 3) return "gray";
  if (numericLevel <= 6) return "green";
  if (numericLevel <= 9) return "blue";
  if (numericLevel <= 12) return "purple";
  if (numericLevel <= 15) return "orange";
  if (numericLevel <= 18) return "pink";
  return "black";
}

function UserLevelBadge({ level, compact = false }: { level?: string; compact?: boolean }) {
  if (!level) return null;
  return (
    <span
      className={`user-level-badge user-level-badge--${levelTone(level)} ${compact ? "user-level-badge--compact" : ""}`.trim()}
      aria-label={`用户等级 ${level}`}
    >
      {level}
    </span>
  );
}

function PostByline({
  post,
  compact = false,
  onToggleFollow,
  followLoading = false
}: {
  post: FeedPost;
  compact?: boolean;
  onToggleFollow?: () => void;
  followLoading?: boolean;
}) {
  return (
    <div className={`post-byline ${compact ? "post-byline--compact" : ""}`.trim()}>
      <Avatar src={post.avatar} name={post.author} />
      <div className="post-byline__identity">
        <div className="post-byline__name-line">
          <strong title={post.author}>{post.author}</strong>
          <UserLevelBadge level={post.level} />
        </div>
      </div>
      <button
        className={`post-byline__follow ${post.isFollowing ? "is-following" : ""}`.trim()}
        type="button"
        aria-pressed={Boolean(post.isFollowing)}
        aria-busy={followLoading}
        disabled={followLoading || !onToggleFollow}
        onClick={onToggleFollow}
      >
        {followLoading
          ? <span className="post-byline__follow-spinner" aria-hidden="true" />
          : post.isFollowing
            ? "已关注"
            : <><b aria-hidden="true">＋</b>关注</>}
      </button>
    </div>
  );
}

function PostContentTags({ tags }: { tags?: FeedPost["contentTags"] }) {
  if (!tags?.length) return null;
  return (
    <ul className="post-content-tags" aria-label="帖子标签">
      {tags.map((tag, index) => {
        const styleType = tag.styleType ?? 0;
        const styleName = styleType === 1 ? "big" : styleType === 2 ? "small" : "old";
        const backgroundColor = tag.backgroundColor ?? (styleType === 2 ? "#004b961a" : "#f3f4f5");
        const textColor = tag.textColor ?? (styleType === 2 ? "#004b96" : "#14191e");
        const subLabelWidth = tag.subLabel ? 12 + Math.max(0, tag.subLabel.title.length - 1) * 9 : undefined;
        const subLabelGradient = tag.subLabel
          ? `linear-gradient(45deg, ${tag.subLabel.startColor ?? "#ff654f"}, ${tag.subLabel.endColor ?? "#ff3653"})`
          : undefined;
        return (
        <li key={`${tag.tagId ?? "name"}-${tag.name}-${tag.align ?? "all"}-${styleType}-${index}`}>
          <span
            className={`post-content-tag post-content-tag--${styleName} ${tag.iconUrl ? "has-icon" : "has-no-icon"}`}
            style={{ background: backgroundColor }}
          >
            {tag.iconUrl && <img className="post-content-tag__icon" src={tag.iconUrl} alt="" loading="lazy" referrerPolicy="no-referrer" />}
            <span className="post-content-tag__text" style={{ color: textColor }}>{tag.name}</span>
            {tag.subLabel && (
              <span className="post-content-tag__suffix" style={{ width: `${subLabelWidth}px` }}>
                <span style={{ background: subLabelGradient }}>{tag.subLabel.title}</span>
              </span>
            )}
          </span>
        </li>
        );
      })}
    </ul>
  );
}

function CommentContent({ comment }: { comment: CommentItem }) {
  if (!comment.text) return null;
  return <HeyboxText value={comment.text} emojiClassName="comment-entry__emoji" />;
}

function CommentImages({ comment, onImageOpen }: {
  comment: CommentItem;
  onImageOpen: OpenImageLightbox;
}) {
  const images = comment.images?.filter((image) => Boolean(image.url)) ?? [];
  if (!images.length) return null;
  return (
    <div className="comment-entry__images" aria-label={`${comment.author} 的评论图片，共 ${images.length} 张`}>
      {images.map((image, index) => (
        <button
          className="comment-entry__image-button"
          type="button"
          aria-label={`查看第 ${index + 1} 张评论图片`}
          key={`${image.url}-${index}`}
          onClick={() => onImageOpen(images, index, `${comment.author} 的评论图片`)}
        >
          <img
            src={previewUrlFor(image)}
            width={image.width}
            height={image.height}
            alt="评论图片"
            loading="lazy"
            decoding="async"
            draggable={false}
            referrerPolicy="no-referrer"
          />
        </button>
      ))}
    </div>
  );
}

function CommentEntry({
  comment,
  nested = false,
  rootCommentId,
  onLoadMoreReplies,
  loadingReplyIds,
  onToggleCommentLike,
  likingCommentIds,
  onImageOpen
}: {
  comment: CommentItem;
  nested?: boolean;
  rootCommentId?: string;
  onLoadMoreReplies?: (rootCommentId: string) => void;
  loadingReplyIds?: ReadonlySet<string>;
  onToggleCommentLike?: (commentId: string) => void;
  likingCommentIds?: ReadonlySet<string>;
  onImageOpen: OpenImageLightbox;
}) {
  const loadingReplies = loadingReplyIds?.has(comment.id) ?? false;
  const canLoadReplies = !nested && Boolean(comment.hasMoreReplies && onLoadMoreReplies);
  const repliesId = `comment-replies-${comment.id.replace(/[^a-z0-9_-]/gi, "-")}`;
  return (
    <article className={`comment-entry ${nested ? "comment-entry--reply" : ""}`.trim()}>
      <Avatar src={comment.avatar} name={comment.author} className="comment-entry__avatar" />
      <div className="comment-entry__body">
        <header>
          <strong>{comment.author}</strong>
          <UserLevelBadge level={comment.level} compact />
        </header>
        {(comment.text || (nested && comment.replyToAuthor && comment.replyToCommentId !== rootCommentId)) && (
          <p className={`comment-entry__content ${comment.isCy ? "comment-entry__content--cy" : ""}`.trim()}>
            {nested && comment.replyToAuthor && comment.replyToCommentId !== rootCommentId && (
              <span className="comment-entry__reply-to">回复 {comment.replyToAuthor}：</span>
            )}
            <CommentContent comment={comment} />
          </p>
        )}
        <CommentImages comment={comment} onImageOpen={onImageOpen} />
        {comment.isAuthorLiked && (
          <div className="comment-entry__tag-line">
            <span className="comment-entry__author-liked"><span>作者赞过</span></span>
          </div>
        )}
        <footer>
          <span>{[comment.createdAt, comment.ipLocation].filter(Boolean).join(" · ") || "来自小黑盒"}</span>
          {!nested && onToggleCommentLike && (
            <button
              className={`comment-entry__likes ${comment.isLiked ? "is-active" : ""}`.trim()}
              type="button"
              aria-label={comment.isLiked ? "取消评论点赞" : "点赞评论"}
              aria-pressed={Boolean(comment.isLiked)}
              disabled={likingCommentIds?.has(comment.id)}
              onClick={() => onToggleCommentLike(comment.id)}
            >
              <ThumbUpIcon />
              {formatCount(comment.likes)}
            </button>
          )}
        </footer>
        {(comment.replies.length > 0 || canLoadReplies) && (
          <div id={repliesId} className="comment-entry__replies" aria-live="polite" aria-busy={loadingReplies}>
            {comment.replies.map((reply) => (
              <CommentEntry
                key={reply.id}
                comment={reply}
                nested
                rootCommentId={rootCommentId ?? comment.id}
                onToggleCommentLike={onToggleCommentLike}
                likingCommentIds={likingCommentIds}
                onImageOpen={onImageOpen}
              />
            ))}
            {canLoadReplies && (
              <button
                className="comment-entry__load-replies"
                type="button"
                disabled={loadingReplies}
                aria-controls={repliesId}
                onClick={() => onLoadMoreReplies?.(comment.id)}
              >
                {loadingReplies
                  ? "正在加载回复…"
                  : comment.replies.length <= 2 && (comment.replyCount ?? 0) > 2
                    ? `全部 ${comment.replyCount} 条回复`
                    : "查看更多回复"}
              </button>
            )}
          </div>
        )}
      </div>
    </article>
  );
}

interface CommentsSectionProps {
  comments: CommentItem[];
  total: number;
  hasMore: boolean;
  loadingMore?: boolean;
  onLoadMore?: () => void;
  onLoadMoreReplies?: (rootCommentId: string) => void;
  loadingReplyIds?: ReadonlySet<string>;
  onToggleCommentLike?: (commentId: string) => void;
  likingCommentIds?: ReadonlySet<string>;
  scrollRoot?: RefObject<HTMLElement | null>;
  onImageOpen: OpenImageLightbox;
}

function CommentsSection({
  comments,
  total,
  hasMore,
  loadingMore = false,
  onLoadMore,
  onLoadMoreReplies,
  loadingReplyIds,
  onToggleCommentLike,
  likingCommentIds,
  scrollRoot,
  onImageOpen
}: CommentsSectionProps) {
  const sentinelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel || !hasMore || loadingMore || !onLoadMore || typeof IntersectionObserver === "undefined") return;
    let requested = false;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting) && !requested) {
        requested = true;
        onLoadMore();
      }
    }, { root: scrollRoot?.current ?? null, rootMargin: "240px 0px", threshold: 0.01 });
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [comments.length, hasMore, loadingMore, onLoadMore, scrollRoot]);

  return (
    <section className="comments-section" aria-label="帖子评论">
      <header className="comments-section__header">
        <h2>评论</h2>
        <span>{formatCount(total)}</span>
      </header>
      {comments.length ? (
        <div className="comments-section__list">
          {comments.map((comment) => (
            <CommentEntry
              key={comment.id}
              comment={comment}
              onLoadMoreReplies={onLoadMoreReplies}
              loadingReplyIds={loadingReplyIds}
              onToggleCommentLike={onToggleCommentLike}
              likingCommentIds={likingCommentIds}
              onImageOpen={onImageOpen}
            />
          ))}
        </div>
      ) : (
        <div className="comments-section__empty"><CommentIcon /><strong>还没有评论</strong><span>可以前往小黑盒参与讨论</span></div>
      )}
      <div ref={sentinelRef} className="comments-section__sentinel" aria-hidden="true" />
      {hasMore && onLoadMore && (
        <button className="comments-section__load-more" type="button" disabled={loadingMore} onClick={onLoadMore}>
          {loadingMore ? "正在加载更多评论…" : "查看更多评论"}
        </button>
      )}
      {!hasMore && comments.length > 0 && <p className="comments-section__end">— 已经看到全部评论 —</p>}
    </section>
  );
}

const GALLERY_ORIGINAL_RADIUS = 2;

function galleryOriginalWindow(activeIndex: number, imageCount: number): number[] {
  return [0, -1, 1, -GALLERY_ORIGINAL_RADIUS, GALLERY_ORIGINAL_RADIUS]
    .map((offset) => activeIndex + offset)
    .filter((index, position, indices) => index >= 0 && index < imageCount && indices.indexOf(index) === position);
}

function GalleryOriginalImage({
  image,
  index,
  title,
  active,
  resolution,
  wasRevealed,
  onOriginalRevealed,
  onFirstImageDimensions
}: {
  image: ImageMedia;
  index: number;
  title: string;
  active: boolean;
  resolution?: LoadedViewerImage;
  wasRevealed: boolean;
  onOriginalRevealed: (url: string) => void;
  onFirstImageDimensions?: (image: ImageMedia, width: number, height: number) => void;
}) {
  const previewUrl = previewUrlFor(image);
  const separateOriginal = Boolean(resolution?.isOriginal && resolution.url !== previewUrl);
  const [readyUrl, setReadyUrl] = useState<string>();
  const [failedUrl, setFailedUrl] = useState<string>();
  const originalDimensionsReportedRef = useRef(wasRevealed);
  const originalReady = Boolean(resolution && (wasRevealed || readyUrl === resolution.url));

  useEffect(() => {
    if (!wasRevealed || !resolution?.url) return;
    originalDimensionsReportedRef.current = true;
    setReadyUrl(resolution.url);
  }, [resolution?.url, wasRevealed]);

  return (
    <>
      <img
        className="media-gallery__image media-gallery__image--preview"
        src={previewUrl}
        width={image.width}
        height={image.height}
        alt={`${title}，第 ${index + 1} 张图片`}
        loading="eager"
        decoding="async"
        fetchPriority={active ? "high" : "low"}
        draggable={false}
        referrerPolicy="no-referrer"
        onLoad={(event) => {
          if (index !== 0 || originalDimensionsReportedRef.current) return;
          const loadedImage = event.currentTarget;
          onFirstImageDimensions?.(
            image,
            Math.max(1, loadedImage.naturalWidth || image.width || 1),
            Math.max(1, loadedImage.naturalHeight || image.height || 1)
          );
        }}
      />
      {separateOriginal && resolution && failedUrl !== resolution.url && (
        <img
          className={`media-gallery__image media-gallery__image--original ${originalReady ? "is-ready" : ""}`.trim()}
          src={resolution.url}
          width={resolution.width}
          height={resolution.height}
          alt=""
          aria-hidden="true"
          loading="eager"
          decoding="async"
          fetchPriority={active ? "high" : "low"}
          draggable={false}
          referrerPolicy="no-referrer"
          onLoad={(event) => {
            const loadedImage = event.currentTarget;
            const revealOriginal = () => {
              window.requestAnimationFrame(() => {
                window.requestAnimationFrame(() => {
                  if (!loadedImage.isConnected) return;
                  if (index === 0) {
                    originalDimensionsReportedRef.current = true;
                    onFirstImageDimensions?.(
                      image,
                      Math.max(1, loadedImage.naturalWidth || resolution.width || 1),
                      Math.max(1, loadedImage.naturalHeight || resolution.height || 1)
                    );
                  }
                  setReadyUrl(resolution.url);
                  onOriginalRevealed(resolution.url);
                });
              });
            };
            void loadedImage.decode().catch(() => undefined).then(revealOriginal);
          }}
          onError={() => setFailedUrl(resolution.url)}
        />
      )}
    </>
  );
}

function ImageGallery({
  images,
  title,
  topic,
  onImageOpen,
  onImageContextMenu,
  onFirstImageDimensions
}: {
  images: ImageMedia[];
  title: string;
  topic?: string;
  onImageOpen: OpenImageLightbox;
  onImageContextMenu: ImageContextMenuHandler;
  onFirstImageDimensions?: (image: ImageMedia, width: number, height: number) => void;
}) {
  const [activeIndex, setActiveIndex] = useState(0);
  const [swipeOffset, setSwipeOffset] = useState(0);
  const [swiping, setSwiping] = useState(false);
  const swipeRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    startedAt: number;
    width: number;
    axis: "pending" | "horizontal" | "vertical";
  } | null>(null);
  const suppressOpenRef = useRef(false);
  const suppressOpenTimerRef = useRef<number | null>(null);
  const jumpTransitionFramesRef = useRef<[number, number] | null>(null);
  const normalizedIndex = Math.min(activeIndex, Math.max(images.length - 1, 0));
  const active = images[normalizedIndex];
  const imageSignature = images.map((image) => image.url).join("\n");
  const canMovePrevious = normalizedIndex > 0;
  const canMoveNext = normalizedIndex < images.length - 1;
  const originalWindow = galleryOriginalWindow(normalizedIndex, images.length);
  const originalWindowSignature = originalWindow.join(",");
  const originalWindowSet = new Set(originalWindow);
  const previousOriginalWindowRef = useRef(originalWindow);
  const originalResolutionsRef = useRef(new Map<string, LoadedViewerImage>());
  const [originalResolutions, setOriginalResolutions] = useState<Map<string, LoadedViewerImage>>(() => new Map());
  const [renderedOriginalWindow, setRenderedOriginalWindow] = useState<Set<number>>(() => new Set(originalWindow));
  const [revealedOriginalKeys, setRevealedOriginalKeys] = useState<Set<string>>(() => new Set());
  const [skipTrackTransition, setSkipTrackTransition] = useState(false);
  const displayedOriginalWindow = new Set([...renderedOriginalWindow, ...originalWindow]);

  useEffect(() => {
    setActiveIndex(0);
    setSwipeOffset(0);
    setSwiping(false);
    swipeRef.current = null;
    const initialWindow = galleryOriginalWindow(0, images.length);
    previousOriginalWindowRef.current = initialWindow;
    originalResolutionsRef.current = new Map();
    setOriginalResolutions(new Map());
    setRenderedOriginalWindow(new Set(initialWindow));
    setRevealedOriginalKeys(new Set());
    setSkipTrackTransition(false);
  }, [imageSignature]);

  useEffect(() => {
    const previousWindow = previousOriginalWindowRef.current;
    previousOriginalWindowRef.current = originalWindow;
    setRenderedOriginalWindow(new Set([...previousWindow, ...originalWindow]));
    const timeout = window.setTimeout(() => {
      setRenderedOriginalWindow(new Set(originalWindow));
    }, 420);
    return () => window.clearTimeout(timeout);
  }, [originalWindowSignature]);

  useEffect(() => {
    let cancelled = false;
    originalWindow.forEach((index) => {
      const image = images[index];
      if (!image) return;
      const key = viewerImageKey(image);
      const cached = originalResolutionsRef.current.get(key);
      if (cached) return;
      void ensureViewerOriginal(image).then((resolution) => {
        if (cancelled) return;
        originalResolutionsRef.current.set(key, resolution);
        setOriginalResolutions((current) => {
          if (current.get(key) === resolution) return current;
          const next = new Map(current);
          next.set(key, resolution);
          return next;
        });
      }).catch(() => undefined);
    });
    return () => { cancelled = true; };
  }, [imageSignature, originalWindowSignature]);

  useEffect(() => () => {
    if (suppressOpenTimerRef.current !== null) window.clearTimeout(suppressOpenTimerRef.current);
    const frames = jumpTransitionFramesRef.current;
    if (frames) {
      window.cancelAnimationFrame(frames[0]);
      if (frames[1]) window.cancelAnimationFrame(frames[1]);
    }
  }, []);

  function move(delta: number) {
    setActiveIndex((current) => Math.max(0, Math.min(current + delta, images.length - 1)));
  }

  function jumpTo(index: number) {
    if (Math.abs(index - normalizedIndex) > 1) {
      const previousFrames = jumpTransitionFramesRef.current;
      if (previousFrames) {
        window.cancelAnimationFrame(previousFrames[0]);
        if (previousFrames[1]) window.cancelAnimationFrame(previousFrames[1]);
      }
      setSkipTrackTransition(true);
      const frames: [number, number] = [0, 0];
      frames[0] = window.requestAnimationFrame(() => {
        frames[1] = window.requestAnimationFrame(() => {
          jumpTransitionFramesRef.current = null;
          setSkipTrackTransition(false);
        });
      });
      jumpTransitionFramesRef.current = frames;
    }
    setActiveIndex(index);
  }

  function beginSwipe(event: ReactPointerEvent<HTMLDivElement>) {
    if (!event.isPrimary || event.button !== 0 || images.length < 2) return;
    const target = event.target;
    if (!(target instanceof Element) || !target.closest(".media-gallery__stage--interactive")) return;
    if (suppressOpenTimerRef.current !== null) {
      window.clearTimeout(suppressOpenTimerRef.current);
      suppressOpenTimerRef.current = null;
    }
    suppressOpenRef.current = false;
    swipeRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      startedAt: performance.now(),
      width: event.currentTarget.clientWidth,
      axis: "pending"
    };
  }

  function updateSwipe(event: ReactPointerEvent<HTMLDivElement>) {
    const gesture = swipeRef.current;
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    const deltaX = event.clientX - gesture.startX;
    const deltaY = event.clientY - gesture.startY;
    if (gesture.axis === "pending") {
      const distanceX = Math.abs(deltaX);
      const distanceY = Math.abs(deltaY);
      if (Math.max(distanceX, distanceY) < 6) return;
      if (distanceX > distanceY * 1.15) gesture.axis = "horizontal";
      else if (distanceY > distanceX * 1.15) gesture.axis = "vertical";
      else if (Math.max(distanceX, distanceY) >= 14) gesture.axis = distanceX > distanceY ? "horizontal" : "vertical";
      else return;
      if (gesture.axis === "horizontal" && !event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.setPointerCapture(event.pointerId);
      }
    }
    if (gesture.axis !== "horizontal") return;
    suppressOpenRef.current = true;
    setSwiping(true);
    const movingPastStart = deltaX > 0 && !canMovePrevious;
    const movingPastEnd = deltaX < 0 && !canMoveNext;
    const resistedOffset = Math.sign(deltaX) * Math.min(gesture.width * .12, Math.abs(deltaX) * .28);
    setSwipeOffset((movingPastStart || movingPastEnd) ? resistedOffset : deltaX);
  }

  function finishSwipe(event: ReactPointerEvent<HTMLDivElement>, cancelled = false) {
    const gesture = swipeRef.current;
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    const wasHorizontal = gesture.axis === "horizontal";
    const deltaX = event.clientX - gesture.startX;
    const elapsed = Math.max(performance.now() - gesture.startedAt, 1);
    const velocity = deltaX / elapsed;
    const threshold = Math.min(132, Math.max(54, event.currentTarget.clientWidth * .12));
    const fastFlick = Math.abs(deltaX) >= 24 && Math.abs(velocity) >= .55;

    swipeRef.current = null;
    setSwipeOffset(0);
    setSwiping(false);
    if (!cancelled && wasHorizontal) {
      if ((deltaX <= -threshold || (fastFlick && velocity < 0)) && canMoveNext) move(1);
      if ((deltaX >= threshold || (fastFlick && velocity > 0)) && canMovePrevious) move(-1);
    }
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    if (wasHorizontal) {
      suppressOpenRef.current = true;
      suppressOpenTimerRef.current = window.setTimeout(() => {
        suppressOpenRef.current = false;
        suppressOpenTimerRef.current = null;
      }, 0);
    }
  }

  if (!active) {
    return (
      <div
        className="media-gallery media-gallery--empty"
        role="img"
        aria-label={`${title}的文字封面${topic ? `，社区：${topic}` : ""}`}
      >
        <GeneratedTextCover title={title} variant="detail" />
        {topic && <span className="topic-chip topic-chip--detail">{topic}</span>}
        <div className="cover-wash" />
      </div>
    );
  }

  return (
    <div
      className={`media-gallery ${swiping ? "is-swipe-dragging" : ""} ${skipTrackTransition ? "is-jump-switching" : ""}`.trim()}
      role="region"
      aria-roledescription="轮播图"
      aria-label={`${title}的图片`}
      tabIndex={0}
      onKeyDown={(event) => {
        if (event.key === "ArrowLeft" && canMovePrevious) { event.preventDefault(); move(-1); }
        if (event.key === "ArrowRight" && canMoveNext) { event.preventDefault(); move(1); }
      }}
      onPointerDown={beginSwipe}
      onPointerMove={updateSwipe}
      onPointerUp={finishSwipe}
      onPointerCancel={(event) => finishSwipe(event, true)}
      onLostPointerCapture={(event) => {
        if (swipeRef.current?.pointerId === event.pointerId) finishSwipe(event, true);
      }}
    >
      <div
        className="media-gallery__track"
        style={{ transform: `translate3d(calc(${-normalizedIndex * 100}% + ${swipeOffset}px), 0, 0)` }}
      >
        {images.map((image, index) => (
          <button
            key={`${image.url}-${index}`}
            className="media-gallery__stage media-gallery__stage--interactive"
            type="button"
            data-original-window={originalWindowSet.has(index) ? "true" : undefined}
            data-original-rendered={displayedOriginalWindow.has(index) ? "true" : undefined}
            aria-label={`放大查看第 ${index + 1} 张图片`}
            aria-hidden={index !== normalizedIndex}
            aria-busy={originalWindowSet.has(index) && !originalResolutions.has(viewerImageKey(image))}
            tabIndex={index === normalizedIndex ? 0 : -1}
            onClick={(event) => {
              if (suppressOpenRef.current) {
                event.preventDefault();
                event.stopPropagation();
                return;
              }
              onImageOpen(images, index, title);
            }}
            onContextMenu={(event) => onImageContextMenu(event, { image, title, index })}
          >
            {displayedOriginalWindow.has(index) && (
              <GalleryOriginalImage
                image={image}
                index={index}
                title={title}
                active={index === normalizedIndex}
                resolution={originalResolutions.get(viewerImageKey(image))}
                wasRevealed={(() => {
                  const resolution = originalResolutions.get(viewerImageKey(image));
                  return Boolean(resolution && revealedOriginalKeys.has(`${viewerImageKey(image)}\n${resolution.url}`));
                })()}
                onOriginalRevealed={(url) => {
                  const key = `${viewerImageKey(image)}\n${url}`;
                  setRevealedOriginalKeys((current) => {
                    if (current.has(key)) return current;
                    const next = new Set(current);
                    next.add(key);
                    return next;
                  });
                }}
                onFirstImageDimensions={onFirstImageDimensions}
              />
            )}
          </button>
        ))}
      </div>
      {images.length > 1 && (
        <>
          <button className="media-gallery__previous" type="button" aria-label="上一张图片" disabled={!canMovePrevious} onClick={() => move(-1)}><ChevronGlyph direction="left" /></button>
          <button className="media-gallery__next" type="button" aria-label="下一张图片" disabled={!canMoveNext} onClick={() => move(1)}><ChevronGlyph direction="right" /></button>
          <span className="media-gallery__count" aria-live="polite">{normalizedIndex + 1} / {images.length}</span>
          {images.length <= 20 && (
            <div className="media-gallery__dots" role="group" aria-label="选择图片">
              {images.map((image, index) => (
                <button
                  key={`${image.url}-${index}`}
                  className={`media-gallery__dot ${index === normalizedIndex ? "is-active" : ""}`.trim()}
                  type="button"
                  aria-label={`查看第 ${index + 1} 张图片`}
                  aria-current={index === normalizedIndex ? "true" : undefined}
                  onClick={(event) => {
                    event.stopPropagation();
                    jumpTo(index);
                    if (event.detail > 0) event.currentTarget.blur();
                  }}
                />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

type ViewerOriginalPhase = "idle" | "loading" | "loaded" | "ready" | "error";

interface ViewerOriginalState {
  key: string;
  phase: ViewerOriginalPhase;
  resolution?: LoadedViewerImage;
}

function ImageLightbox({ state, onClose, onMove, onImageContextMenu }: {
  state: ImageLightboxState;
  onClose: () => void;
  onMove: (delta: number) => void;
  onImageContextMenu: ImageContextMenuHandler;
}) {
  const layerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  const safeAreaRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{
    pointerId: number;
    startClientX: number;
    startClientY: number;
    startPanX: number;
    startPanY: number;
    canPan: boolean;
    moved: boolean;
  } | null>(null);
  const activeIndex = Math.min(state.activeIndex, Math.max(state.images.length - 1, 0));
  const active = state.images[activeIndex];
  const activeKey = `${activeIndex}:${active ? viewerImageKey(active) : ""}`;
  const activeKeyRef = useRef(activeKey);
  useLayoutEffect(() => {
    activeKeyRef.current = activeKey;
  }, [activeKey]);
  const canMovePrevious = activeIndex > 0;
  const canMoveNext = activeIndex < state.images.length - 1;
  const synchronousResolution = active ? cachedViewerOriginal(active) : undefined;
  const [originalState, setOriginalState] = useState<ViewerOriginalState>(() => synchronousResolution
    ? { key: activeKey, phase: "loaded", resolution: synchronousResolution }
    : { key: activeKey, phase: "idle" });
  const currentOriginalState = originalState.key === activeKey
    ? originalState
    : synchronousResolution
      ? { key: activeKey, phase: "loaded" as const, resolution: synchronousResolution }
      : undefined;
  const originalPhase = currentOriginalState?.phase ?? "idle";
  const activeResolution = currentOriginalState?.resolution;
  const [canvasSize, setCanvasSize] = useState(() => ({
    width: Math.max(1, typeof window === "undefined" ? 960 : window.innerWidth),
    height: Math.max(1, typeof window === "undefined" ? 640 : window.innerHeight)
  }));
  const [fitArea, setFitArea] = useState(() => {
    const width = Math.max(1, typeof window === "undefined" ? 844 : window.innerWidth - (window.innerWidth <= 720 ? 20 : 116));
    const height = Math.max(1, typeof window === "undefined" ? 534 : window.innerHeight - (window.innerWidth <= 720 ? 82 : 106));
    return {
      width,
      height,
      centerX: (typeof window === "undefined" ? 960 : window.innerWidth) / 2,
      centerY: (typeof window === "undefined" ? 640 : window.innerHeight) / 2 - (typeof window !== "undefined" && window.innerWidth <= 720 ? 31 : 35)
    };
  });
  const [geometryReady, setGeometryReady] = useState(false);
  const [transitionReadyKey, setTransitionReadyKey] = useState<string>();
  const [zoomMode, setZoomMode] = useState<"fit" | "manual">("fit");
  const [manualScale, setManualScale] = useState(1);
  const [rotationTurns, setRotationTurns] = useState(0);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const normalizedTurns = ((rotationTurns % 4) + 4) % 4;
  const quarterTurn = normalizedTurns % 2 === 1;
  const naturalWidth = activeResolution?.width ?? 1;
  const naturalHeight = activeResolution?.height ?? 1;
  const rotatedNaturalWidth = quarterTurn ? naturalHeight : naturalWidth;
  const rotatedNaturalHeight = quarterTurn ? naturalWidth : naturalHeight;
  const fitScale = Math.max(.01, Math.min(
    1,
    fitArea.width / Math.max(rotatedNaturalWidth, 1),
    fitArea.height / Math.max(rotatedNaturalHeight, 1)
  ));
  const minimumScale = Math.min(.1, fitScale);
  const maximumScale = 5;
  const scale = zoomMode === "fit"
    ? fitScale
    : clampViewerValue(manualScale, minimumScale, maximumScale);
  const renderedWidth = rotatedNaturalWidth * scale;
  const renderedHeight = rotatedNaturalHeight * scale;
  const panXEdgeA = renderedWidth / 2 - fitArea.centerX;
  const panXEdgeB = canvasSize.width - renderedWidth / 2 - fitArea.centerX;
  const panYEdgeA = renderedHeight / 2 - fitArea.centerY;
  const panYEdgeB = canvasSize.height - renderedHeight / 2 - fitArea.centerY;
  const minPanX = Math.min(panXEdgeA, panXEdgeB);
  const maxPanX = Math.max(panXEdgeA, panXEdgeB);
  const minPanY = Math.min(panYEdgeA, panYEdgeB);
  const maxPanY = Math.max(panYEdgeA, panYEdgeB);
  const viewerControlsReady = geometryReady && originalPhase === "ready";
  const switchingImage = transitionReadyKey !== activeKey;
  const canPan = viewerControlsReady && geometryReady && (maxPanX - minPanX > .5 || maxPanY - minPanY > .5);
  const canZoomOut = viewerControlsReady && scale > minimumScale + .005;
  const canZoomIn = viewerControlsReady && scale < maximumScale - .005;
  const isActualSize = zoomMode === "manual" && Math.abs(scale - 1) < .005;
  const scalePercent = Math.max(1, Math.round(scale * 100));

  useLayoutEffect(() => {
    dragRef.current = null;
    setZoomMode("fit");
    setManualScale(1);
    setRotationTurns(0);
    setPan({ x: 0, y: 0 });
    setDragging(false);
    setTransitionReadyKey(undefined);
  }, [activeKey]);

  useLayoutEffect(() => {
    if (!viewerControlsReady) return;
    let revealFrame = 0;
    const geometryFrame = window.requestAnimationFrame(() => {
      revealFrame = window.requestAnimationFrame(() => {
        if (activeKeyRef.current === activeKey) setTransitionReadyKey(activeKey);
      });
    });
    return () => {
      window.cancelAnimationFrame(geometryFrame);
      if (revealFrame) window.cancelAnimationFrame(revealFrame);
    };
  }, [activeKey, viewerControlsReady]);

  useEffect(() => {
    if (!active) return;
    const requestKey = activeKey;
    const cached = cachedViewerOriginal(active);
    if (cached) {
      setOriginalState((current) => current.key === requestKey
        && current.phase === "ready"
        && current.resolution?.url === cached.url
        ? current
        : { key: requestKey, phase: "loaded", resolution: cached });
      return;
    }
    let cancelled = false;
    setOriginalState({ key: requestKey, phase: "loading" });
    void ensureViewerOriginal(active).then((resolution) => {
      if (cancelled || activeKeyRef.current !== requestKey) return;
      if (!resolution.isOriginal) {
        setOriginalState({ key: requestKey, phase: "error" });
        return;
      }
      setOriginalState({ key: requestKey, phase: "loaded", resolution });
    }).catch(() => {
      if (!cancelled && activeKeyRef.current === requestKey) {
        setOriginalState({ key: requestKey, phase: "error" });
      }
    });
    return () => { cancelled = true; };
  }, [active, activeKey]);

  useEffect(() => {
    [
      state.images[activeIndex - 1],
      state.images[activeIndex + 1],
      state.images[activeIndex - 2],
      state.images[activeIndex + 2]
    ]
      .filter((image): image is ImageMedia => Boolean(image?.url))
      .forEach((image) => { void ensureViewerOriginal(image); });
  }, [activeIndex, activeKey, state.images]);

  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    const safeArea = safeAreaRef.current;
    if (!canvas || !safeArea) return;
    const updateSize = () => {
      const rect = canvas.getBoundingClientRect();
      const safeRect = safeArea.getBoundingClientRect();
      setCanvasSize((current) => {
        const width = Math.max(1, rect.width);
        const height = Math.max(1, rect.height);
        return Math.abs(current.width - width) < .5 && Math.abs(current.height - height) < .5
          ? current
          : { width, height };
      });
      setFitArea((current) => {
        const next = {
          width: Math.max(1, safeRect.width),
          height: Math.max(1, safeRect.height),
          centerX: safeRect.left - rect.left + safeRect.width / 2,
          centerY: safeRect.top - rect.top + safeRect.height / 2
        };
        return Math.abs(current.width - next.width) < .5
          && Math.abs(current.height - next.height) < .5
          && Math.abs(current.centerX - next.centerX) < .5
          && Math.abs(current.centerY - next.centerY) < .5
          ? current
          : next;
      });
      setGeometryReady(true);
    };
    updateSize();
    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", updateSize, { passive: true });
      return () => window.removeEventListener("resize", updateSize);
    }
    const observer = new ResizeObserver(updateSize);
    observer.observe(canvas);
    observer.observe(safeArea);
    return () => observer.disconnect();
  }, []);

  useLayoutEffect(() => {
    setPan((current) => {
      const next = {
        x: clampViewerValue(current.x, minPanX, maxPanX),
        y: clampViewerValue(current.y, minPanY, maxPanY)
      };
      return next.x === current.x && next.y === current.y ? current : next;
    });
  }, [maxPanX, maxPanY, minPanX, minPanY]);

  function zoomBy(direction: -1 | 1) {
    const next = clampViewerValue((Math.round(scale * 100) + direction * 25) / 100, minimumScale, maximumScale);
    setManualScale(next);
    setZoomMode("manual");
  }

  function showActualOrFit() {
    setPan({ x: 0, y: 0 });
    if (isActualSize) {
      setZoomMode("fit");
      return;
    }
    setManualScale(1);
    setZoomMode("manual");
  }

  function rotateClockwise() {
    setRotationTurns((current) => current + 1);
    setPan({ x: 0, y: 0 });
  }

  function beginPan(event: ReactPointerEvent<HTMLDivElement>) {
    if (!event.isPrimary || event.button !== 0) return;
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = {
      pointerId: event.pointerId,
      startClientX: event.clientX,
      startClientY: event.clientY,
      startPanX: pan.x,
      startPanY: pan.y,
      canPan,
      moved: false
    };
    setDragging(false);
  }

  function movePan(event: ReactPointerEvent<HTMLDivElement>) {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const deltaX = event.clientX - drag.startClientX;
    const deltaY = event.clientY - drag.startClientY;
    if (!drag.moved) {
      if (Math.hypot(deltaX, deltaY) < 5) return;
      drag.moved = true;
      if (drag.canPan) setDragging(true);
    }
    if (!drag.canPan) return;
    setPan({
      x: clampViewerValue(drag.startPanX + deltaX, minPanX, maxPanX),
      y: clampViewerValue(drag.startPanY + deltaY, minPanY, maxPanY)
    });
  }

  function endPan(event: ReactPointerEvent<HTMLDivElement>, cancelled = false) {
    const drag = dragRef.current;
    if (drag?.pointerId !== event.pointerId) return;
    const shouldClose = !cancelled && !drag.moved;
    dragRef.current = null;
    setDragging(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    if (shouldClose) onClose();
  }

  useEffect(() => {
    const focusFrame = window.requestAnimationFrame(() => layerRef.current?.focus());
    function handleKeyDown(event: globalThis.KeyboardEvent) {
      const key = event.key;
      if (document.documentElement.hasAttribute(IMAGE_CONTEXT_MENU_OPEN_ATTRIBUTE)) return;
      const handled = key === "Escape" || key === "ArrowLeft" || key === "ArrowRight"
        || key === "+" || key === "=" || key === "-" || key === "_"
        || key === "0" || key === "1" || key.toLowerCase() === "r";
      if (!handled) return;
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      if (key === "Escape") onClose();
      if (key === "ArrowLeft" && canMovePrevious) onMove(-1);
      if (key === "ArrowRight" && canMoveNext) onMove(1);
      if ((key === "+" || key === "=") && canZoomIn) zoomBy(1);
      if ((key === "-" || key === "_") && canZoomOut) zoomBy(-1);
      if (key === "0" && viewerControlsReady) { setZoomMode("fit"); setPan({ x: 0, y: 0 }); }
      if (key === "1" && viewerControlsReady) { setManualScale(1); setZoomMode("manual"); setPan({ x: 0, y: 0 }); }
      if (key.toLowerCase() === "r" && viewerControlsReady) rotateClockwise();
    }
    window.addEventListener("keydown", handleKeyDown, true);
    return () => {
      window.cancelAnimationFrame(focusFrame);
      window.removeEventListener("keydown", handleKeyDown, true);
    };
  }, [canMoveNext, canMovePrevious, canZoomIn, canZoomOut, maximumScale, minimumScale, onClose, onMove, scale, viewerControlsReady]);

  if (!active) return null;
  const downloadableImage = originalPhase === "ready" && activeResolution?.isOriginal
    ? { ...active, url: activeResolution.url, width: activeResolution.width, height: activeResolution.height }
    : undefined;
  const imagePlacementStyle: CSSProperties = {
    left: quarterTurn ? "50%" : 0,
    top: quarterTurn ? "50%" : 0,
    width: `${naturalWidth * scale}px`,
    height: `${naturalHeight * scale}px`,
    transform: rotationTurns === 0
      ? "none"
      : quarterTurn
        ? `translate(-50%, -50%) rotate(${rotationTurns * 90}deg)`
        : `rotate(${rotationTurns * 90}deg)`
  };

  return (
    <div
      ref={layerRef}
      className="image-lightbox"
      role="dialog"
      aria-modal="true"
      aria-label={`${state.title}的图片查看器`}
      tabIndex={-1}
      onPointerDown={(event) => {
        if (event.isPrimary && event.button === 0 && event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={canvasRef}
        className="image-lightbox__canvas"
        onPointerDown={(event) => {
          if (event.isPrimary && event.button === 0 && event.target === event.currentTarget) onClose();
        }}
      >
        <div ref={safeAreaRef} className="image-lightbox__safe-area" aria-hidden="true" />
        <div
          className={`image-lightbox__frame ${canPan ? "is-pannable" : ""} ${dragging ? "is-dragging" : ""} ${switchingImage ? "is-switching" : ""} ${viewerControlsReady ? "is-ready" : ""}`.trim()}
          style={{
            left: `${fitArea.centerX}px`,
            top: `${fitArea.centerY}px`,
            width: `${renderedWidth}px`,
            height: `${renderedHeight}px`,
            transform: `translate(calc(-50% + ${pan.x}px), calc(-50% + ${pan.y}px))`
          }}
          onPointerDown={beginPan}
          onPointerMove={movePan}
          onPointerUp={(event) => endPan(event)}
          onPointerCancel={(event) => endPan(event, true)}
          onLostPointerCapture={() => { dragRef.current = null; setDragging(false); }}
          onContextMenu={(event) => onImageContextMenu(event, {
            image: downloadableImage || active,
            title: state.title,
            index: activeIndex,
            resolvedUrl: downloadableImage?.url
          })}
        >
          {activeResolution?.isOriginal && (
            <img
              key={`${activeKey}:${activeResolution.url}`}
              className="image-lightbox__image"
              src={activeResolution.url}
              width={activeResolution.width}
              height={activeResolution.height}
              alt={`${state.title}，第 ${activeIndex + 1} 张图片`}
              draggable={false}
              referrerPolicy="no-referrer"
              style={imagePlacementStyle}
              onLoad={(event) => {
                const image = event.currentTarget;
                const loadedKey = activeKey;
                const loadedUrl = activeResolution.url;
                const revealImage = () => {
                  if (!image.isConnected || activeKeyRef.current !== loadedKey) return;
                  if (activeResolution.isOriginal) {
                    setOriginalState((current) => {
                      const resolution = current.key === loadedKey && current.resolution?.url === loadedUrl
                        ? current.resolution
                        : activeResolution;
                      return { key: loadedKey, phase: "ready", resolution };
                    });
                  }
                };
                void image.decode().catch(() => undefined).then(revealImage);
              }}
              onError={() => {
                const failedKey = activeKey;
                if (activeKeyRef.current !== failedKey) return;
                if (activeResolution.isOriginal) {
                  viewerImageRequests.delete(viewerImageKey(active));
                  viewerOriginalResolutions.delete(viewerImageKey(active));
                  setOriginalState({ key: failedKey, phase: "error" });
                }
              }}
              onDragStart={(event) => event.preventDefault()}
            />
          )}
        </div>
      </div>
      <div className="image-lightbox__toolbar" role="toolbar" aria-label="图片查看工具" onPointerDown={(event) => event.stopPropagation()}>
        <div className="image-lightbox__tool-group" aria-label="切换图片">
          <button className="image-lightbox__tool" type="button" aria-label="上一张图片" data-tooltip="上一张" disabled={!canMovePrevious} onClick={() => onMove(-1)}><ChevronGlyph direction="left" /></button>
          <span className="image-lightbox__counter" aria-live="polite">{activeIndex + 1} / {state.images.length}</span>
          <button className="image-lightbox__tool" type="button" aria-label="下一张图片" data-tooltip="下一张" disabled={!canMoveNext} onClick={() => onMove(1)}><ChevronGlyph direction="right" /></button>
        </div>
        <i className="image-lightbox__divider" aria-hidden="true" />
        <div className="image-lightbox__tool-group" aria-label="调整图片">
          <button className="image-lightbox__tool" type="button" aria-label="缩小图片 25%" data-tooltip="缩小 25%" disabled={!canZoomOut} onClick={() => zoomBy(-1)}><ZoomGlyph direction="out" /></button>
          <output className="image-lightbox__scale" aria-live="polite">{viewerControlsReady ? `${scalePercent}%` : null}</output>
          <button className="image-lightbox__tool" type="button" aria-label="放大图片 25%" data-tooltip="放大 25%" disabled={!canZoomIn} onClick={() => zoomBy(1)}><ZoomGlyph direction="in" /></button>
          <button
            className={`image-lightbox__tool image-lightbox__size-toggle ${isActualSize ? "is-active" : ""}`.trim()}
            type="button"
            aria-label={isActualSize ? "适应页面" : "原始尺寸"}
            data-tooltip={isActualSize ? "适应页面" : "原始尺寸"}
            aria-pressed={isActualSize}
            disabled={!viewerControlsReady}
            onClick={showActualOrFit}
          >
            <SizeModeGlyph actual={isActualSize} />
          </button>
        </div>
        <i className="image-lightbox__divider" aria-hidden="true" />
        <div className="image-lightbox__tool-group" aria-label="更多图片工具">
          <button className="image-lightbox__tool" type="button" aria-label="顺时针旋转" data-tooltip="顺时针旋转" disabled={!viewerControlsReady} onClick={rotateClockwise}><RotateGlyph /></button>
          <button
            className="image-lightbox__tool"
            type="button"
            aria-label="下载原图"
            data-tooltip={originalPhase === "error" ? "原图不可用" : downloadableImage ? "下载原图" : "原图加载中"}
            disabled={!downloadableImage}
            onClick={() => downloadableImage && void downloadViewerImage(downloadableImage, state.title, activeIndex)}
          ><DownloadGlyph /></button>
        </div>
      </div>
    </div>
  );
}

function InteractionBar({
  detail,
  onTogglePostLike,
  onTogglePostFavorite,
  postActionLoading,
  favoriteFolders = [],
  favoritePickerOpen = false,
  onSelectFavoriteFolder,
  onCloseFavoritePicker
}: {
  detail: PostDetail;
  onTogglePostLike?: () => void;
  onTogglePostFavorite?: () => void;
  postActionLoading?: "like" | "favorite";
  favoriteFolders?: FavoriteFolder[];
  favoritePickerOpen?: boolean;
  onSelectFavoriteFolder?: (folderId: string) => void;
  onCloseFavoritePicker?: () => void;
}) {
  const postUrl = detail.shareUrl || detail.post.href;
  const favoriteControlRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!favoritePickerOpen || !onCloseFavoritePicker) return;
    const closeOnPointerDown = (event: PointerEvent) => {
      if (!favoriteControlRef.current?.contains(event.target as Node)) onCloseFavoritePicker();
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onCloseFavoritePicker();
    };
    document.addEventListener("pointerdown", closeOnPointerDown);
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnPointerDown);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [favoritePickerOpen, onCloseFavoritePicker]);

  return (
    <footer className="detail-interactions">
      <a className="detail-interactions__comment" href={postUrl} target="_blank" rel="noopener noreferrer">去小黑盒说点什么…</a>
      <button
        className={`detail-interactions__metric detail-interactions__action ${detail.post.isLiked ? "is-active" : ""}`.trim()}
        type="button"
        aria-label={detail.post.isLiked ? "取消点赞" : "点赞帖子"}
        aria-pressed={Boolean(detail.post.isLiked)}
        disabled={!onTogglePostLike || Boolean(postActionLoading)}
        onClick={onTogglePostLike}
      >
        <ThumbUpIcon />
        <b>{formatCount(detail.post.likes)}</b>
      </button>
      <div ref={favoriteControlRef} className="detail-interactions__favorite-control">
        <button
          className={`detail-interactions__metric detail-interactions__action ${detail.post.isFavorited ? "is-active" : ""}`.trim()}
          type="button"
          aria-label={detail.post.isFavorited ? "取消收藏" : "收藏帖子"}
          aria-pressed={Boolean(detail.post.isFavorited)}
          aria-expanded={favoritePickerOpen}
          disabled={!onTogglePostFavorite || Boolean(postActionLoading)}
          onClick={onTogglePostFavorite}
        >
          <StarIcon />
          <b>{formatCount(detail.post.favorites ?? 0)}</b>
        </button>
        {favoritePickerOpen && favoriteFolders.length > 1 && (
          <div className="detail-interactions__favorite-menu" role="menu" aria-label="选择收藏夹">
            <strong>收藏到</strong>
            {favoriteFolders.map((folder) => (
              <button key={folder.id} type="button" role="menuitem" onClick={() => onSelectFavoriteFolder?.(folder.id)}>
                <span>{folder.name}</span>
                <small>{formatCount(folder.count)}</small>
              </button>
            ))}
          </div>
        )}
      </div>
      <span className="detail-interactions__metric"><CommentIcon /><b>{formatCount(detail.post.comments)}</b></span>
      <a className="detail-interactions__share" href={postUrl} target="_blank" rel="noopener noreferrer" aria-label="在小黑盒打开帖子"><ShareGlyph /></a>
    </footer>
  );
}

function DetailSide({
  detail,
  commentsOnly = false,
  onToggleFollow,
  followLoading,
  onTogglePostLike,
  onTogglePostFavorite,
  postActionLoading,
  favoriteFolders,
  favoritePickerOpen,
  onSelectFavoriteFolder,
  onCloseFavoritePicker,
  onToggleCommentLike,
  likingCommentIds,
  onLoadMoreComments,
  loadingMoreComments,
  onLoadMoreReplies,
  loadingReplyIds,
  onImageOpen,
  onImageContextMenu
}: {
  detail: PostDetail;
  commentsOnly?: boolean;
  onToggleFollow?: () => void;
  followLoading?: boolean;
  onTogglePostLike?: () => void;
  onTogglePostFavorite?: () => void;
  postActionLoading?: "like" | "favorite";
  favoriteFolders?: FavoriteFolder[];
  favoritePickerOpen?: boolean;
  onSelectFavoriteFolder?: (folderId: string) => void;
  onCloseFavoritePicker?: () => void;
  onToggleCommentLike?: (commentId: string) => void;
  likingCommentIds?: ReadonlySet<string>;
  onLoadMoreComments?: () => void;
  loadingMoreComments?: boolean;
  onLoadMoreReplies?: (rootCommentId: string) => void;
  loadingReplyIds?: ReadonlySet<string>;
  onImageOpen: OpenImageLightbox;
  onImageContextMenu: ImageContextMenuHandler;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  return (
    <aside className="post-detail__side">
      <header className="post-detail__author">
        <PostByline post={detail.post} compact onToggleFollow={onToggleFollow} followLoading={followLoading} />
      </header>
      <div ref={scrollRef} className="post-detail__scroller">
        {!commentsOnly && (
          <article className="post-detail__content">
            <h1><HeyboxText value={detail.post.title} emojiSize={24} preserveLineBreaks={false} /></h1>
            <ContentBlocks blocks={detail.blocks} fallback={detail.post.excerpt} title={detail.post.title} onImageOpen={onImageOpen} onImageContextMenu={onImageContextMenu} />
            <PostContentTags tags={detail.post.contentTags} />
            <p className="post-detail__metadata">{[detail.post.createdAt, detail.post.ipLocation].filter(Boolean).join(" · ")}</p>
          </article>
        )}
        <CommentsSection
          comments={detail.comments}
          total={detail.post.comments}
          hasMore={detail.hasMoreComments}
          loadingMore={loadingMoreComments}
          onLoadMore={onLoadMoreComments}
          onLoadMoreReplies={onLoadMoreReplies}
          loadingReplyIds={loadingReplyIds}
          onToggleCommentLike={onToggleCommentLike}
          likingCommentIds={likingCommentIds}
          scrollRoot={scrollRef}
          onImageOpen={onImageOpen}
        />
      </div>
      <InteractionBar
        detail={detail}
        onTogglePostLike={onTogglePostLike}
        onTogglePostFavorite={onTogglePostFavorite}
        postActionLoading={postActionLoading}
        favoriteFolders={favoriteFolders}
        favoritePickerOpen={favoritePickerOpen}
        onSelectFavoriteFolder={onSelectFavoriteFolder}
        onCloseFavoritePicker={onCloseFavoritePicker}
      />
    </aside>
  );
}

function ArticlePane({ detail, titleId, onImageOpen, onImageContextMenu }: {
  detail: PostDetail;
  titleId: string;
  onImageOpen: OpenImageLightbox;
  onImageContextMenu: ImageContextMenuHandler;
}) {
  const hasContentTags = Boolean(detail.post.contentTags?.length);
  const scrollRef = useRef<HTMLElement>(null);
  const imageScheduler = useMemo(() => createArticleImageScheduler(), [detail.post.id]);
  useEffect(() => () => imageScheduler.dispose(), [imageScheduler]);
  return (
    <article ref={scrollRef} className="article-pane" tabIndex={0} aria-labelledby={titleId}>
      <header className={`article-pane__header ${hasContentTags ? "article-pane__header--tagged" : ""}`.trim()}>
        <h1 id={titleId}><HeyboxText value={detail.post.title} emojiSize={22} preserveLineBreaks={false} /></h1>
        <p>{[detail.post.createdAt, detail.post.ipLocation].filter(Boolean).join(" · ")}</p>
        <PostContentTags tags={detail.post.contentTags} />
      </header>
      <div className="article-pane__body">
        <ContentBlocks blocks={detail.blocks} fallback={detail.post.excerpt} article title={detail.post.title} onImageOpen={onImageOpen} onImageContextMenu={onImageContextMenu} progressiveImageRoot={scrollRef} progressiveImageScheduler={imageScheduler} />
      </div>
    </article>
  );
}

export function PostDetailModal({
  detail,
  onClose,
  onToggleFollow,
  followLoading,
  onTogglePostLike,
  onTogglePostFavorite,
  postActionLoading,
  favoriteFolders,
  favoritePickerOpen,
  onSelectFavoriteFolder,
  onCloseFavoritePicker,
  onToggleCommentLike,
  likingCommentIds,
  onLoadMoreComments,
  loadingMoreComments,
  onLoadMoreReplies,
  loadingReplyIds,
  onImageOpen,
  onImageContextMenu
}: {
  detail: PostDetail;
  onClose: () => void;
  onToggleFollow?: () => void;
  followLoading?: boolean;
  onTogglePostLike?: () => void;
  onTogglePostFavorite?: () => void;
  postActionLoading?: "like" | "favorite";
  favoriteFolders?: FavoriteFolder[];
  favoritePickerOpen?: boolean;
  onSelectFavoriteFolder?: (folderId: string) => void;
  onCloseFavoritePicker?: () => void;
  onToggleCommentLike?: (commentId: string) => void;
  likingCommentIds?: ReadonlySet<string>;
  onLoadMoreComments?: () => void;
  loadingMoreComments?: boolean;
  onLoadMoreReplies?: (rootCommentId: string) => void;
  loadingReplyIds?: ReadonlySet<string>;
  onImageOpen: OpenImageLightbox;
  onImageContextMenu: ImageContextMenuHandler;
}) {
  const titleId = useId();
  const video = detail.media.find((media): media is VideoMedia => media.kind === "video");
  const images = detail.media.filter((media): media is ImageMedia => media.kind === "image");
  const showsVideo = Boolean(video);
  const showsArticle = !showsVideo && detail.kind === "article";
  const showsImage = !showsVideo && !showsArticle;
  const firstImage = images[0];
  const viewport = useViewportSize();
  const [loadedFirstImage, setLoadedFirstImage] = useState<{ url: string; ratio: number } | null>(null);
  const firstImageRatio = loadedFirstImage && firstImage && loadedFirstImage.url === firstImage.url
    ? loadedFirstImage.ratio
    : validImageRatio(firstImage?.width, firstImage?.height) ?? .75;
  const adaptiveLayout = useMemo(
    () => showsImage ? adaptiveImageDetailLayout(firstImageRatio, viewport) : undefined,
    [firstImageRatio, showsImage, viewport]
  );
  const adaptiveStyle = useMemo<AdaptiveDetailStyle | undefined>(() => adaptiveLayout ? {
    "--detail-height": `${adaptiveLayout.height}px`,
    "--detail-media-width": `${adaptiveLayout.mediaWidth}px`,
    "--detail-side-width": `${adaptiveLayout.sideWidth}px`
  } : undefined, [adaptiveLayout]);

  return (
    <div className={`detail-mask ${showsImage ? "detail-mask--image" : ""}`.trim()} role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section
        className={`post-detail ${showsArticle ? "post-detail--article" : showsVideo ? "post-detail--video" : "post-detail--image"}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        data-first-image-ratio={showsImage ? firstImageRatio.toFixed(4) : undefined}
        data-detail-media-width={adaptiveLayout?.mediaWidth}
        style={adaptiveStyle}
      >
        {!showsArticle && <h1 id={titleId} className="sr-only">{detail.post.title}</h1>}
        <div className="post-detail__media">
          {showsArticle
            ? <ArticlePane detail={detail} titleId={titleId} onImageOpen={onImageOpen} onImageContextMenu={onImageContextMenu} />
            : showsVideo && video
            ? <VideoPlayer media={video} title={detail.post.title} />
            : <ImageGallery
                key={detail.post.id}
                images={images}
                title={detail.post.title}
                topic={detail.post.topic}
                onImageOpen={onImageOpen}
                onImageContextMenu={onImageContextMenu}
                onFirstImageDimensions={(image, width, height) => {
                  if (!firstImage || image.url !== firstImage.url) return;
                  const ratio = validImageRatio(width, height);
                  if (!ratio) return;
                  setLoadedFirstImage((current) => current?.url === image.url && Math.abs(current.ratio - ratio) < .0001
                    ? current
                    : { url: image.url, ratio });
                }}
              />}
        </div>
        <DetailSide
          detail={detail}
          commentsOnly={showsArticle}
          onToggleFollow={onToggleFollow}
          followLoading={followLoading}
          onTogglePostLike={onTogglePostLike}
          onTogglePostFavorite={onTogglePostFavorite}
          postActionLoading={postActionLoading}
          favoriteFolders={favoriteFolders}
          favoritePickerOpen={favoritePickerOpen}
          onSelectFavoriteFolder={onSelectFavoriteFolder}
          onCloseFavoritePicker={onCloseFavoritePicker}
          onToggleCommentLike={onToggleCommentLike}
          likingCommentIds={likingCommentIds}
          onLoadMoreComments={onLoadMoreComments}
          loadingMoreComments={loadingMoreComments}
          onLoadMoreReplies={onLoadMoreReplies}
          loadingReplyIds={loadingReplyIds}
          onImageOpen={onImageOpen}
          onImageContextMenu={onImageContextMenu}
        />
      </section>
    </div>
  );
}

export function DetailViews({
  detail,
  error,
  onClose,
  onToggleFollow,
  followLoading = false,
  onTogglePostLike,
  onTogglePostFavorite,
  postActionLoading,
  favoriteFolders,
  favoritePickerOpen,
  onSelectFavoriteFolder,
  onCloseFavoritePicker,
  onToggleCommentLike,
  likingCommentIds,
  onRetry,
  onLoadMoreComments,
  loadingMoreComments = false,
  onLoadMoreReplies,
  loadingReplyIds,
  onImageContextMenu
}: DetailViewsProps) {
  const layerRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  const [lightbox, setLightbox] = useState<ImageLightboxState | null>(null);
  const lightboxOpenRef = useRef(false);
  const lightboxOpenerRef = useRef<HTMLElement | null>(null);
  onCloseRef.current = onClose;
  lightboxOpenRef.current = Boolean(lightbox);

  function openImageLightbox(images: ImageMedia[], activeIndex: number, title: string) {
    const usableEntries = images
      .map((image, originalIndex) => ({ image, originalIndex }))
      .filter(({ image }) => Boolean(image.thumbnail || image.url));
    if (!usableEntries.length) return;
    const normalizedIndex = Math.max(0, usableEntries.findIndex(({ originalIndex }) => originalIndex === activeIndex));
    lightboxOpenerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setLightbox({ images: usableEntries.map(({ image }) => image), activeIndex: normalizedIndex, title });
  }

  function closeImageLightbox() {
    const opener = lightboxOpenerRef.current;
    setLightbox(null);
    lightboxOpenerRef.current = null;
    window.requestAnimationFrame(() => {
      if (opener?.isConnected) opener.focus();
    });
  }

  function moveLightbox(delta: number) {
    setLightbox((current) => {
      if (!current?.images.length) return current;
      return {
        ...current,
        activeIndex: Math.max(0, Math.min(current.activeIndex + delta, current.images.length - 1))
      };
    });
  }

  useEffect(() => {
    const layer = layerRef.current;
    const appShell = document.querySelector<HTMLElement>(".app-shell");
    const appShellWasInert = appShell?.hasAttribute("inert") ?? false;
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    appShell?.setAttribute("inert", "");

    const focusableElements = () => {
      const focusScope = layer?.querySelector<HTMLElement>(".image-lightbox") ?? layer;
      return Array.from(focusScope?.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
      ) ?? []).filter((element) => element.getClientRects().length > 0);
    };

    function handleKeyDown(event: globalThis.KeyboardEvent) {
      if (document.documentElement.hasAttribute(IMAGE_CONTEXT_MENU_OPEN_ATTRIBUTE)) return;
      if (event.key === "Escape") {
        if (lightboxOpenRef.current) return;
        event.preventDefault();
        onCloseRef.current();
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = focusableElements();
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;
      if (event.shiftKey && (active === first || !layer?.contains(active))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (active === last || !layer?.contains(active))) {
        event.preventDefault();
        first.focus();
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    const focusFrame = window.requestAnimationFrame(() => {
      if (!layer?.contains(document.activeElement)) focusableElements()[0]?.focus();
    });
    return () => {
      window.cancelAnimationFrame(focusFrame);
      window.removeEventListener("keydown", handleKeyDown);
      if (appShell && !appShellWasInert) appShell.removeAttribute("inert");
      if (previouslyFocused?.isConnected) previouslyFocused.focus();
    };
  }, []);

  return (
    <div ref={layerRef} className="detail-layer">
      {error && (
        <div className="detail-inline-error" role="alert">
          <span>{error}</span>
          {onRetry && <button type="button" onClick={onRetry}>重新加载</button>}
        </div>
      )}
      <PostDetailModal
        detail={detail}
        onClose={onClose}
        onToggleFollow={onToggleFollow}
        followLoading={followLoading}
        onTogglePostLike={onTogglePostLike}
        onTogglePostFavorite={onTogglePostFavorite}
        postActionLoading={postActionLoading}
        favoriteFolders={favoriteFolders}
        favoritePickerOpen={favoritePickerOpen}
        onSelectFavoriteFolder={onSelectFavoriteFolder}
        onCloseFavoritePicker={onCloseFavoritePicker}
        onToggleCommentLike={onToggleCommentLike}
        likingCommentIds={likingCommentIds}
        onLoadMoreComments={onLoadMoreComments}
        loadingMoreComments={loadingMoreComments}
        onLoadMoreReplies={onLoadMoreReplies}
        loadingReplyIds={loadingReplyIds}
        onImageOpen={openImageLightbox}
        onImageContextMenu={onImageContextMenu}
      />
      {lightbox && (
        <ImageLightbox
          state={lightbox}
          onClose={closeImageLightbox}
          onMove={moveLightbox}
          onImageContextMenu={onImageContextMenu}
        />
      )}
    </div>
  );
}
