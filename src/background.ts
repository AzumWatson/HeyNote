type JsonScalar = string | number | boolean | null;

interface HeyboxApiMessage {
  channel: "xiaoheishu-api";
  operation: "feed" | "feedBanner" | "communityFeed" | "search" | "searchWelcome" | "searchFound" | "searchSuggestion" | "detail" | "comments" | "commentReplies" | "originalImage" | "favoriteFolders" | "likePost" | "favoritePost" | "likeComment" | "followUser" | "unfollowUser" | "followSearchUser" | "unfollowSearchUser";
  params?: Record<string, JsonScalar>;
}

type BrowseMode = "original" | "xiaoheishu";

type InternalMessage =
  | {
      channel: "xiaoheishu-internal";
      operation: "mount-domain-entry";
    }
  | {
      channel: "xiaoheishu-internal";
      operation: "switch-mode";
      mode: BrowseMode;
    }
  | {
      channel: "xiaoheishu-internal";
      operation: "download-image";
      url: string;
      filename: string;
    }
  | {
      channel: "xiaoheishu-internal";
      operation: "copy-image";
      url: string;
    };

type HeyboxApiResponse =
  | { ok: true; data: unknown }
  | { ok: false; error: string };

type InjectedResponse =
  | { ok: true; data: unknown }
  | { ok: false; error: string };

const MODE_KEY = "xiaoheishu:browse-mode";
const VERSION_KEY = "xiaoheishu:loaded-version";
const HOME_PATH = "/app/bbs/home";
const HOME_URL = `https://www.xiaoheihe.cn${HOME_PATH}`;
const HOME_MATCH = `${HOME_URL}*`;

const OPERATION_PATHS: Record<HeyboxApiMessage["operation"], string> = {
  feed: "/bbs/app/feeds",
  feedBanner: "/bbs/app/feeds/banner",
  communityFeed: "/bbs/app/topic/feeds",
  search: "/bbs/app/api/general/search/v1",
  searchWelcome: "/bbs/app/api/search/welcome_page/v2",
  searchFound: "/bbs/app/api/search/found",
  searchSuggestion: "/bbs/app/api/search/suggestion/v2",
  detail: "/bbs/app/link/tree",
  comments: "/bbs/app/link/tree",
  commentReplies: "/bbs/app/comment/sub/comments",
  originalImage: "/bbs/app/api/original/image",
  favoriteFolders: "/bbs/app/profile/fav/folders",
  likePost: "/bbs/app/profile/award/link",
  favoritePost: "/bbs/app/link/favour",
  likeComment: "/bbs/app/comment/support",
  followUser: "/bbs/app/profile/follow/user",
  unfollowUser: "/bbs/app/profile/follow/user/cancel",
  followSearchUser: "/bbs/app/profile/follow/user",
  unfollowSearchUser: "/bbs/app/profile/follow/user/cancel"
};

const WORKSHOP_API_OPERATIONS = new Set<HeyboxApiMessage["operation"]>([
  "favoriteFolders",
  "likePost",
  "favoritePost",
  "likeComment"
]);

const OFFICIAL_IMAGE_HOST_SUFFIXES = ["max-c.com", "xiaoheihe.cn"] as const;
const MAX_ORIGINAL_IMAGE_URL_LENGTH = 8_192;
const MAX_COPY_IMAGE_BYTES = 32 * 1024 * 1024;
const MAX_COPY_PNG_BYTES = 24 * 1024 * 1024;
const MAX_COPY_IMAGE_PIXELS = 64_000_000;

function errorText(error: unknown): string {
  return error instanceof Error && error.message ? error.message : String(error || "未知错误");
}

function isHeyboxForumUrl(url: string | undefined): boolean {
  if (!url) return false;
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:"
      && parsed.hostname === "www.xiaoheihe.cn"
      && parsed.pathname.startsWith("/app/bbs/");
  } catch {
    return false;
  }
}

function isHomePageUrl(url: string | undefined): boolean {
  if (!url) return false;
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:"
      && parsed.hostname === "www.xiaoheihe.cn"
      && parsed.pathname === HOME_PATH;
  } catch {
    return false;
  }
}

