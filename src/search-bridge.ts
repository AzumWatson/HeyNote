interface InternalResponse {
  ok: boolean;
  error?: string;
}

const HOME_URL = "https://www.xiaoheihe.cn/app/bbs/home";
const MODE_KEY = "xiaoheishu:browse-mode";
const RESULT_KEY = "xiaoheishu:search-bridge-result";
const BRIDGE_PARAM = "xiaoheishu_bridge";
const BRIDGE_EVENT = "xiaoheishu:search-bridge-result";
const STATUS_ID = "xiaoheishu-search-bridge-status";
const TIMEOUT_MS = 12_000;

function queryKeyword(): string {
  const params = new URLSearchParams(location.search);
  return (params.get("q") || params.get("keyword") || "").trim();
}

function bridgeId(): string {
  return new URLSearchParams(location.search).get(BRIDGE_PARAM)?.trim() || "";
}

function isSilentBridge(): boolean {
  return new URLSearchParams(location.search).get("xiaoheishu_silent") === "1";
}

function returnHome(id: string): void {
  const url = new URL(HOME_URL);
  url.hash = `/feed?search_bridge=${encodeURIComponent(id)}`;
  location.replace(url.href);
}

async function closeBridgeTab(id: string): Promise<void> {
  try {
    await chrome.runtime.sendMessage({
      channel: "xiaoheishu-internal",
      operation: "close-search-bridge-tab",
      bridgeId: id
    });
  } catch {
    returnHome(id);
  }
}

function hideOriginalSearchPage(keyword: string): void {
  const style = document.createElement("style");
  style.textContent = `
    html, body {
      background: #f7f7f5 !important;
      overflow: hidden !important;
    }
    body > * {
      visibility: hidden !important;
    }
    #${STATUS_ID} {
      position: fixed;
      inset: 0;
      display: grid;
      place-items: center;
      z-index: 2147483647;
      visibility: visible !important;
      color: #171717;
      background: #f7f7f5;
      font: 600 14px/1.4 -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", sans-serif;
    }
    @media (prefers-color-scheme: dark) {
      html, body, #${STATUS_ID} {
        color: #f2f2ee;
        background: #111210 !important;
      }
    }
  `;
  (document.head ?? document.documentElement).appendChild(style);

  const status = document.createElement("div");
  status.id = STATUS_ID;
  status.textContent = `正在同步原站搜索：${keyword}`;
  (document.body ?? document.documentElement).appendChild(status);
}

function setNativeValue(element: HTMLInputElement | HTMLTextAreaElement, value: string): void {
  const prototype = element instanceof HTMLTextAreaElement
    ? HTMLTextAreaElement.prototype
    : HTMLInputElement.prototype;
  const descriptor = Object.getOwnPropertyDescriptor(prototype, "value");
  descriptor?.set?.call(element, value);
}

function candidateSearchInputs(): Array<HTMLInputElement | HTMLTextAreaElement> {
  const fields = Array.from(document.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>("input, textarea"));
  return fields.filter((field) => {
    if (field.disabled || field.readOnly) return false;
    const type = field instanceof HTMLInputElement ? field.type.toLowerCase() : "textarea";
    if (!["", "text", "search", "textarea"].includes(type)) return false;
    const haystack = [
      field.placeholder,
      field.ariaLabel,
      field.name,
      field.id,
      field.className
    ].join(" ").toLowerCase();
    return haystack.includes("search") || haystack.includes("搜索") || fields.length === 1;
  });
}