async function downloadImage(message: Extract<InternalMessage, { operation: "download-image" }>, sender: chrome.runtime.MessageSender): Promise<void> {
  if (sender.id !== chrome.runtime.id || !isHomePageUrl(sender.url)) {
    throw new Error("只能从 HeyNote 小黑书页面下载图片");
  }

  const imageUrl = originalImageUrlValue(message.url);

  const filename = message.filename
    .normalize("NFKC")
    .replace(/[\\/:*?"<>|\u0000-\u001f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);
  if (!filename) throw new Error("下载文件名无效");

  await chrome.downloads.download({
    url: imageUrl,
    filename,
    conflictAction: "uniquify",
    saveAs: false
  });
}

async function responseImageBlob(response: Response, contentType: string): Promise<Blob> {
  const statedLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(statedLength) && statedLength > MAX_COPY_IMAGE_BYTES) {
    throw new Error("图片超过 32 MiB，无法复制");
  }

  const reader = response.body?.getReader();
  if (!reader) {
    const blob = await response.blob();
    if (blob.size > MAX_COPY_IMAGE_BYTES) throw new Error("图片超过 32 MiB，无法复制");
    return new Blob([await blob.arrayBuffer()], { type: contentType });
  }

  const chunks: ArrayBuffer[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_COPY_IMAGE_BYTES) {
        await reader.cancel().catch(() => undefined);
        throw new Error("图片超过 32 MiB，无法复制");
      }
      const copy = new Uint8Array(value.byteLength);
      copy.set(value);
      chunks.push(copy.buffer);
    }
  } finally {
    reader.releaseLock();
  }
  return new Blob(chunks, { type: contentType });
}

async function imageBlobAsPng(source: Blob, contentType: string): Promise<Blob> {
  if (contentType === "image/png") return source;

  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(source);
  } catch {
    throw new Error("浏览器无法解码这张图片");
  }
  try {
    if (!bitmap.width || !bitmap.height || bitmap.width * bitmap.height > MAX_COPY_IMAGE_PIXELS) {
      throw new Error("图片像素尺寸过大，无法复制");
    }
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const context = canvas.getContext("2d");
    if (!context) throw new Error("浏览器无法创建图片画布");
    context.drawImage(bitmap, 0, 0);
    return await canvas.convertToBlob({ type: "image/png" });
  } finally {
    bitmap.close();
  }
}

async function pngDataUrl(blob: Blob): Promise<string> {
  if (blob.size > MAX_COPY_PNG_BYTES) throw new Error("转换后的 PNG 超过 24 MiB，无法复制");
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const chunks: string[] = [];
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    chunks.push(String.fromCharCode(...bytes.subarray(offset, offset + chunkSize)));
  }
  return `data:image/png;base64,${btoa(chunks.join(""))}`;
}

async function copyImageData(
  message: Extract<InternalMessage, { operation: "copy-image" }>,
  sender: chrome.runtime.MessageSender
): Promise<{ dataUrl: string }> {
  if (sender.id !== chrome.runtime.id || !isHomePageUrl(sender.url)) {
    throw new Error("只能从 HeyNote 小黑书页面复制图片");
  }

  const imageUrl = originalImageUrlValue(message.url);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30_000);
  try {
    const response = await fetch(imageUrl, {
      credentials: "omit",
      cache: "no-store",
      redirect: "follow",
      referrerPolicy: "no-referrer",
      signal: controller.signal
    });
    if (!response.ok) throw new Error(`图片请求失败（HTTP ${response.status}）`);

    // Redirects must not escape the same official image-host allowlist.
    originalImageUrlValue(response.url);
    const contentType = (response.headers.get("content-type") ?? "").split(";", 1)[0].trim().toLocaleLowerCase("en-US");
    if (!contentType.startsWith("image/")) throw new Error("图片响应的内容类型无效");

    const source = await responseImageBlob(response, contentType);
    const png = await imageBlobAsPng(source, contentType);
    return { dataUrl: await pngDataUrl(png) };
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new Error("图片请求超时，请稍后重试");
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function setBrowseMode(mode: BrowseMode): Promise<void> {
  await chrome.storage.local.set({ [MODE_KEY]: mode });
}

async function reloadHomeTabsAfterVersionChange(): Promise<void> {
  const version = chrome.runtime.getManifest().version;
  const stored = await chrome.storage.local.get(VERSION_KEY);
  if (stored[VERSION_KEY] === version) return;

  // Persist before reloading so the replacement service worker cannot create a loop.
  await chrome.storage.local.set({ [VERSION_KEY]: version });
  const tabs = await chrome.tabs.query({ url: HOME_MATCH });
  await Promise.allSettled(tabs.map((tab) => (
    typeof tab.id === "number" ? chrome.tabs.reload(tab.id) : Promise.resolve()
  )));
}

async function focusOrOpenHome(preferredTab?: chrome.tabs.Tab): Promise<void> {
  await setBrowseMode("xiaoheishu");

  if (typeof preferredTab?.id === "number" && isHeyboxForumUrl(preferredTab.url)) {
    if (isHomePageUrl(preferredTab.url)) {
      await chrome.tabs.reload(preferredTab.id);
    } else {
      await chrome.tabs.update(preferredTab.id, { url: HOME_URL, active: true });
    }
    return;
  }

  const existing = (await chrome.tabs.query({ url: HOME_MATCH }))
    .find((tab) => typeof tab.id === "number");
  if (typeof existing?.id === "number") {
    await chrome.tabs.update(existing.id, { active: true });
    if (typeof existing.windowId === "number") {
      await chrome.windows.update(existing.windowId, { focused: true });
    }
    await chrome.tabs.reload(existing.id);
    return;
  }

  await chrome.tabs.create({ url: HOME_URL, active: true });
}

function paramsRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("API params 必须是普通对象");
  }
  return value as Record<string, unknown>;
}

function requireExactKeys(params: Record<string, unknown>, expected: string[]): void {
  const actual = Object.keys(params);
  const missing = expected.filter((key) => !Object.prototype.hasOwnProperty.call(params, key));
  const unexpected = actual.filter((key) => !expected.includes(key));
  if (missing.length || unexpected.length) {
    const details = [
      missing.length ? `缺少 ${missing.join(", ")}` : "",
      unexpected.length ? `不允许 ${unexpected.join(", ")}` : ""
    ].filter(Boolean).join("；");
    throw new Error(`API params 字段不正确：${details}`);
  }
}

function requireKeys(
  params: Record<string, unknown>,
  required: string[],
  optional: string[]
): void {
  const actual = Object.keys(params);
  const missing = required.filter((key) => !Object.prototype.hasOwnProperty.call(params, key));
  const allowed = new Set([...required, ...optional]);
  const unexpected = actual.filter((key) => !allowed.has(key));
  if (missing.length || unexpected.length) {
    const details = [
      missing.length ? `缺少 ${missing.join(", ")}` : "",
      unexpected.length ? `不允许 ${unexpected.join(", ")}` : ""
    ].filter(Boolean).join("；");
    throw new Error(`API params 字段不正确：${details}`);
  }
}

function finiteNumber(value: unknown, name: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`API 参数 ${name} 必须是有限数字`);
  }
  return value;
}

function linkIdValue(value: unknown): string {
  if ((typeof value !== "string" && typeof value !== "number")
    || (typeof value === "number" && !Number.isFinite(value))) {
    throw new Error("API 参数 linkId 必须是有效字符串或数字");
  }
  const linkId = String(value).trim();
  if (!linkId) throw new Error("API 参数 linkId 不能为空");
  if (linkId.length > 64 || /[\u0000-\u001f\u007f]/.test(linkId)) {
    throw new Error("API 参数 linkId 格式不正确");
  }
  return linkId;
}

function commentIdValue(value: unknown, name: string, allowEmpty = false): string {
  if ((typeof value !== "string" && typeof value !== "number")
    || (typeof value === "number" && !Number.isFinite(value))) {
    throw new Error(`API 参数 ${name} 必须是有效字符串或数字`);
  }
  const id = String(value).trim();
  if (!id && !allowEmpty) throw new Error(`API 参数 ${name} 不能为空`);
  if (id.length > 64 || /[\u0000-\u001f\u007f]/.test(id)) {
    throw new Error(`API 参数 ${name} 格式不正确`);
  }
  return id;
}

function paginationValue(value: unknown, name: string): string {
  if ((typeof value !== "string" && typeof value !== "number")
    || (typeof value === "number" && !Number.isFinite(value))) {
    throw new Error(`API 参数 ${name} 必须是有效字符串或数字`);
  }
  const token = String(value).trim();
  if (token.length > 2_048 || /[\u0000-\u001f\u007f]/.test(token)) {
    throw new Error(`API 参数 ${name} 格式不正确`);
  }
  return token;
}

function originalImageUrlValue(value: unknown): string {
  if (typeof value !== "string") {
    throw new Error("API 参数 url 必须是图片地址字符串");
  }
  const raw = value.trim();
  if (!raw || raw.length > MAX_ORIGINAL_IMAGE_URL_LENGTH || /[\u0000-\u001f\u007f]/.test(raw)) {
    throw new Error("API 参数 url 长度或格式不正确");
  }

  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error("API 参数 url 不是有效地址");
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new Error("API 参数 url 只支持 HTTP 图片地址");
  }
  if (parsed.username || parsed.password || parsed.hash) {
    throw new Error("API 参数 url 不能包含凭据或片段");
  }
  if (parsed.port && parsed.port !== "80" && parsed.port !== "443") {
    throw new Error("API 参数 url 端口不正确");
  }

  const hostname = parsed.hostname.toLocaleLowerCase("en-US").replace(/\.$/, "");
  const isOfficialImageHost = OFFICIAL_IMAGE_HOST_SUFFIXES.some((suffix) => (
    hostname === suffix || hostname.endsWith(`.${suffix}`)
  ));
  if (!isOfficialImageHost) {
    throw new Error("API 参数 url 不是小黑盒官方图片地址");
  }
  return parsed.href;
}