function triggerOriginalSearch(keyword: string): boolean {
  const input = candidateSearchInputs()[0];
  if (!input) return false;

  input.focus();
  setNativeValue(input, keyword);
  input.dispatchEvent(new InputEvent("input", { bubbles: true, data: keyword, inputType: "insertText" }));
  input.dispatchEvent(new Event("change", { bubbles: true }));
  input.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: "Enter", code: "Enter" }));
  input.dispatchEvent(new KeyboardEvent("keyup", { bubbles: true, cancelable: true, key: "Enter", code: "Enter" }));

  const form = input.closest("form");
  if (form) {
    form.dispatchEvent(new SubmitEvent("submit", { bubbles: true, cancelable: true, submitter: null }));
    if (typeof form.requestSubmit === "function") {
      try {
        form.requestSubmit();
      } catch {
        // React-controlled forms may intentionally prevent native submission.
      }
    }
  }

  const buttons = Array.from(document.querySelectorAll<HTMLButtonElement>("button"));
  const searchButton = buttons.find((button) => {
    const text = `${button.textContent ?? ""} ${button.ariaLabel ?? ""} ${button.title ?? ""}`.toLowerCase();
    return !button.disabled && (text.includes("search") || text.includes("搜索"));
  });
  searchButton?.click();
  return true;
}

function startSearchTriggerLoop(keyword: string): number {
  let attempts = 0;
  const tick = () => {
    attempts += 1;
    triggerOriginalSearch(keyword);
    if (attempts >= 30) window.clearInterval(timer);
  };
  const timer = window.setInterval(tick, 300);
  window.setTimeout(tick, 0);
  return timer;
}