function queryParamsFor(
  operation: HeyboxApiMessage["operation"],
  value: unknown
): Record<string, JsonScalar> {
  const params = paramsRecord(value);

  if (operation === "feed") {
    requireExactKeys(params, ["offset", "width"]);
    const offset = finiteNumber(params.offset, "offset");
    if (!Number.isInteger(offset) || offset < 0 || offset > 10_000_000) {
      throw new Error("API 参数 offset 必须是非负整数");
    }
    const width = finiteNumber(params.width, "width");
    return {
      pull: 0,
      offset,
      dw: Math.min(3_840, Math.max(480, Math.round(width)))
    };
  }

  if (operation === "feedBanner") {
    requireExactKeys(params, []);
    return {};
  }

  if (operation === "communityFeed") {
    requireExactKeys(params, ["topicId", "offset", "width", "lastValue"]);
    const topicId = commentIdValue(params.topicId, "topicId");
    const offset = finiteNumber(params.offset, "offset");
    if (!Number.isInteger(offset) || offset < 0 || offset > 10_000_000) {
      throw new Error("API 参数 offset 必须是非负整数");
    }
    const width = finiteNumber(params.width, "width");
    return {
      topic_id: topicId,
      offset,
      limit: offset === 0 ? 10 : 30,
      lastval: paginationValue(params.lastValue, "lastValue"),
      dw: Math.min(3_840, Math.max(480, Math.round(width)))
    };
  }

  if (operation === "search") {
    requireKeys(
      params,
      ["query", "searchType", "offset", "limit", "width"],
      ["filterTag", "sortFilter", "timeRange"]
    );
    if (typeof params.query !== "string") throw new Error("API 参数 query 必须是字符串");
    const query = params.query.trim();
    if (!query || query.length > 120 || /[\u0000-\u001f\u007f]/.test(query)) {
      throw new Error("API 参数 query 不能为空或格式不正确");
    }
    if (params.searchType !== "general" && params.searchType !== "user") {
      throw new Error("API 参数 searchType 不受支持");
    }
    const offset = finiteNumber(params.offset, "offset");
    const limit = finiteNumber(params.limit, "limit");
    if (!Number.isInteger(offset) || offset % 30 !== 0 || offset < 0 || offset > 10_000_000) {
      throw new Error("API 参数 offset 必须是 0、30、60……这样的分页偏移量");
    }
    if (!Number.isInteger(limit) || limit !== 30) {
      throw new Error("API 参数 limit 必须固定为 30");
    }
    const width = finiteNumber(params.width, "width");
    const filterTag = params.filterTag;
    const sortFilter = params.sortFilter;
    const timeRange = params.timeRange;
    for (const [name, value] of [
      ["filterTag", filterTag],
      ["sortFilter", sortFilter],
      ["timeRange", timeRange]
    ] as const) {
      if (value === undefined) continue;
      if (typeof value !== "string") throw new Error("API 参数筛选值必须是字符串");
      if (value.length > 120 || /[\u0000-\u001f\u007f]/.test(value)) {
        throw new Error(`API 参数 ${name} 格式不正确`);
      }
    }
    return {
      q: query,
      search_type: params.searchType,
      is_pull_down: 0,
      offset,
      limit,
      dw: Math.min(3_840, Math.max(320, Math.round(width))),
      ...(typeof filterTag === "string" && filterTag ? { filter_tag: filterTag } : {}),
      ...(typeof sortFilter === "string" && sortFilter ? { sort_filter: sortFilter } : {}),
      ...(typeof timeRange === "string" && timeRange ? { time_range: timeRange } : {})
    };
  }

  if (operation === "searchWelcome" || operation === "searchFound") {
    requireExactKeys(params, []);
    return {};
  }

  if (operation === "searchSuggestion") {
    requireExactKeys(params, ["query"]);
    if (typeof params.query !== "string") throw new Error("API 参数 query 必须是字符串");
    const query = params.query.trim();
    if (!query || query.length > 120 || /[\u0000-\u001f\u007f]/.test(query)) {
      throw new Error("API 参数 query 不能为空或格式不正确");
    }
    return { q: query };
  }

  if (operation === "detail") {
    requireExactKeys(params, ["linkId"]);
    return {
      link_id: linkIdValue(params.linkId),
      is_first: 1,
      page: 1,
      index: 1,
      limit: 20,
      owner_only: 0
    };
  }

  if (operation === "comments") {
    requireExactKeys(params, ["linkId", "page", "limit"]);
    const page = finiteNumber(params.page, "page");
    const limit = finiteNumber(params.limit, "limit");
    return {
      link_id: linkIdValue(params.linkId),
      is_first: 0,
      page: Math.min(100_000, Math.max(2, Math.round(page))),
      index: 1,
      limit: Math.min(50, Math.max(1, Math.round(limit))),
      owner_only: 0
    };
  }

  if (operation === "originalImage") {
    requireExactKeys(params, ["url"]);
    return { url: originalImageUrlValue(params.url) };
  }

  if (operation === "favoriteFolders") {
    requireExactKeys(params, []);
    return {};
  }

  if (operation === "likePost") {
    requireExactKeys(params, ["linkId", "liked"]);
    if (typeof params.liked !== "boolean") throw new Error("API 参数 liked 必须是布尔值");
    return {
      link_id: linkIdValue(params.linkId),
      award_type: params.liked ? 1 : 0
    };
  }

  if (operation === "favoritePost") {
    requireExactKeys(params, ["linkId", "favorited", "folderId"]);
    if (typeof params.favorited !== "boolean") throw new Error("API 参数 favorited 必须是布尔值");
    const folderId = commentIdValue(params.folderId, "folderId", true);
    return {
      link_id: linkIdValue(params.linkId),
      favour_type: params.favorited ? 1 : 2,
      ...(folderId ? { folder_id: folderId } : {})
    };
  }

  if (operation === "likeComment") {
    requireExactKeys(params, ["commentId", "liked"]);
    if (typeof params.liked !== "boolean") throw new Error("API 参数 liked 必须是布尔值");
    return {
      comment_id: commentIdValue(params.commentId, "commentId"),
      support_type: params.liked ? 1 : 2
    };
  }

  if (operation === "followUser" || operation === "unfollowUser") {
    requireExactKeys(params, ["linkId", "followingId"]);
    return {
      link_id: linkIdValue(params.linkId),
      following_id: commentIdValue(params.followingId, "followingId")
    };
  }

  if (operation === "followSearchUser" || operation === "unfollowSearchUser") {
    requireExactKeys(params, ["userId"]);
    return {
      following_id: commentIdValue(params.userId, "userId")
    };
  }

  requireExactKeys(params, ["rootCommentId", "lastCommentId"]);
  return {
    root_comment_id: commentIdValue(params.rootCommentId, "rootCommentId"),
    lastval: commentIdValue(params.lastCommentId, "lastCommentId", true)
  };
}

function isApiChannelMessage(value: unknown): value is Record<string, unknown> {
  return Boolean(value)
    && typeof value === "object"
    && (value as Record<string, unknown>).channel === "xiaoheishu-api";
}

function isInternalMessage(value: unknown): value is InternalMessage {
  if (!value || typeof value !== "object") return false;
  const message = value as Record<string, unknown>;
  if (message.channel !== "xiaoheishu-internal") return false;
  if (message.operation === "mount-domain-entry") return true;
  if (message.operation === "download-image") {
    return typeof message.url === "string" && typeof message.filename === "string";
  }
  if (message.operation === "copy-image") {
    return typeof message.url === "string";
  }
  return message.operation === "switch-mode"
    && (message.mode === "original" || message.mode === "xiaoheishu");
}

async function mountDomainEntry(sender: chrome.runtime.MessageSender): Promise<void> {
  if (
    sender.id !== chrome.runtime.id
    || typeof sender.tab?.id !== "number"
    || !isHomePageUrl(sender.url)
  ) {
    throw new Error("HeyNote 小黑书页面入口来源无效");
  }

  const tabId = sender.tab.id;
  await chrome.scripting.executeScript({
    target: { tabId },
    injectImmediately: true,
    files: ["domain-entry.js"]
  });
}

async function switchBrowseMode(
  mode: BrowseMode,
  sender: chrome.runtime.MessageSender
): Promise<void> {
  if (
    sender.id !== chrome.runtime.id
    || typeof sender.tab?.id !== "number"
    || !isHomePageUrl(sender.url)
  ) {
    throw new Error("浏览模式切换来源无效");
  }
  await setBrowseMode(mode);
}