function postIdFromHref(href: string): string {
  try {
    const url = new URL(href, location.href);
    const match = url.pathname.match(/\/app\/bbs\/link\/([^/?#]+)/i);
    return match?.[1] ? decodeURIComponent(match[1]).trim() : "";
  } catch {
    return "";
  }
}

function cleanText(value: string | null | undefined): string {
  return (value ?? "").replace(/\s+/g, " ").trim();
}

function cleanDomTitle(value: string): string {
  return cleanText(value)
    .replace(/^.+?\s+Lv\.?\s*\d+\s+/i, "")
    .replace(/\s+(?:\d{1,2}月\d{1,2}日|\d{1,2}-\d{1,2}|\d{4}-\d{1,2}-\d{1,2}).*$/, "")
    .replace(/\s+(?:评论|回复|收藏|分享|点赞|藏)\s*\d*.*$/, "")
    .trim();
}

function cleanMetadataText(value: string): string {
  return cleanText(value)
    .replace(/[^\p{Letter}\p{Number}\u4e00-\u9fff#._\-\s]/gu, "")
    .trim();
}

function reliableTopicText(value: string, title: string): string {
  const cleaned = cleanMetadataText(value)
    .replace(/^#+|#+$/g, "")
    .replace(/\bLv\.?\s*\d{1,3}\b/gi, "")
    .replace(/\b\d{4}[年/-]\d{1,2}[月/-]\d{1,2}日?\b/g, "")
    .replace(/\b\d{1,2}[月/-]\d{1,2}日?\b/g, "")
    .trim();
  if (!cleaned || cleaned.length < 2 || cleaned.length > 24) return "";
  if (/[\uFFFD\uE000-\uF8FF]/.test(cleaned)) return "";
  if (/[\u00c0-\u00ff]{2,}/i.test(cleaned)) return "";
  if (/(全部|筛选|搜索|评论|收藏|分享|点赞|回复|查看|文章|视频|图文|最近|浏览|用户|综合|发现|关注|粉丝)/.test(cleaned)) {
    return "";
  }
  if (/^(?:\d+|IP\s*\S+|Lv\.?\s*\d+)$/i.test(cleaned)) return "";
  if (title && cleaned.length > 8 && title.includes(cleaned)) return "";
  return cleaned;
}

function textBeforeTitle(container: HTMLElement, title: string): string {
  const allText = cleanText(container.textContent);
  const index = allText.indexOf(title);
  return index > 0 ? allText.slice(0, index).trim() : "";
}

function textAfterTitle(container: HTMLElement, title: string): string {
  const allText = cleanText(container.textContent);
  const index = allText.indexOf(title);
  return index >= 0 ? allText.slice(index + title.length).trim() : "";
}

function looseTopicFromText(value: string, title: string): string {
  const leading = value
    .split(/(?:\d{4}[年/-])?\d{1,2}[月/-]\d{1,2}日?|评论|回复|收藏|分享|点赞|藏|赞/)[0]
    ?.trim() ?? "";
  const direct = reliableTopicText(leading, title);
  if (direct) return direct;
  const tokens = leading.split(/\s+/).filter(Boolean).slice(-4);
  for (const token of tokens) {
    const candidate = reliableTopicText(token, title);
    if (candidate) return candidate;
  }
  return "";
}

function normalizedImageUrl(image: HTMLImageElement): string | undefined {
  const raw = image.currentSrc
    || image.src
    || image.dataset.src
    || image.getAttribute("data-original")
    || image.getAttribute("data-lazy-src")
    || "";
  if (!raw || /^data:/i.test(raw) || /^blob:/i.test(raw)) return undefined;
  try {
    return new URL(raw, location.href).href;
  } catch {
    return undefined;
  }
}

function imageCandidatesFromContainer(container: HTMLElement): Array<{ image: HTMLImageElement; url: string }> {
  const seen = new Set<string>();
  return Array.from(container.querySelectorAll<HTMLImageElement>("img[src], img[data-src], img[data-original], img[data-lazy-src]"))
    .flatMap((image) => {
      const url = normalizedImageUrl(image);
      if (!url || seen.has(url)) return [];
      seen.add(url);
      return [{ image, url }];
    });
}

function isLikelyPostImage(image: HTMLImageElement): boolean {
  const label = [
    image.className,
    image.alt,
    image.title,
    image.getAttribute("aria-label"),
    image.parentElement?.className
  ].join(" ").toLowerCase();
  if (/(avatar|user|profile|head|icon|emoji|logo|badge|level|topic|tag|category|forum|community|头像|图标|分区)/i.test(label)) {
    return false;
  }

  const rect = image.getBoundingClientRect();
  const renderedMax = Math.max(rect.width, rect.height);
  const naturalMax = Math.max(image.naturalWidth || 0, image.naturalHeight || 0);
  if (renderedMax > 0 && renderedMax < 44) return false;
  if (renderedMax === 0 && naturalMax > 0 && naturalMax < 80) return false;
  return true;
}

function topicIdFromHref(href: string): string {
  try {
    const url = new URL(href, location.href);
    const direct = url.searchParams.get("topic_id")
      || url.searchParams.get("category_id")
      || url.searchParams.get("forum_id")
      || url.searchParams.get("community_id");
    if (direct) return direct.trim();
    const match = url.pathname.match(/\/app\/bbs\/(?:topic|forum|community|category)\/([^/?#]+)/i);
    return match?.[1] ? decodeURIComponent(match[1]).trim() : "";
  } catch {
    return "";
  }
}

function topicMetadataFromContainer(container: HTMLElement, title: string, before: string, after: string): Record<string, string> {
  const selectors = [
    "[data-topic-id]",
    "[data-category-id]",
    "[data-forum-id]",
    "a[href*='topic_id']",
    "a[href*='category_id']",
    "a[href*='forum_id']",
    "a[href*='/topic/']",
    "a[href*='/forum/']",
    "a[href*='/community/']",
    "[class*='topic']",
    "[class*='category']",
    "[class*='forum']",
    "[class*='community']"
  ].join(",");

  for (const element of Array.from(container.querySelectorAll<HTMLElement>(selectors))) {
    const name = reliableTopicText(element.textContent ?? "", title);
    if (!name) continue;
    const anchor = element instanceof HTMLAnchorElement ? element : element.closest<HTMLAnchorElement>("a[href]");
    const icon = element.querySelector<HTMLImageElement>("img");
    return {
      topic_name: name,
      topic_id: anchor ? topicIdFromHref(anchor.href) : cleanText(element.dataset.topicId || element.dataset.categoryId || element.dataset.forumId),
      topic_icon: icon ? normalizedImageUrl(icon) ?? "" : ""
    };
  }

  const levelMatch = before.match(/Lv\.?\s*(\d{1,3})/i);
  const name = levelMatch
    ? reliableTopicText(before.slice((levelMatch.index ?? 0) + levelMatch[0].length), title)
    : looseTopicFromText(before, title);
  if (name) return { topic_name: name };

  const afterName = looseTopicFromText(after, title);
  return afterName ? { topic_name: afterName } : {};
}

function domMetadata(container: HTMLElement, title: string): Record<string, string | number> {
  const metadata: Record<string, string | number> = {};
  const before = textBeforeTitle(container, title);
  const after = textAfterTitle(container, title);
  const levelMatch = before.match(/Lv\.?\s*(\d{1,3})/i);
  if (levelMatch) {
    metadata.level = `Lv.${levelMatch[1]}`;
    const author = cleanMetadataText(before.slice(0, levelMatch.index).split(/\s+/).filter(Boolean).at(-1) ?? "");
    if (author && author.length <= 24) metadata.username = author;
  }
  Object.assign(metadata, topicMetadataFromContainer(container, title, before, after));

  const date = after.match(/(?:\d{4}[年/-])?\d{1,2}[月/-]\d{1,2}日?/);
  if (date) metadata.create_at = date[0];
  const comments = after.match(/(?:评论|回复)\s*(\d+)/);
  const favorites = after.match(/(?:藏|收藏)\s*(\d+)/);
  const likes = after.match(/(?:赞|点赞)\s*(\d+)/);
  if (comments) metadata.comment_num = Number(comments[1]);
  if (favorites) metadata.favour_count = Number(favorites[1]);
  if (likes) metadata.link_award_num = Number(likes[1]);
  return metadata;
}

function bestContainerFor(anchor: HTMLAnchorElement): HTMLElement {
  let current: HTMLElement | null = anchor;
  let fallback: HTMLElement = anchor;
  for (let depth = 0; current && depth < 8; depth += 1) {
    const text = cleanText(current.textContent);
    const linkCount = current.querySelectorAll("a[href*='/app/bbs/link/']").length;
    if (text.length >= 12 && text.length <= 520 && linkCount <= 2) {
      fallback = current;
    }
    if (/^(article|li)$/i.test(current.tagName)) return current;
    if (current.className && /(?:link|post|search|item|card)/i.test(String(current.className)) && text.length <= 720) {
      return current;
    }
    if (/^(main|body|html)$/i.test(current.tagName)) break;
    current = current.parentElement;
  }
  return fallback;
}

function titleFromContainer(anchor: HTMLAnchorElement, container: HTMLElement): string {
  const headings = Array.from(container.querySelectorAll<HTMLElement>("h1, h2, h3, h4, [class*='title']"));
  const attributeCandidates = [
    anchor.getAttribute("title"),
    anchor.getAttribute("aria-label")
  ].map((value) => cleanDomTitle(value ?? ""));
  for (const text of attributeCandidates) {
    if (text && text.length >= 2 && text.length <= 120) return text;
  }
  for (const node of [...headings, anchor]) {
    const text = cleanDomTitle(node.textContent ?? "");
    if (text && text.length >= 2 && text.length <= 120) return text;
  }
  return cleanDomTitle(anchor.textContent ?? "").slice(0, 120);
}

function searchPayloadFromDom(): unknown | null {
  const anchors = Array.from(document.querySelectorAll<HTMLAnchorElement>("a[href*='/app/bbs/link/']"));
  const seen = new Set<string>();
  const links = anchors.flatMap((anchor) => {
    const href = new URL(anchor.getAttribute("href") || anchor.href, location.href).href;
    const id = postIdFromHref(href);
    if (!id || seen.has(id)) return [];
    const container = bestContainerFor(anchor);
    const title = titleFromContainer(anchor, container);
    if (!title) return [];
    const metadata = domMetadata(container, title);
    const imageCandidates = imageCandidatesFromContainer(container);
    const avatar = imageCandidates[0]?.url;
    const imgs = imageCandidates
      .slice(1)
      .filter(({ image }) => isLikelyPostImage(image))
      .map(({ url }) => url)
      .slice(0, 9);
    seen.add(id);
    return [{
      linkid: id,
      link_id: id,
      title,
      description: "",
      share_url: href,
      avatar,
      imgs,
      content_type: 0,
      ...metadata,
      xiaoheishu_dom_search: 1
    }];
  });

  if (!links.length) return null;
  return {
    status: "ok",
    result: {
      links,
      has_more: 0
    }
  };
}

function startDomResultLoop(finish: (value: unknown) => Promise<void>, id: string, keyword: string): number {
  let attempts = 0;
  const tick = () => {
    attempts += 1;
    const payload = searchPayloadFromDom();
    if (payload) {
      void finish({
        id,
        keyword,
        url: location.href,
        payload,
        capturedAt: Date.now()
      });
    }
    if (attempts >= 24) window.clearInterval(timer);
  };
  const timer = window.setInterval(tick, 500);
  window.setTimeout(tick, 800);
  return timer;
}

async function storeResult(value: unknown): Promise<void> {
  await chrome.storage.local.set({
    [MODE_KEY]: "xiaoheishu",
    [RESULT_KEY]: value
  });
}

async function installMainBridge(id: string, keyword: string): Promise<void> {
  const response = await chrome.runtime.sendMessage({
    channel: "xiaoheishu-internal",
    operation: "install-search-bridge-main",
    bridgeId: id,
    keyword
  }) as InternalResponse;
  if (!response?.ok) throw new Error(response?.error || "Search bridge injection failed");
}

async function start(): Promise<void> {
  if (location.hostname !== "www.xiaoheihe.cn" || !location.pathname.startsWith("/app/search")) return;
  const id = bridgeId();
  if (!id) return;

  const keyword = queryKeyword();
  if (!keyword) {
    await storeResult({
      id,
      keyword,
      error: "No search keyword was received",
      capturedAt: Date.now()
    });
    returnHome(id);
    return;
  }

  const silent = isSilentBridge();
  hideOriginalSearchPage(keyword);

  let settled = false;
  let triggerTimer = 0;
  let domTimer = 0;
  const finish = async (value: unknown) => {
    if (settled) return;
    settled = true;
    window.clearTimeout(timeout);
    if (triggerTimer) window.clearInterval(triggerTimer);
    if (domTimer) window.clearInterval(domTimer);
    window.removeEventListener(BRIDGE_EVENT, onResult);
    await storeResult(value);
    if (silent) await closeBridgeTab(id);
    else returnHome(id);
  };

  const onResult = (event: Event) => {
    const rawDetail = (event as CustomEvent<unknown>).detail;
    let detail: Record<string, unknown>;
    try {
      detail = JSON.parse(typeof rawDetail === "string" ? rawDetail : "") as Record<string, unknown>;
    } catch {
      return;
    }
    if (detail.bridgeId !== id) return;
    void finish({
      id,
      keyword,
      url: typeof detail.url === "string" ? detail.url : undefined,
      payload: detail.data,
      capturedAt: Date.now()
    });
  };

  const timeout = window.setTimeout(() => {
    void finish({
      id,
      keyword,
      error: "The original search page did not return parseable search results",
      capturedAt: Date.now()
    });
  }, TIMEOUT_MS);

  window.addEventListener(BRIDGE_EVENT, onResult);

  try {
    await installMainBridge(id, keyword);
    triggerTimer = startSearchTriggerLoop(keyword);
    domTimer = startDomResultLoop(finish, id, keyword);
  } catch (error) {
    await finish({
      id,
      keyword,
      error: error instanceof Error ? error.message : "Search bridge injection failed",
      capturedAt: Date.now()
    });
  }
}

void start();

export {};