function pageFetchHeyboxApi(
  path: string,
  inputParams: Record<string, JsonScalar>,
  method: "GET" | "POST",
  apiOrigin: "https://api.xiaoheihe.cn" | "https://workshopapi.xiaoheihe.cn"
): Promise<InjectedResponse> {
  // Everything used by this function intentionally lives inside it. Chrome serializes
  // the function into the page's MAIN world, where module-scope bindings do not exist.
  return (async () => {
    function MM(value: string, alphabet: string, end: number): string {
      let result = "";
      const available = alphabet.slice(0, end);
      for (let index = 0; index < value.length; index += 1) {
        result += available[value.charCodeAt(index) % available.length];
      }
      return result;
    }

    function PM(value: string, alphabet: string): string {
      let result = "";
      for (let index = 0; index < value.length; index += 1) {
        result += alphabet[value.charCodeAt(index) % alphabet.length];
      }
      return result;
    }

    function vwe(values: string[]): string {
      let result = "";
      const length = Math.max(...values.map((value) => value.length));
      for (let index = 0; index < length; index += 1) {
        values.forEach((value) => {
          if (index < value.length) result += value[index];
        });
      }
      return result;
    }

    function gwe(values: number[]): number {
      return values.reduce((sum, value) => sum + value, 0);
    }

    function f3(value: number): number {
      return value & 128 ? ((value << 1) ^ 27) & 255 : value << 1;
    }

    function Ic(value: number): number {
      return f3(value) ^ value;
    }

    function wf(value: number): number {
      return Ic(f3(value));
    }

    function Dh(value: number): number {
      return wf(Ic(f3(value)));
    }

    function ag(value: number): number {
      return Dh(value) ^ wf(value) ^ Ic(value);
    }

    function mwe(values: number[]): number[] {
      const mixed = [0, 0, 0, 0];
      mixed[0] = ag(values[0]) ^ Dh(values[1]) ^ wf(values[2]) ^ Ic(values[3]);
      mixed[1] = Ic(values[0]) ^ ag(values[1]) ^ Dh(values[2]) ^ wf(values[3]);
      mixed[2] = wf(values[0]) ^ Ic(values[1]) ^ ag(values[2]) ^ Dh(values[3]);
      mixed[3] = Dh(values[0]) ^ wf(values[1]) ^ Ic(values[2]) ^ ag(values[3]);
      values[0] = mixed[0];
      values[1] = mixed[1];
      values[2] = mixed[2];
      values[3] = mixed[3];
      return values;
    }

    function leftRotate(value: number, shift: number): number {
      return ((value << shift) | (value >>> (32 - shift))) >>> 0;
    }

    function MD5(value: string): string {
      const bytes = Array.from(new TextEncoder().encode(value));
      const bitLength = bytes.length * 8;
      bytes.push(128);
      while (bytes.length % 64 !== 56) bytes.push(0);

      const lowLength = bitLength >>> 0;
      const highLength = Math.floor(bitLength / 0x100000000) >>> 0;
      for (let index = 0; index < 4; index += 1) bytes.push((lowLength >>> (index * 8)) & 255);
      for (let index = 0; index < 4; index += 1) bytes.push((highLength >>> (index * 8)) & 255);

      const shifts = [
        7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22,
        5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20,
        4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23,
        6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21
      ];
      const constants = Array.from({ length: 64 }, (_, index) =>
        Math.floor(Math.abs(Math.sin(index + 1)) * 0x100000000) >>> 0
      );

      let a0 = 0x67452301;
      let b0 = 0xefcdab89;
      let c0 = 0x98badcfe;
      let d0 = 0x10325476;

      for (let offset = 0; offset < bytes.length; offset += 64) {
        const words = Array.from({ length: 16 }, (_, index) => {
          const start = offset + index * 4;
          return (
            bytes[start]
            | (bytes[start + 1] << 8)
            | (bytes[start + 2] << 16)
            | (bytes[start + 3] << 24)
          ) >>> 0;
        });

        let a = a0;
        let b = b0;
        let c = c0;
        let d = d0;

        for (let index = 0; index < 64; index += 1) {
          let f: number;
          let wordIndex: number;
          if (index < 16) {
            f = (b & c) | (~b & d);
            wordIndex = index;
          } else if (index < 32) {
            f = (d & b) | (~d & c);
            wordIndex = (5 * index + 1) % 16;
          } else if (index < 48) {
            f = b ^ c ^ d;
            wordIndex = (3 * index + 5) % 16;
          } else {
            f = c ^ (b | ~d);
            wordIndex = (7 * index) % 16;
          }

          const previousD = d;
          d = c;
          c = b;
          const sum = (a + f + constants[index] + words[wordIndex]) >>> 0;
          b = (b + leftRotate(sum, shifts[index])) >>> 0;
          a = previousD;
        }

        a0 = (a0 + a) >>> 0;
        b0 = (b0 + b) >>> 0;
        c0 = (c0 + c) >>> 0;
        d0 = (d0 + d) >>> 0;
      }

      return [a0, b0, c0, d0].map((word) =>
        [0, 8, 16, 24]
          .map((shift) => ((word >>> shift) & 255).toString(16).padStart(2, "0"))
          .join("")
      ).join("");
    }

    function Tr(rawPath: string, timestamp: number, nonce: string): string {
      const normalizedPath = `/${rawPath.split("/").filter(Boolean).join("/")}/`;
      const alphabet = "AB45STUVWZEFGJ6CH01D237IXYPQRKLMN89";
      const timePart = MM(String(timestamp), alphabet, -2);
      const pathPart = PM(normalizedPath, alphabet);
      const noncePart = PM(nonce, alphabet);
      const interleaved = vwe([timePart, pathPart, noncePart]).slice(0, 20);
      const digest = MD5(interleaved).toString();
      const tail = digest.slice(-6).split("").map((char) => char.charCodeAt(0));
      let checksum = String(gwe(mwe(tail)) % 100);
      if (checksum.length < 2) checksum = `0${checksum}`;
      const prefix = MM(digest.substring(0, 5), alphabet, -4);
      return prefix + checksum;
    }

    function cookieValue(name: string): string {
      const prefix = `${name}=`;
      const part = document.cookie.split(";").map((item) => item.trim())
        .find((item) => item.startsWith(prefix));
      if (!part) return "-1";
      const raw = part.slice(prefix.length);
      try {
        return decodeURIComponent(raw) || "-1";
      } catch {
        return raw || "-1";
      }
    }

    function accountIdFromCookies(): string | undefined {
      for (const name of ["heybox_id", "user_heybox_id"]) {
        const value = cookieValue(name);
        if (value !== "-1") return value;
      }
      return undefined;
    }

    function recordValue(value: unknown): Record<string, unknown> {
      return value && typeof value === "object" && !Array.isArray(value)
        ? value as Record<string, unknown>
        : {};
    }

    function textValue(...values: unknown[]): string | undefined {
      for (const value of values) {
        if (typeof value === "string" && value.trim()) return value.trim();
        if (typeof value === "number" && Number.isFinite(value)) return String(value);
      }
      return undefined;
    }

    async function requestJson(
      requestPath: string,
      input: Record<string, JsonScalar>,
      requestMethod: "GET" | "POST",
      requestOrigin = apiOrigin
    ): Promise<{ response: Response; data?: unknown; parseError?: boolean }> {
      const timestamp = Math.floor(Date.now() / 1000);
      const random = new Uint8Array(16);
      crypto.getRandomValues(random);
      const nonce = Array.from(random, (byte) => byte.toString(16).padStart(2, "0"))
        .join("")
        .toUpperCase();
      const os = /Windows|Win32|Win64/i.test(`${navigator.platform} ${navigator.userAgent}`)
        ? "Windows"
        : "Mac";

      const url = new URL(requestPath, `${requestOrigin}/`);
      if (requestMethod === "GET") {
        Object.entries(input).forEach(([key, value]) => {
          url.searchParams.set(key, value === null ? "" : String(value));
        });
      }
      url.searchParams.set("app", "heybox");
      url.searchParams.set("os_type", "web");
      url.searchParams.set("x_app", "heybox_website");
      url.searchParams.set("x_client_type", "web");
      url.searchParams.set("x_os_type", os);
      url.searchParams.set("x_client_version", "");
      url.searchParams.set("client_type", "web");
      url.searchParams.set("web_version", "3.0");
      // The official web request does not append heybox_id to every endpoint.
      // Cookies are sent by credentials: include; adding the unreadable-cookie
      // fallback "-1" here makes the API return show_captcha.
      url.searchParams.set("version", "999.0.4");
      url.searchParams.set("_time", String(timestamp));
      url.searchParams.set("nonce", nonce);
      url.searchParams.set("hkey", Tr(requestPath, timestamp + 1, nonce));

      const controller = new AbortController();
      const timeout = window.setTimeout(() => controller.abort(), 15_000);
      let response: Response;
      try {
        const requestBody = requestMethod === "POST"
          ? new URLSearchParams(Object.entries(input).map(([key, value]) => [
              key,
              value === null ? "" : String(value)
            ]))
          : undefined;
        response = await fetch(url.toString(), {
          method: requestMethod,
          credentials: "include",
          headers: requestMethod === "POST"
            ? {
                Accept: "application/json",
                "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8"
              }
            : { Accept: "application/json" },
          body: requestBody,
          signal: controller.signal
        });
      } finally {
        window.clearTimeout(timeout);
      }

      const text = await response.text();
      try {
        return { response, data: JSON.parse(text) };
      } catch {
        return { response, parseError: true };
      }
    }

    try {
      const requestParams = { ...inputParams };
      let accountId = accountIdFromCookies();

      // Mutations need an authenticated account. If the readable cookie is not
      // available yet, mirror the official site's restore_login bootstrap once
      // before constructing the mutation payload.
      if (method === "POST" && !accountId) {
        const restored = await requestJson(
          "/account/restore_login",
          {},
          "GET",
          "https://api.xiaoheihe.cn"
        );
        const restoredRecord = recordValue(restored.data);
        const restoredResult = recordValue(restoredRecord.result);
        const restoredProfile = recordValue(restoredResult.profile);
        const restoredAccount = recordValue(restoredResult.account_detail);
        accountId = textValue(restoredProfile.heybox_id, restoredAccount.userid);
        if (restoredRecord.status === "show_captcha") {
          return { ok: false, error: "小黑盒要求完成安全验证，请先在原版页面完成验证后重试" };
        }
      }

      if (path === "/bbs/app/link/favour") {
        if (!accountId) return { ok: false, error: "小黑盒登录状态未恢复，请先登录后重试" };
        requestParams.userid = accountId;
      }

      const result = await requestJson(path, requestParams, method);
      if (result.parseError) {
        return {
          ok: false,
          error: result.response.ok
            ? "小黑盒 API 返回了无法解析的非 JSON 数据"
            : `小黑盒 API 返回 HTTP ${result.response.status}`
        };
      }

      if (!result.response.ok) {
        const record = recordValue(result.data);
        const detail = typeof record.msg === "string"
          ? record.msg
          : typeof record.message === "string" ? record.message : "";
        return {
          ok: false,
          error: `小黑盒 API 返回 HTTP ${result.response.status}${detail ? `：${detail}` : ""}`
        };
      }

      return { ok: true, data: result.data };
    } catch (error) {
      return {
        ok: false,
        error: error instanceof DOMException && error.name === "AbortError"
          ? "小黑盒 API 请求超时，请稍后重试"
          : error instanceof Error && error.message ? error.message : "小黑盒 API 请求失败"
      };
    }
  })();
}

async function handleApiMessage(
  message: Record<string, unknown>,
  tabId: number
): Promise<HeyboxApiResponse> {
  const operation = message.operation;
  if (
    operation !== "feed"
    && operation !== "feedBanner"
    && operation !== "communityFeed"
    && operation !== "search"
    && operation !== "searchWelcome"
    && operation !== "searchFound"
    && operation !== "searchSuggestion"
    && operation !== "detail"
    && operation !== "comments"
    && operation !== "commentReplies"
    && operation !== "originalImage"
    && operation !== "favoriteFolders"
    && operation !== "likePost"
    && operation !== "favoritePost"
    && operation !== "likeComment"
    && operation !== "followUser"
    && operation !== "unfollowUser"
    && operation !== "followSearchUser"
    && operation !== "unfollowSearchUser"
  ) {
    return { ok: false, error: "不支持的 API operation" };
  }

  let params: Record<string, JsonScalar>;
  try {
    params = queryParamsFor(operation, message.params);
  } catch (error) {
    return { ok: false, error: errorText(error) };
  }

  try {
    const sourceTab = await chrome.tabs.get(tabId);
    if (!isHomePageUrl(sourceTab.url)) {
      throw new Error("发起请求的页面不是小黑盒论坛首页");
    }
  } catch (error) {
    return { ok: false, error: errorText(error) };
  }

  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId },
      world: "MAIN",
      injectImmediately: true,
      func: pageFetchHeyboxApi,
      args: [
        OPERATION_PATHS[operation],
        params,
        operation === "followUser"
          || operation === "unfollowUser"
          || operation === "followSearchUser"
          || operation === "unfollowSearchUser"
          || operation === "likePost"
          || operation === "favoritePost"
          || operation === "likeComment" ? "POST" : "GET",
        WORKSHOP_API_OPERATIONS.has(operation)
          ? "https://workshopapi.xiaoheihe.cn"
          : "https://api.xiaoheihe.cn"
      ]
    });
    const result = results[0]?.result as InjectedResponse | undefined;
    if (!result || typeof result !== "object" || typeof result.ok !== "boolean") {
      return { ok: false, error: "小黑盒页面没有返回有效的 API 结果" };
    }
    return result.ok
      ? { ok: true, data: result.data }
      : { ok: false, error: result.error || "小黑盒 API 请求失败" };
  } catch (error) {
    return {
      ok: false,
      error: `无法通过小黑盒来源页面请求 API：${errorText(error)}`
    };
  }
}

chrome.action.onClicked.addListener((tab) => {
  void focusOrOpenHome(tab).catch((error) => {
    console.error("[HeyNote] 无法打开论坛首页", error);
  });
});

// Reloading an unpacked extension does not remove React trees already injected into
// open pages. Refresh them once per manifest version so stale listeners cannot survive.
void reloadHomeTabsAfterVersionChange().catch((error) => {
  console.error("[HeyNote] 无法刷新旧版本页面", error);
});

chrome.runtime.onMessage.addListener((message: unknown, sender, sendResponse) => {
  if (isInternalMessage(message)) {
    const task = message.operation === "mount-domain-entry"
      ? mountDomainEntry(sender)
      : message.operation === "switch-mode"
        ? switchBrowseMode(message.mode, sender)
        : message.operation === "download-image"
          ? downloadImage(message, sender)
          : copyImageData(message, sender);
    void task.then((result) => {
      sendResponse(result ? { ok: true, ...result } : { ok: true });
    }).catch((error) => {
      console.error("[HeyNote] 内部页面操作失败", error);
      sendResponse({ ok: false, error: errorText(error) });
    });
    return true;
  }

  if (!isApiChannelMessage(message)) return false;
  if (
    sender.id !== chrome.runtime.id
    || typeof sender.tab?.id !== "number"
    || !isHomePageUrl(sender.url)
  ) return false;
  void handleApiMessage(message, sender.tab.id).then(sendResponse).catch((error) => {
    sendResponse({ ok: false, error: errorText(error) } satisfies HeyboxApiResponse);
  });
  return true;
});

export {};
