import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent as ReactMouseEvent
} from "react";
import type { CommentItem, Community, FavoriteFolder, FeedPost, FeedResult, ImageMedia, PostDetail, PostKind } from "./types";
import {
  fetchCommentReplies,
  fetchFavoriteFolders,
  fetchFeedCommunities,
  fetchFeedPage,
  fetchMoreComments,
  fetchPostDetail,
  fetchSearchSuggestions,
  parseSearchPayload,
  setCommentLiked,
  setPostAuthorFollowing,
  setPostFavorited,
  setPostLiked
} from "./data/heybox";
import { DetailViews } from "./components/DetailViews";
import { HeyboxText } from "./components/HeyboxText";
import { formatCount } from "./format";
import { ImageContextMenu, type ImageContextMenuState } from "./components/ImageContextMenu";
import { HeyboxLogo } from "./components/HeyboxLogo";
import { copyImageAction, downloadImageAction, type ImageActionTarget } from "./image-actions";
import {
  isThemePreference,
  persistLocalThemePreference,
  prefersDarkColorScheme,
  readLocalThemePreference,
  resolveTheme,
  THEME_STORAGE_KEY,
  type ThemePreference
} from "./theme";
import {
  ArticleIcon,
  CloseIcon,
  CommentIcon,
  CompassIcon,
  ExternalIcon,
  FilterIcon,
  ImageIcon,
  MoonIcon,
  PlayIcon,
  RefreshIcon,
  SearchIcon,
  SunIcon,
  SystemThemeIcon,
  ThumbUpIcon,
  VideoIcon
} from "./icons";

type ViewMode = "discover" | "hot" | "saved";

const ALL_POST_KINDS: PostKind[] = ["image", "video", "article"];
const KIND_FILTER_OPTIONS: Array<{ key: PostKind; label: string; icon: typeof ImageIcon }> = [
  { key: "image", label: "图文", icon: ImageIcon },
  { key: "video", label: "视频", icon: VideoIcon },
  { key: "article", label: "文章", icon: ArticleIcon }
];

export interface AppProps {
  demoPosts?: FeedPost[];
  demoDetails?: Record<string, PostDetail>;
  demoCommunities?: Community[];
}

const FAVORITES_KEY = "xiaoheishu:favorites";
const FILTER_KINDS_KEY = "xiaoheishu:selected-post-kinds";
const SEARCH_HISTORY_KEY = "xiaoheishu:search-history";
const SEARCH_BRIDGE_RESULT_KEY = "xiaoheishu:search-bridge-result";
const RECENT_VIEWED_KEY = "xiaoheishu:recent-viewed-posts";
const FEED_STEP = 30;
const FEED_BUFFER_PAGES = 3;
const FEED_REVEAL_DURATION_MS = 180;
const FEED_REVEAL_STAGGER_MS = 15;
const SEARCH_STEP = 20;
const DETAIL_RECOMMENDATION_LIMIT = 6;
const MAX_SEARCH_HISTORY = 8;
const MAX_RECENT_VIEWED = 8;
const ORIGINAL_SEARCH_DISCOVERY = [
  "无限法则",
  "英雄联盟",
  "战地5",
  "怪物猎人",
  "刺客信条",
  "彩虹六号",
  "Red Dead Redemption",
  "古墓丽影"
];
const ORIGINAL_FORUM_URL = "https://www.xiaoheihe.cn/app/bbs/home";
const ORIGINAL_SEARCH_URL = "https://www.xiaoheihe.cn/app/search";
const SEARCH_BRIDGE_PARAM = "xiaoheishu_bridge";
const SEARCH_BRIDGE_TTL_MS = 60_000;
export const ORIGINAL_MODE_REQUEST_EVENT = "xiaoheishu:request-original-mode";

function isPostKind(value: unknown): value is PostKind {
  return typeof value === "string" && ALL_POST_KINDS.includes(value as PostKind);
}

function requestOriginalMode() {
  window.dispatchEvent(new CustomEvent(ORIGINAL_MODE_REQUEST_EVENT, {
    detail: {
      mode: "original",
      source: "xiaoheishu-mode-switcher",
      url: ORIGINAL_FORUM_URL
    }
  }));
}

function imageActionError(error: unknown, fallback: string): string {
  const message = error instanceof Error && error.message ? error.message : fallback;
  if (/notallowed|permission|focus|focused|document is not focused/i.test(message)) {
    return "当前标签页未激活，暂时不能复制图片";
  }
  if (/too (?:large|big)|过大|exceed|limit/i.test(message)) {
    return "Image is too large. Please download it instead";
  }
  if (/decode|decoded|解码|format|格式/i.test(message)) {
    return "This image cannot be copied. Please download it instead";
  }
  return message;
}

function mergePosts(current: FeedPost[], incoming: FeedPost[]): FeedPost[] {
  const merged = [...current];
  const knownIds = new Set(current.map((post) => post.id));
  incoming.forEach((post) => {
    if (knownIds.has(post.id)) return;
    knownIds.add(post.id);
    merged.push(post);
  });
  return merged;
}

function originalSearchUrl(keyword: string, bridgeId?: string): string {
  const url = new URL(ORIGINAL_SEARCH_URL);
  const query = keyword.trim();
  if (query) {
    url.searchParams.set("q", query);
    url.searchParams.set("keyword", query);
  }
  if (bridgeId) url.searchParams.set(SEARCH_BRIDGE_PARAM, bridgeId);
  return url.href;
}

function nextSearchBridgeId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

interface BridgedSearchResult {
  id?: string;
  keyword?: string;
  url?: string;
  payload?: unknown;
  error?: string;
  capturedAt?: number;
}

function asBridgedSearchResult(value: unknown): BridgedSearchResult | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  return {
    id: typeof record.id === "string" ? record.id : undefined,
    keyword: typeof record.keyword === "string" ? record.keyword : undefined,
    url: typeof record.url === "string" ? record.url : undefined,
    payload: record.payload,
    error: typeof record.error === "string" ? record.error : undefined,
    capturedAt: typeof record.capturedAt === "number" ? record.capturedAt : undefined
  };
}

function demoSearchPosts(posts: FeedPost[], keyword: string): FeedPost[] {
  const query = keyword.trim().toLocaleLowerCase();
  if (!query) return [];
  return posts.filter((post) => [
    post.title,
    post.excerpt,
    post.author,
    post.topic,
    ...(post.contentTags ?? []).map((tag) => tag.name)
  ].some((value) => value.toLocaleLowerCase().includes(query)));
}

function normalizeRecommendationText(value: string): string {
  return value
    .toLocaleLowerCase()
    .replace(/[^\p{Letter}\p{Number}\u4e00-\u9fff]+/gu, " ")
    .trim();
}

function recommendationKeywords(post: FeedPost): string[] {
  const chunks = [
    post.title,
    post.excerpt,
    post.topic,
    ...(post.contentTags ?? []).map((tag) => tag.name)
  ];
  const seen = new Set<string>();
  chunks
    .flatMap((chunk) => normalizeRecommendationText(chunk).split(/\s+/))
    .forEach((token) => {
      if (token.length >= 2 && !seen.has(token)) seen.add(token);
    });
  return Array.from(seen).slice(0, 28);
}

function recommendationScore(source: FeedPost, candidate: FeedPost): number {
  if (source.id === candidate.id) return -1;
  let score = 0;
  if (source.topicId && candidate.topicId && source.topicId === candidate.topicId) score += 12;
  if (source.topic && candidate.topic && source.topic === candidate.topic) score += 8;
  if (source.kind === candidate.kind) score += 1.5;

  const candidateText = normalizeRecommendationText([
    candidate.title,
    candidate.excerpt,
    candidate.topic,
    ...(candidate.contentTags ?? []).map((tag) => tag.name)
  ].join(" "));
  recommendationKeywords(source).forEach((keyword) => {
    if (candidateText.includes(keyword)) score += keyword.length >= 4 ? 2.2 : 1.1;
  });
  score += Math.min(5, Math.log10(candidate.likes + candidate.comments * 2 + 1));
  return score;
}

function rankedRecommendations(source: FeedPost, candidates: FeedPost[], limit = DETAIL_RECOMMENDATION_LIMIT): FeedPost[] {
  return candidates
    .filter((candidate, index, list) => candidate.id !== source.id && list.findIndex((item) => item.id === candidate.id) === index)
    .map((candidate) => ({ post: candidate, score: recommendationScore(source, candidate) }))
    .filter((item) => item.score >= 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((item) => item.post);
}

function persistLocalValue(key: string, value: unknown) {
  if (typeof chrome !== "undefined" && chrome.storage?.local) {
    chrome.storage.local.set({ [key]: value }).catch(() => undefined);
    return;
  }
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // The in-memory state still works when local persistence is unavailable.
  }
}

function storedLocalValue<T>(key: string, fallback: T, accept: (value: unknown) => value is T): T {
  try {
    const raw = window.localStorage.getItem(key);
    if (raw === null) return fallback;
    const parsed = JSON.parse(raw) as unknown;
    return accept(parsed) ? parsed : fallback;
  } catch {
    return fallback;
  }
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function isStoredFeedPosts(value: unknown): value is FeedPost[] {
  return Array.isArray(value)
    && value.every((item) => Boolean(item)
      && typeof item === "object"
      && typeof (item as Partial<FeedPost>).id === "string"
      && typeof (item as Partial<FeedPost>).title === "string");
}

interface BufferedFeedPages {
  pages: FeedResult[];
  error?: unknown;
}

async function fetchBufferedFeedPages(
  offset: number,
  width: number,
  communityId?: string | null,
  lastValue = ""
): Promise<BufferedFeedPages> {
  if (!communityId) {
    const settledPages = await Promise.allSettled(Array.from({ length: FEED_BUFFER_PAGES }, (_, index) => (
      fetchFeedPage(offset + index * FEED_STEP, width)
    )));
    const pages: FeedResult[] = [];
    for (const settledPage of settledPages) {
      if (settledPage.status === "rejected") {
        return { pages, error: settledPage.reason };
      }
      pages.push(settledPage.value);
      if (!settledPage.value.hasMore) break;
    }
    return { pages };
  }

  const pages: FeedResult[] = [];
  let cursor = offset;
  let cursorLastValue = lastValue;
  for (let index = 0; index < FEED_BUFFER_PAGES; index += 1) {
    try {
      const page = await fetchFeedPage(cursor, width, communityId, cursorLastValue);
      pages.push(page);
      if (!page.hasMore) break;
      cursor = page.nextOffset;
      cursorLastValue = page.lastValue ?? "";
    } catch (error) {
      return { pages, error };
    }
  }
  return { pages };
}

function bufferedFeedResult(pages: FeedResult[]): FeedResult | undefined {
  if (!pages.length) return undefined;
  const consumedPages: FeedResult[] = [];
  for (const page of pages) {
    consumedPages.push(page);
    if (!page.hasMore) break;
  }
  const tail = consumedPages.at(-1)!;
  return {
    posts: consumedPages.reduce<FeedPost[]>((current, page) => mergePosts(current, page.posts), []),
    hasMore: tail.hasMore,
    nextOffset: tail.nextOffset,
    ...(tail.lastValue ? { lastValue: tail.lastValue } : {})
  };
}

function withPostLikeState(post: FeedPost, liked: boolean): FeedPost {
  if (Boolean(post.isLiked) === liked) return post;
  return {
    ...post,
    isLiked: liked,
    likes: Math.max(0, post.likes + (liked ? 1 : -1))
  };
}

function hotScore(post: FeedPost): number {
  return post.likes + post.comments * 2;
}

function feedColumnCount(width: number): number {
  if (width <= 760) return 2;
  const horizontalPadding = width <= 1080 ? 44 : 60;
  const availableWidth = Math.max(0, Math.min(width, 1500) - horizontalPadding);
  return Math.max(2, Math.min(5, Math.floor((availableWidth + 19) / (246 + 19))));
}

function mergeComments(current: PostDetail["comments"], incoming: PostDetail["comments"]): PostDetail["comments"] {
  const merged = [...current];
  const knownIds = new Set(current.map((comment) => comment.id));
  incoming.forEach((comment) => {
    if (knownIds.has(comment.id)) return;
    knownIds.add(comment.id);
    merged.push(comment);
  });
  return merged;
}

function findComment(comments: CommentItem[], id: string): CommentItem | undefined {
  for (const comment of comments) {
    if (comment.id === id) return comment;
    const nested = findComment(comment.replies, id);
    if (nested) return nested;
  }
  return undefined;
}

function updateComment(comments: CommentItem[], id: string, updater: (comment: CommentItem) => CommentItem): CommentItem[] {
  return comments.map((comment) => {
    if (comment.id === id) return updater(comment);
    if (!comment.replies.length) return comment;
    const replies = updateComment(comment.replies, id, updater);
    return replies.some((reply, index) => reply !== comment.replies[index]) ? { ...comment, replies } : comment;
  });
}

function feedCoverImage(post: FeedPost): ImageMedia | undefined {
  const media = post.media[0];
  if (!media) return undefined;
  if (media.kind === "image") return media;
  if (!media.poster) return undefined;
  return {
    kind: "image",
    url: media.poster,
    width: media.width,
    height: media.height
  };
}

function mediaCover(post: FeedPost): string | undefined {
  const image = feedCoverImage(post);
  return image?.thumbnail || image?.url;
}

const FEED_COVER_RATIO_MIN = 3 / 4;
const FEED_COVER_RATIO_MAX = 4 / 3;
const FEED_COVER_RATIO_TIMEOUT_MS = 3_000;
const FEED_COVER_RATIO_CONCURRENCY = 8;
const FEED_COVER_RATIO_CACHE_LIMIT = 800;
const feedCoverRatioCache = new Map<string, number>();

function clampFeedCoverRatio(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 1;
  return Math.min(FEED_COVER_RATIO_MAX, Math.max(FEED_COVER_RATIO_MIN, value));
}

function fallbackFeedCoverRatio(post: FeedPost): number {
  const image = feedCoverImage(post);
  if (image?.width && image.height) return clampFeedCoverRatio(image.width / image.height);
  return image ? 1 : FEED_COVER_RATIO_MIN;
}

function mediaRatio(post: FeedPost, preparedRatio?: number): string {
  return String(preparedRatio ?? fallbackFeedCoverRatio(post));
}

function estimatedTextUnits(value: string): number {
  return Array.from(value).reduce((units, character) => (
    units + (/^[\u0000-\u00ff]$/.test(character) ? 0.56 : character.length > 1 ? 1.35 : 1)
  ), 0);
}

function estimatedFeedCardHeight(post: FeedPost, preparedRatio?: number): number {
  const estimatedWidth = 270;
  const ratio = preparedRatio ?? fallbackFeedCoverRatio(post);
  const coverHeight = estimatedWidth / ratio;
  const titleLines = Math.max(1, Math.min(2, Math.ceil(estimatedTextUnits(post.title) / 16)));
  const excerptLines = post.kind === "article" && post.excerpt
    ? Math.max(1, Math.min(2, Math.ceil(estimatedTextUnits(post.excerpt) / 19)))
    : 0;
  const bodyHeight = 65 + titleLines * 22.8 + (excerptLines ? 7 + excerptLines * 21.1 : 0);
  return coverHeight + bodyHeight + 20;
}

function distributeFeedPosts(
  posts: FeedPost[],
  columnCount: number,
  coverRatios: Map<string, number>
): FeedPost[][] {
  const columns = Array.from({ length: columnCount }, () => [] as FeedPost[]);
  const estimatedHeights = Array.from({ length: columnCount }, () => 0);
  posts.forEach((post) => {
    let shortestColumn = 0;
    for (let index = 1; index < columnCount; index += 1) {
      if (estimatedHeights[index] < estimatedHeights[shortestColumn]) shortestColumn = index;
    }
    columns[shortestColumn].push(post);
    estimatedHeights[shortestColumn] += estimatedFeedCardHeight(post, coverRatios.get(post.id));
  });
  return columns;
}

function cacheFeedCoverRatio(cover: string, ratio: number): number {
  const normalized = clampFeedCoverRatio(ratio);
  feedCoverRatioCache.delete(cover);
  feedCoverRatioCache.set(cover, normalized);
  if (feedCoverRatioCache.size > FEED_COVER_RATIO_CACHE_LIMIT) {
    const oldest = feedCoverRatioCache.keys().next().value;
    if (typeof oldest === "string") feedCoverRatioCache.delete(oldest);
  }
  return normalized;
}

function probeFeedCoverRatio(cover: string, timeoutMs: number): Promise<number | undefined> {
  const cached = feedCoverRatioCache.get(cover);
  if (cached !== undefined) return Promise.resolve(cached);
  if (typeof Image === "undefined" || timeoutMs <= 0) return Promise.resolve(undefined);

  return new Promise<number | undefined>((resolve) => {
    const loader = new Image();
    let settled = false;
    const finish = (ratio?: number, abort = false) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeout);
      loader.onload = null;
      loader.onerror = null;
      if (abort) loader.src = "";
      resolve(ratio === undefined ? undefined : cacheFeedCoverRatio(cover, ratio));
    };
    const timeout = window.setTimeout(() => finish(undefined, true), timeoutMs);
    loader.decoding = "async";
    loader.referrerPolicy = "no-referrer";
    loader.onload = () => {
      if (loader.naturalWidth > 0 && loader.naturalHeight > 0) {
        finish(loader.naturalWidth / loader.naturalHeight);
      } else {
        finish();
      }
    };
    loader.onerror = () => finish();
    loader.src = cover;
  });
}

async function preloadFeedCoverRatios(
  posts: FeedPost[],
  isCurrent: () => boolean
): Promise<Map<string, number>> {
  const ratios = new Map<string, number>();
  const unresolvedByCover = new Map<string, FeedPost[]>();

  posts.forEach((post) => {
    const cover = mediaCover(post);
    const image = feedCoverImage(post);
    if (!cover || !image) {
      ratios.set(post.id, fallbackFeedCoverRatio(post));
      return;
    }
    if (image.width && image.height) {
      ratios.set(post.id, clampFeedCoverRatio(image.width / image.height));
      return;
    }
    const cached = feedCoverRatioCache.get(cover);
    if (cached !== undefined) {
      ratios.set(post.id, cached);
      return;
    }
    const grouped = unresolvedByCover.get(cover);
    if (grouped) grouped.push(post); else unresolvedByCover.set(cover, [post]);
  });

  const unresolved = Array.from(unresolvedByCover.entries());
  let cursor = 0;
  const deadline = Date.now() + FEED_COVER_RATIO_TIMEOUT_MS;
  const workerCount = Math.min(FEED_COVER_RATIO_CONCURRENCY, unresolved.length);
  await Promise.all(Array.from({ length: workerCount }, async () => {
    while (cursor < unresolved.length && isCurrent()) {
      const [cover, groupedPosts] = unresolved[cursor];
      cursor += 1;
      const remaining = deadline - Date.now();
      if (remaining <= 0) break;
      const probed = await probeFeedCoverRatio(cover, remaining);
      if (!isCurrent()) return;
      const ratio = probed ?? fallbackFeedCoverRatio(groupedPosts[0]);
      groupedPosts.forEach((post) => ratios.set(post.id, ratio));
    }
  }));

  if (isCurrent()) {
    posts.forEach((post) => {
      if (!ratios.has(post.id)) ratios.set(post.id, fallbackFeedCoverRatio(post));
    });
  }
  return ratios;
}

function placeholderPost(id: string): FeedPost {
  return {
    id,
    href: `https://www.xiaoheihe.cn/app/bbs/link/${encodeURIComponent(id)}`,
    title: "正在打开帖子",
    excerpt: "",
    author: "盒友",
    topic: "Heybox",
    media: [],
    kind: "image",
    likes: 0,
    comments: 0,
    linkTag: 0,
    hasVideo: false
  };
}

function KindBadge({ post }: { post: FeedPost }) {
  if (post.kind === "video") {
    const video = post.media.find((item) => item.kind === "video");
    return (
      <span className="kind-badge kind-badge--video">
        <PlayIcon />
        {video?.kind === "video" ? video.durationLabel || "视频" : "视频"}
      </span>
    );
  }
  if (post.media.length > 1) return <span className="kind-badge"><ImageIcon />{post.media.length} 图</span>;
  return null;
}

function TopicPill({ post }: { post: FeedPost }) {
  if (!post.topic) return null;
  return (
    <span className="feed-card__topic" title={post.topic}>
      {post.topicIcon && (
        <img
          src={post.topicIcon}
          alt=""
          loading="lazy"
          decoding="async"
          referrerPolicy="no-referrer"
        />
      )}
      <span>{post.topic}</span>
    </span>
  );
}

function PostCard({ post, eager, revealDelay, likeLoading, onLike, onOpen }: {
  post: FeedPost;
  eager?: boolean;
  revealDelay?: number;
  likeLoading: boolean;
  onLike: () => void;
  onOpen: () => void;
}) {
  const cover = mediaCover(post);
  const showMeta = Boolean(post.author || post.avatar || post.comments || post.favorites || post.likes);
  const metadata = [
    post.createdAt,
    post.ipLocation ? `IP ${post.ipLocation}` : ""
  ].filter(Boolean).join(" · ");

  return (
    <article
      className={`feed-card feed-card--${post.kind}${revealDelay === undefined ? "" : " feed-card--reveal"}`}
      style={revealDelay === undefined ? undefined : {
        "--feed-reveal-delay": `${revealDelay}ms`
      } as CSSProperties}
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(event) => {
        if (event.target !== event.currentTarget) return;
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onOpen();
        }
      }}
    >
      <div className="feed-card__body">
        <div className="feed-card__text">
          <div className="feed-card__kicker">
            <TopicPill post={post} />
            <KindBadge post={post} />
            {metadata && <span>{metadata}</span>}
          </div>
          <h3><HeyboxText value={post.title} emojiSize={18} preserveLineBreaks={false} /></h3>
          {post.excerpt && <p><HeyboxText value={post.excerpt} emojiSize={16} /></p>}
        </div>

        {cover && (
          <div className="feed-card__thumb">
            <img
              src={cover}
              alt=""
              loading={eager ? "eager" : "lazy"}
              decoding="async"
              referrerPolicy="no-referrer"
            />
            {post.media.length > 1 && <span className="feed-card__image-count">{post.media.length} 图</span>}
          </div>
        )}

        {showMeta && (
          <div className="feed-card__meta">
            <div className="author">
              {post.avatar ? (
                <img
                  src={post.avatar}
                  alt=""
                  loading="lazy"
                  decoding="async"
                  referrerPolicy="no-referrer"
                />
              ) : <span className="author__fallback">H</span>}
              <span className="author__name">{post.author}</span>
            </div>
            <div className="feed-card__stats" aria-label="帖子数据">
              <span><CommentIcon />{formatCount(post.comments)}</span>
              {typeof post.favorites === "number" && <span>藏 {formatCount(post.favorites)}</span>}
            </div>
            <div className="card-actions">
              <button
                className={post.isLiked ? "is-active" : ""}
                type="button"
                aria-label={post.isLiked ? `取消点赞，当前 ${post.likes} 个赞` : `点赞，当前 ${post.likes} 个赞`}
                aria-pressed={Boolean(post.isLiked)}
                aria-busy={likeLoading}
                disabled={likeLoading}
                onClick={(event) => {
                  event.stopPropagation();
                  onLike();
                }}
              >
                <ThumbUpIcon />
                <b>{formatCount(post.likes)}</b>
              </button>
            </div>
          </div>
        )}
      </div>
    </article>
  );
}

function FeedSkeleton({ columns }: { columns: number }) {
  const skeletonColumns = Array.from({ length: columns }, () => [] as number[]);
  Array.from({ length: 12 }).forEach((_, index) => {
    skeletonColumns[index % columns].push(index);
  });

  return (
    <div
      className="skeleton-grid"
      aria-label="正在加载帖子"
      style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}
    >
      {skeletonColumns.map((items, columnIndex) => (
        <div className="skeleton-column" key={`skeleton-column-${columnIndex}`}>
          {items.map((index) => (
            <i key={index} style={{ height: `${228 + (index % 4) * 54}px` }} />
          ))}
        </div>
      ))}
    </div>
  );
}

function BrandWordmark({ compact = false }: { compact?: boolean }) {
  return (
    <div
      className={compact ? "brand brand--compact mobile-brand" : "brand"}
      role="img"
      aria-label="Heybox"
      title="HeyNote Xiaoheishu"
    >
      <HeyboxLogo className="brand__logo" />
    </div>
  );
}

function ModeSwitcher({ compact = false }: { compact?: boolean }) {
  return (
    <section className={`mode-switcher${compact ? " mode-switcher--compact" : ""}`} aria-label="页面显示模式">
      {!compact && <span className="mode-switcher__label">浏览页面</span>}
      <div className="mode-switcher__control" role="group" aria-label="Switch between original forum and HeyNote">
        <button
          className="mode-switcher__option mode-switcher__option--original"
          type="button"
          aria-pressed="false"
          onClick={requestOriginalMode}
        >
          原版
        </button>
        <button
          className="mode-switcher__option is-active"
          type="button"
          aria-pressed="true"
          aria-current="page"
          tabIndex={-1}
          title="Currently using HeyNote"
        >
          Xiaoheishu</button>
      </div>
    </section>
  );
}

const THEME_OPTIONS: Array<{ value: ThemePreference; label: string; icon: typeof SunIcon }> = [
  { value: "system", label: "跟随", icon: SystemThemeIcon },
  { value: "light", label: "浅色", icon: SunIcon },
  { value: "dark", label: "深色", icon: MoonIcon }
];

function ThemeSwitcher({ preference, onChange }: {
  preference: ThemePreference;
  onChange: (preference: ThemePreference) => void;
}) {
  return (
    <section className="theme-switcher" aria-label="页面外观">
      <span className="theme-switcher__label">外观</span>
      <div className="theme-switcher__control" role="radiogroup" aria-label="颜色主题">
        {THEME_OPTIONS.map(({ value, label, icon: Icon }) => (
          <button
            key={value}
            className={preference === value ? "is-active" : ""}
            type="button"
            role="radio"
            aria-checked={preference === value}
            title={value === "system" ? "跟随系统外观" : `使用${label}外观`}
            onClick={() => onChange(value)}
          >
            <Icon />
            <span>{label}</span>
          </button>
        ))}
      </div>
    </section>
  );
}

function parseHashRoute(): { id: string; kind: "post" | "article" } | null {
  const match = location.hash.match(/^#\/(post|article)\/([^/?]+)/);
  return match ? { kind: match[1] as "post" | "article", id: decodeURIComponent(match[2]) } : null;
}

export function App({ demoPosts, demoDetails = {}, demoCommunities = [] }: AppProps) {
  const isDemo = Boolean(demoPosts);
  const [posts, setPosts] = useState<FeedPost[]>(demoPosts ?? []);
  const [view, setView] = useState<ViewMode>("discover");
  const [communities, setCommunities] = useState<Community[]>(demoCommunities);
  const [selectedCommunityId, setSelectedCommunityId] = useState<string | null>(null);
  const [selectedKinds, setSelectedKinds] = useState<Set<PostKind>>(() => new Set(ALL_POST_KINDS));
  const [themePreference, setThemePreference] = useState<ThemePreference>(readLocalThemePreference);
  const [systemDark, setSystemDark] = useState(prefersDarkColorScheme);
  const [filterOpen, setFilterOpen] = useState(false);
  const [communityError, setCommunityError] = useState<string>();
  const [favorites, setFavorites] = useState<Set<string>>(new Set());
  const [initialLoading, setInitialLoading] = useState(!isDemo);
  const [loadingMore, setLoadingMore] = useState(false);
  const [feedError, setFeedError] = useState<string>();
  const [hasMore, setHasMore] = useState(!isDemo);
  const [nextOffset, setNextOffset] = useState(FEED_STEP);
  const [lastValue, setLastValue] = useState("");
  const [searchDraft, setSearchDraft] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchPosts, setSearchPosts] = useState<FeedPost[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchLoadingMore, setSearchLoadingMore] = useState(false);
  const [searchError, setSearchError] = useState<string>();
  const [searchHasMore, setSearchHasMore] = useState(false);
  const [searchNextOffset, setSearchNextOffset] = useState(SEARCH_STEP);
  const [searchHistory, setSearchHistory] = useState<string[]>([]);
  const [searchSuggestions, setSearchSuggestions] = useState<string[]>([]);
  const [recentViewedPosts, setRecentViewedPosts] = useState<FeedPost[]>([]);
  const [hotOrder, setHotOrder] = useState<string[]>([]);
  const [masonryColumnCount, setMasonryColumnCount] = useState(() => feedColumnCount(
    typeof window === "undefined" ? 1200 : window.innerWidth
  ));
  const [feedRevealDelays, setFeedRevealDelays] = useState<Map<string, number>>(() => new Map());
  const [selectedPost, setSelectedPost] = useState<FeedPost>();
  const [detail, setDetail] = useState<PostDetail>();
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string>();
  const [detailRecommendations, setDetailRecommendations] = useState<FeedPost[]>([]);
  const [detailRecommendationsLoading, setDetailRecommendationsLoading] = useState(false);
  const [detailRecommendationsError, setDetailRecommendationsError] = useState<string>();
  const [followLoading, setFollowLoading] = useState(false);
  const [postActionLoading, setPostActionLoading] = useState<"like" | "favorite">();
  const [favoriteFolders, setFavoriteFolders] = useState<FavoriteFolder[]>([]);
  const [favoritePickerOpen, setFavoritePickerOpen] = useState(false);
  const [likingPostIds, setLikingPostIds] = useState<Set<string>>(new Set());
  const [likingCommentIds, setLikingCommentIds] = useState<Set<string>>(new Set());
  const [loadingMoreComments, setLoadingMoreComments] = useState(false);
  const [loadingReplyIds, setLoadingReplyIds] = useState<Set<string>>(new Set());
  const [imageContextMenu, setImageContextMenu] = useState<ImageContextMenuState | null>(null);
  const [imageActionNotice, setImageActionNotice] = useState<{ message: string; error: boolean } | null>(null);
  const favoritesTouched = useRef(false);
  const selectedKindsTouched = useRef(false);
  const searchHistoryTouched = useRef(false);
  const recentViewedTouched = useRef(false);
  const themePreferenceTouched = useRef(false);
  const feedScrollRef = useRef<HTMLDivElement>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const searchShellRef = useRef<HTMLDivElement>(null);
  const communityListRef = useRef<HTMLDivElement>(null);
  const kindFilterRef = useRef<HTMLDivElement>(null);
  const loadingRef = useRef(false);
  const loadingGenerationRef = useRef<number | null>(null);
  const feedGenerationRef = useRef(0);
  const searchGenerationRef = useRef(0);
  const searchSuggestionGenerationRef = useRef(0);
  const searchLoadingRef = useRef(false);
  const activeSearchBridgeIdRef = useRef<string | undefined>(undefined);
  const requestedOffsetsRef = useRef<Set<string>>(new Set());
  const selectedIdRef = useRef<string | undefined>(undefined);
  const recommendationRequestRef = useRef(0);
  const likingPostIdsRef = useRef<Set<string>>(new Set());
  const postLikeOverridesRef = useRef<Map<string, boolean>>(new Map());
  const commentRequestRef = useRef<string | undefined>(undefined);
  const replyRequestKeysRef = useRef<Map<string, string>>(new Map());
  const imageNoticeTimerRef = useRef<number | null>(null);
  const feedRevealTimerRef = useRef<number | null>(null);
  const feedCoverRatiosRef = useRef<Map<string, number>>(new Map());
  const feedPostIdsRef = useRef<Set<string>>(new Set((demoPosts ?? []).map((post) => post.id)));
  const masonryColumnCountRef = useRef(masonryColumnCount);
  masonryColumnCountRef.current = masonryColumnCount;
  const resolvedTheme = resolveTheme(themePreference, systemDark);

  const closeImageContextMenu = useCallback(() => setImageContextMenu(null), []);
  const showImageActionNotice = useCallback((message: string, error = false) => {
    if (imageNoticeTimerRef.current !== null) window.clearTimeout(imageNoticeTimerRef.current);
    setImageActionNotice({ message, error });
    imageNoticeTimerRef.current = window.setTimeout(() => {
      setImageActionNotice(null);
      imageNoticeTimerRef.current = null;
    }, error ? 3600 : 2200);
  }, []);
  const openImageContextMenu = useCallback((event: ReactMouseEvent<HTMLElement>, target: ImageActionTarget) => {
    event.preventDefault();
    event.stopPropagation();
    setImageContextMenu({ x: event.clientX, y: event.clientY, target });
  }, []);

  const stageFeedReveal = useCallback((incoming: FeedPost[], replace = false) => {
    if (feedRevealTimerRef.current !== null) window.clearTimeout(feedRevealTimerRef.current);
    if (replace) feedPostIdsRef.current.clear();
    const additions = incoming.filter((post) => {
      if (feedPostIdsRef.current.has(post.id)) return false;
      feedPostIdsRef.current.add(post.id);
      return true;
    });
    const revealLimit = Math.max(4, masonryColumnCountRef.current * 2);
    const delays = new Map(additions.slice(0, revealLimit).map((post, index) => (
      [post.id, index * FEED_REVEAL_STAGGER_MS]
    )));
    setFeedRevealDelays((current) => replace
      ? delays
      : new Map([...current, ...delays]));
    const longestDelay = Math.max(0, (delays.size - 1) * FEED_REVEAL_STAGGER_MS);
    feedRevealTimerRef.current = window.setTimeout(() => {
      setFeedRevealDelays(new Map());
      feedRevealTimerRef.current = null;
    }, longestDelay + FEED_REVEAL_DURATION_MS + 40);
  }, []);

  useEffect(() => () => {
    if (imageNoticeTimerRef.current !== null) window.clearTimeout(imageNoticeTimerRef.current);
    if (feedRevealTimerRef.current !== null) window.clearTimeout(feedRevealTimerRef.current);
  }, []);

  useLayoutEffect(() => {
    const root = feedScrollRef.current;
    if (!root) return;

    let lastWidth = -1;
    const updateColumns = (width = root.clientWidth) => {
      const roundedWidth = Math.round(width);
      if (roundedWidth === lastWidth) return;
      lastWidth = roundedWidth;
      setMasonryColumnCount((current) => {
        const next = feedColumnCount(roundedWidth);
        return next === current ? current : next;
      });
    };

    updateColumns();
    if (typeof ResizeObserver === "undefined") {
      const onResize = () => updateColumns();
      window.addEventListener("resize", onResize, { passive: true });
      return () => window.removeEventListener("resize", onResize);
    }

    const observer = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width;
      if (typeof width === "number") updateColumns(width);
    });
    observer.observe(root);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (typeof chrome === "undefined" || !chrome.storage?.local) return;
    chrome.storage.local.get(FAVORITES_KEY).then((result) => {
      const ids = result[FAVORITES_KEY];
      if (!favoritesTouched.current && Array.isArray(ids)) {
        setFavorites(new Set(ids.filter((id): id is string => typeof id === "string")));
      }
    }).catch(() => undefined);
  }, []);

  useEffect(() => {
    const restore = (value: unknown) => {
      if (searchHistoryTouched.current || !isStringArray(value)) return;
      setSearchHistory(value.map((item) => item.trim()).filter(Boolean).slice(0, MAX_SEARCH_HISTORY));
    };

    if (typeof chrome !== "undefined" && chrome.storage?.local) {
      chrome.storage.local.get(SEARCH_HISTORY_KEY)
        .then((result) => restore(result[SEARCH_HISTORY_KEY]))
        .catch(() => undefined);
    } else {
      restore(storedLocalValue(SEARCH_HISTORY_KEY, [], isStringArray));
    }
  }, []);

  useEffect(() => {
    const restore = (value: unknown) => {
      if (recentViewedTouched.current || !isStoredFeedPosts(value)) return;
      setRecentViewedPosts(value.slice(0, MAX_RECENT_VIEWED));
    };

    if (typeof chrome !== "undefined" && chrome.storage?.local) {
      chrome.storage.local.get(RECENT_VIEWED_KEY)
        .then((result) => restore(result[RECENT_VIEWED_KEY]))
        .catch(() => undefined);
    } else {
      restore(storedLocalValue(RECENT_VIEWED_KEY, [], isStoredFeedPosts));
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    const restore = (value: unknown) => {
      if (cancelled || selectedKindsTouched.current || !Array.isArray(value)) return;
      const kinds = value.filter(isPostKind);
      if (kinds.length !== value.length) return;
      setSelectedKinds(new Set(kinds));
    };

    if (typeof chrome !== "undefined" && chrome.storage?.local) {
      chrome.storage.local.get(FILTER_KINDS_KEY)
        .then((result) => restore(result[FILTER_KINDS_KEY]))
        .catch(() => undefined);
    } else {
      try {
        const stored = window.localStorage.getItem(FILTER_KINDS_KEY);
        if (stored !== null) restore(JSON.parse(stored));
      } catch {
        // Storage can be unavailable in strict privacy modes; defaults remain usable.
      }
    }

    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const updateSystemTheme = (matches: boolean) => setSystemDark(matches);
    updateSystemTheme(media.matches);
    const onChange = (event: MediaQueryListEvent) => updateSystemTheme(event.matches);
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, []);

  useEffect(() => {
    if (typeof chrome === "undefined" || !chrome.storage?.local) return;
    chrome.storage.local.get(THEME_STORAGE_KEY).then((result) => {
      const storedPreference = result[THEME_STORAGE_KEY];
      if (!themePreferenceTouched.current && isThemePreference(storedPreference)) {
        persistLocalThemePreference(storedPreference);
        setThemePreference(storedPreference);
      }
    }).catch(() => undefined);
  }, []);

  const loadCommunities = useCallback(async () => {
    if (isDemo) return;
    setCommunityError(undefined);
    try {
      setCommunities(await fetchFeedCommunities());
    } catch (error) {
      setCommunities([]);
      setCommunityError(error instanceof Error ? error.message : "社区列表加载失败");
    }
  }, [isDemo]);

  useEffect(() => { void loadCommunities(); }, [loadCommunities]);

  useEffect(() => {
    if (!filterOpen) return;
    const closeOnPointerDown = (event: PointerEvent) => {
      const filterNode = kindFilterRef.current;
      if (!filterNode || !event.composedPath().includes(filterNode)) setFilterOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setFilterOpen(false);
    };
    document.addEventListener("pointerdown", closeOnPointerDown);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnPointerDown);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [filterOpen]);

  useEffect(() => {
    const activeButton = Array.from(communityListRef.current?.querySelectorAll<HTMLButtonElement>("button[data-community-id]") ?? [])
      .find((button) => button.dataset.communityId === (selectedCommunityId ?? "all"));
    activeButton?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [communities, selectedCommunityId]);

  function clearSearch() {
    searchGenerationRef.current += 1;
    searchLoadingRef.current = false;
    activeSearchBridgeIdRef.current = undefined;
    setSearchDraft("");
    setSearchQuery("");
    setSearchPosts([]);
    setSearchLoading(false);
    setSearchLoadingMore(false);
    setSearchError(undefined);
    setSearchHasMore(false);
    setSearchNextOffset(SEARCH_STEP);
    setSearchSuggestions([]);
  }

  function rememberSearchQuery(keyword: string) {
    const query = keyword.trim();
    if (!query) return;
    searchHistoryTouched.current = true;
    setSearchHistory((current) => {
      const next = [query, ...current.filter((item) => item !== query)].slice(0, MAX_SEARCH_HISTORY);
      persistLocalValue(SEARCH_HISTORY_KEY, next);
      return next;
    });
  }

  function rememberRecentPost(post: FeedPost) {
    recentViewedTouched.current = true;
    setRecentViewedPosts((current) => {
      const next = [post, ...current.filter((item) => item.id !== post.id)].slice(0, MAX_RECENT_VIEWED);
      persistLocalValue(RECENT_VIEWED_KEY, next);
      return next;
    });
  }

  function startOriginalSearchBridge(query: string, remember = true) {
    const bridgeId = nextSearchBridgeId();
    activeSearchBridgeIdRef.current = bridgeId;
    searchGenerationRef.current += 1;
    searchLoadingRef.current = true;
    if (remember) rememberSearchQuery(query);
    setView("discover");
    setSearchDraft(query);
    setSearchQuery(query);
    setSearchOpen(false);
    setSearchError(undefined);
    setSearchLoading(true);
    setSearchLoadingMore(false);
    setSearchPosts([]);
    setSearchHasMore(false);
    setSearchNextOffset(SEARCH_STEP);
    feedScrollRef.current?.scrollTo({ top: 0, behavior: "auto" });
    if (typeof chrome !== "undefined" && chrome.runtime?.sendMessage) {
      void chrome.runtime.sendMessage({
        channel: "xiaoheishu-internal",
        operation: "start-search-bridge-tab",
        bridgeId,
        keyword: query
      }).then((response: { ok?: boolean; error?: string } | undefined) => {
        if (!response?.ok) throw new Error(response?.error || "Search bridge tab failed");
      }).catch(() => {
        window.location.assign(originalSearchUrl(query, bridgeId));
      });
      return;
    }
    window.location.assign(originalSearchUrl(query, bridgeId));
  }

  async function runSearch(keyword: string, offset = 0, append = false, remember = true) {
    const query = keyword.trim();
    if (!query) {
      clearSearch();
      return;
    }

    if (!isDemo) {
      if (!append) startOriginalSearchBridge(query, remember);
      return;
    }

    const generation = searchGenerationRef.current + 1;
    searchGenerationRef.current = generation;
    searchLoadingRef.current = true;
    if (!append && remember) rememberSearchQuery(query);
    setView("discover");
    setSearchQuery(query);
    setSearchOpen(true);
    setSearchError(undefined);
    if (append) setSearchLoadingMore(true);
    else {
      feedScrollRef.current?.scrollTo({ top: 0, behavior: "auto" });
      setSearchLoading(true);
      setSearchPosts([]);
    }

    try {
      const result = { posts: demoSearchPosts(demoPosts ?? [], query), hasMore: false, nextOffset: 0 };
      if (searchGenerationRef.current !== generation) return;
      stageFeedReveal(result.posts, !append);
      setSearchPosts((current) => append ? mergePosts(current, result.posts) : result.posts);
      setSearchHasMore(result.hasMore);
      setSearchNextOffset(result.nextOffset);
    } catch (error) {
      if (searchGenerationRef.current !== generation) return;
      setSearchError(error instanceof Error ? error.message : "搜索结果加载失败");
      if (!append) {
        setSearchPosts([]);
        setSearchHasMore(false);
      }
    } finally {
      if (searchGenerationRef.current === generation) {
        searchLoadingRef.current = false;
        setSearchLoading(false);
        setSearchLoadingMore(false);
      }
    }
  }

  async function loadMoreSearch() {
    if (isDemo || !searchQuery || searchLoadingRef.current || searchLoading || searchLoadingMore || !searchHasMore) return;
    await runSearch(searchQuery, searchNextOffset, true);
  }

  const applyBridgedSearchResult = useCallback((
    bridged: BridgedSearchResult,
    requestedBridgeId = activeSearchBridgeIdRef.current
  ) => {
    if (requestedBridgeId && bridged.id && bridged.id !== requestedBridgeId) return false;
    if (bridged.capturedAt && Date.now() - bridged.capturedAt > SEARCH_BRIDGE_TTL_MS) return false;

    activeSearchBridgeIdRef.current = undefined;
    const query = bridged.keyword?.trim() || searchQuery || searchDraft;
    searchGenerationRef.current += 1;
    searchLoadingRef.current = false;
    setView("discover");
    setSearchDraft(query);
    setSearchQuery(query);
    setSearchOpen(false);
    setSearchLoading(false);
    setSearchLoadingMore(false);
    setSearchHasMore(false);
    setSearchNextOffset(SEARCH_STEP);

    if (bridged.error || !bridged.payload) {
      setSearchPosts([]);
      setSearchError(bridged.error || "原站搜索没有返回可解析的数据");
      return true;
    }

    try {
      const result = parseSearchPayload(bridged.payload, 0, SEARCH_STEP);
      stageFeedReveal(result.posts, true);
      setSearchPosts(result.posts);
      setSearchError(result.posts.length > 0 ? undefined : "原站搜索没有返回帖子结果");
    } catch (error) {
      setSearchPosts([]);
      setSearchError(error instanceof Error ? error.message : "原站搜索结果解析失败");
    }
    return true;
  }, [searchDraft, searchQuery, stageFeedReveal]);

  useEffect(() => {
    if (isDemo) return;
    let cancelled = false;

    const hashQuery = location.hash.includes("?")
      ? location.hash.slice(location.hash.indexOf("?") + 1)
      : "";
    const requestedBridgeId = new URLSearchParams(hashQuery).get("search_bridge") || "";

    const clearStoredBridge = () => {
      if (typeof chrome !== "undefined" && chrome.storage?.local) {
        chrome.storage.local.remove(SEARCH_BRIDGE_RESULT_KEY).catch(() => undefined);
        return;
      }
      try {
        window.localStorage.removeItem(SEARCH_BRIDGE_RESULT_KEY);
      } catch {
        // Nothing to clear when local storage is unavailable.
      }
    };

    const readStoredBridge = async (): Promise<unknown> => {
      if (typeof chrome !== "undefined" && chrome.storage?.local) {
        const result = await chrome.storage.local.get(SEARCH_BRIDGE_RESULT_KEY);
        return result[SEARCH_BRIDGE_RESULT_KEY];
      }
      try {
        const raw = window.localStorage.getItem(SEARCH_BRIDGE_RESULT_KEY);
        return raw ? JSON.parse(raw) as unknown : undefined;
      } catch {
        return undefined;
      }
    };

    void readStoredBridge().then((value) => {
      if (cancelled) return;
      const bridged = asBridgedSearchResult(value);
      if (!bridged) return;
      if (!applyBridgedSearchResult(bridged, requestedBridgeId || undefined)) {
        if (bridged.capturedAt && Date.now() - bridged.capturedAt > SEARCH_BRIDGE_TTL_MS) clearStoredBridge();
        return;
      }
      clearStoredBridge();
    }).catch(() => undefined);

    return () => {
      cancelled = true;
    };
  }, [applyBridgedSearchResult, isDemo]);

  useEffect(() => {
    if (isDemo || typeof chrome === "undefined" || !chrome.storage?.onChanged) return;

    const clearStoredBridge = () => {
      chrome.storage.local.remove(SEARCH_BRIDGE_RESULT_KEY).catch(() => undefined);
    };
    const onChanged = (changes: Record<string, chrome.storage.StorageChange>, areaName: string) => {
      if (areaName !== "local") return;
      const changed = changes[SEARCH_BRIDGE_RESULT_KEY];
      const bridged = asBridgedSearchResult(changed?.newValue);
      if (!bridged || !activeSearchBridgeIdRef.current) return;
      if (applyBridgedSearchResult(bridged)) clearStoredBridge();
    };

    chrome.storage.onChanged.addListener(onChanged);
    return () => chrome.storage.onChanged.removeListener(onChanged);
  }, [applyBridgedSearchResult, isDemo]);

  useEffect(() => {
    if (isDemo) return;
    const activeBridgeId = activeSearchBridgeIdRef.current;
    if (!activeBridgeId || !searchLoading) return;
    const timeout = window.setTimeout(() => {
      if (activeSearchBridgeIdRef.current !== activeBridgeId) return;
      activeSearchBridgeIdRef.current = undefined;
      searchLoadingRef.current = false;
      setSearchLoading(false);
      setSearchLoadingMore(false);
      setSearchError("原站搜索暂时没有返回结果，请稍后重试");
    }, SEARCH_BRIDGE_TTL_MS);
    return () => window.clearTimeout(timeout);
  }, [isDemo, searchLoading, searchQuery]);

  useEffect(() => {
    if (isDemo) return;
    let cancelled = false;

    const clearStoredBridge = () => {
      if (typeof chrome !== "undefined" && chrome.storage?.local) {
        chrome.storage.local.remove(SEARCH_BRIDGE_RESULT_KEY).catch(() => undefined);
        return;
      }
      try {
        window.localStorage.removeItem(SEARCH_BRIDGE_RESULT_KEY);
      } catch {
        // Nothing to clear when local storage is unavailable.
      }
    };

    const readStoredBridge = async (): Promise<unknown> => {
      if (typeof chrome !== "undefined" && chrome.storage?.local) {
        const result = await chrome.storage.local.get(SEARCH_BRIDGE_RESULT_KEY);
        return result[SEARCH_BRIDGE_RESULT_KEY];
      }
      try {
        const raw = window.localStorage.getItem(SEARCH_BRIDGE_RESULT_KEY);
        return raw ? JSON.parse(raw) as unknown : undefined;
      } catch {
        return undefined;
      }
    };

    void readStoredBridge().then((value) => {
      if (cancelled) return;
      const bridged = asBridgedSearchResult(value);
      if (!bridged || !activeSearchBridgeIdRef.current) return;
      if (!applyBridgedSearchResult(bridged)) {
        clearStoredBridge();
        return;
      }
      clearStoredBridge();
    }).catch(() => undefined);

    return () => {
      cancelled = true;
    };
  }, [applyBridgedSearchResult, isDemo, searchLoading]);

  useEffect(() => {
    if (!searchOpen) return;
    const closeOnPointerDown = (event: PointerEvent) => {
      const searchNode = searchShellRef.current;
      if (!searchNode || !event.composedPath().includes(searchNode)) setSearchOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setSearchOpen(false);
    };
    document.addEventListener("pointerdown", closeOnPointerDown);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnPointerDown);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [searchOpen]);

  useEffect(() => {
    const query = searchDraft.trim();
    if (!query) {
      if (searchQuery) clearSearch();
      setSearchSuggestions([]);
      return;
    }
    if (!isDemo) return;
    const timer = window.setTimeout(() => {
      void runSearch(query, 0, false, false);
    }, 450);
    return () => window.clearTimeout(timer);
  }, [isDemo, searchDraft]);

  useEffect(() => {
    const query = searchDraft.trim();
    const generation = searchSuggestionGenerationRef.current + 1;
    searchSuggestionGenerationRef.current = generation;
    if (!query) {
      setSearchSuggestions([]);
      return;
    }

    const timer = window.setTimeout(async () => {
      if (isDemo) {
        const localSuggestions = new Set<string>();
        ORIGINAL_SEARCH_DISCOVERY.forEach((word) => {
          if (word.toLocaleLowerCase().includes(query.toLocaleLowerCase())) localSuggestions.add(word);
        });
        demoSearchPosts(demoPosts ?? [], query).forEach((post) => {
          if (localSuggestions.size < 8) localSuggestions.add(post.title);
          if (post.topic && localSuggestions.size < 8) localSuggestions.add(post.topic);
        });
        if (searchSuggestionGenerationRef.current === generation) {
          setSearchSuggestions(Array.from(localSuggestions).slice(0, 8));
        }
        return;
      }

      try {
        const suggestions = await fetchSearchSuggestions(query);
        if (searchSuggestionGenerationRef.current === generation) setSearchSuggestions(suggestions);
      } catch {
        if (searchSuggestionGenerationRef.current === generation) setSearchSuggestions([]);
      }
    }, 220);

    return () => window.clearTimeout(timer);
  }, [demoPosts, isDemo, searchDraft]);

  const loadInitial = useCallback(async () => {
    if (isDemo) return;
    const generation = feedGenerationRef.current + 1;
    const requestedCommunityId = selectedCommunityId;
    const requestWidth = Math.min(Math.max(window.innerWidth - 260, 520), 1180);
    const bufferedRequest = requestedCommunityId ? undefined : fetchBufferedFeedPages(
      FEED_STEP,
      requestWidth
    );
    let initialPageVisible = false;
    feedGenerationRef.current = generation;
    loadingRef.current = true;
    loadingGenerationRef.current = null;
    requestedOffsetsRef.current.clear();
    feedCoverRatiosRef.current.clear();
    feedScrollRef.current?.scrollTo({ top: 0, behavior: "auto" });
    setHotOrder([]);
    setPosts([]);
    setInitialLoading(true);
    setLoadingMore(false);
    setFeedError(undefined);
    setHasMore(true);
    setLastValue("");
    try {
      const result = await fetchFeedPage(
        0,
        requestWidth,
        requestedCommunityId ?? undefined,
        ""
      );
      if (feedGenerationRef.current !== generation) return;
      const coverRatios = await preloadFeedCoverRatios(
        result.posts,
        () => feedGenerationRef.current === generation
      );
      if (feedGenerationRef.current !== generation) return;
      feedCoverRatiosRef.current = coverRatios;
      stageFeedReveal(result.posts, true);
      setPosts(result.posts);
      setHasMore(result.hasMore);
      setNextOffset(result.nextOffset);
      setLastValue(result.lastValue ?? "");
      setInitialLoading(false);
      initialPageVisible = true;

      if (!result.hasMore) return;
      setLoadingMore(true);
      const outcome = requestedCommunityId
        ? await fetchBufferedFeedPages(
          result.nextOffset,
          requestWidth,
          requestedCommunityId,
          result.lastValue ?? ""
        )
        : await bufferedRequest!;
      if (feedGenerationRef.current !== generation) return;
      const buffered = bufferedFeedResult(outcome.pages);
      if (buffered) {
        const bufferedCoverRatios = await preloadFeedCoverRatios(
          buffered.posts,
          () => feedGenerationRef.current === generation
        );
        if (feedGenerationRef.current !== generation) return;
        bufferedCoverRatios.forEach((ratio, postId) => {
          if (!feedCoverRatiosRef.current.has(postId)) feedCoverRatiosRef.current.set(postId, ratio);
        });
        stageFeedReveal(buffered.posts);
        setPosts((current) => mergePosts(current, buffered.posts));
        setHasMore(buffered.hasMore);
        setNextOffset(buffered.nextOffset);
        setLastValue(buffered.lastValue ?? "");
      }
      setFeedError(outcome.error
        ? outcome.error instanceof Error ? outcome.error.message : "More content preload failed, please retry"
        : undefined);
    } catch (error) {
      if (feedGenerationRef.current !== generation) return;
      if (!initialPageVisible) {
        setPosts([]);
        setHasMore(false);
        setFeedError(error instanceof Error ? error.message : "暂时无法读取小黑盒信息流");
      } else {
        setFeedError(error instanceof Error ? error.message : "More content preload failed, please retry");
      }
    } finally {
      if (feedGenerationRef.current === generation) {
        loadingRef.current = false;
        setInitialLoading(false);
        setLoadingMore(false);
      }
    }
  }, [isDemo, selectedCommunityId, stageFeedReveal]);

  const refreshDiscover = useCallback(() => {
    clearSearch();
    setView("discover");
    void loadInitial();
  }, [loadInitial]);

  useEffect(() => { void loadInitial(); }, [loadInitial]);

  const loadMore = useCallback(async () => {
    if (isDemo || initialLoading || loadingRef.current || !hasMore || selectedKinds.size === 0) return;
    const generation = feedGenerationRef.current;
    const requestedOffset = nextOffset;
    const requestedCommunityId = selectedCommunityId;
    const requestKey = `${requestedCommunityId ?? "all"}:${requestedOffset}:${lastValue}`;
    if (requestedOffsetsRef.current.has(requestKey)) return;
    requestedOffsetsRef.current.add(requestKey);
    loadingRef.current = true;
    loadingGenerationRef.current = generation;
    setLoadingMore(true);
    try {
      const outcome = await fetchBufferedFeedPages(
        requestedOffset,
        Math.min(Math.max(window.innerWidth - 260, 520), 1180),
        requestedCommunityId ?? undefined,
        lastValue
      );
      if (feedGenerationRef.current !== generation) return;
      const result = bufferedFeedResult(outcome.pages);
      if (!result) {
        if (outcome.error) throw outcome.error;
        return;
      }
      const coverRatios = await preloadFeedCoverRatios(
        result.posts,
        () => feedGenerationRef.current === generation
      );
      if (feedGenerationRef.current !== generation) return;
      coverRatios.forEach((ratio, postId) => {
        if (!feedCoverRatiosRef.current.has(postId)) feedCoverRatiosRef.current.set(postId, ratio);
      });
      stageFeedReveal(result.posts);
      setPosts((current) => mergePosts(current, result.posts));
      setHasMore(result.hasMore);
      setNextOffset(result.nextOffset);
      setLastValue(result.lastValue ?? "");
      if (outcome.error) requestedOffsetsRef.current.delete(requestKey);
      setFeedError(outcome.error
        ? outcome.error instanceof Error ? outcome.error.message : "Next page failed, please retry"
        : undefined);
    } catch (error) {
      if (feedGenerationRef.current !== generation) return;
      requestedOffsetsRef.current.delete(requestKey);
      setFeedError(error instanceof Error ? error.message : "Next page failed, please retry");
    } finally {
      if (loadingGenerationRef.current === generation) {
        loadingGenerationRef.current = null;
        loadingRef.current = false;
        setLoadingMore(false);
      }
    }
  }, [hasMore, initialLoading, isDemo, lastValue, nextOffset, selectedCommunityId, selectedKinds.size, stageFeedReveal]);

  const searchActive = searchQuery.trim().length > 0;

  useEffect(() => {
    const target = sentinelRef.current;
    const root = feedScrollRef.current;
    if (!target || !root || isDemo) return;
    const requestMore = () => {
      void (searchActive ? loadMoreSearch() : loadMore());
    };
    const observer = new IntersectionObserver((entries) => {
      if (entries[0]?.isIntersecting) requestMore();
    }, { root, rootMargin: "300px 0px", threshold: 0.01 });
    observer.observe(target);
    let checkFrame = 0;
    const checkDistance = () => {
      checkFrame = 0;
      const columns = Array.from(root.querySelectorAll<HTMLElement>(".masonry-column"));
      if (!columns.length) {
        if (root.scrollHeight - root.scrollTop - root.clientHeight < 320) requestMore();
        return;
      }
      const viewportBottom = root.getBoundingClientRect().bottom;
      const shortestColumnBottom = Math.min(...columns.map((column) => column.getBoundingClientRect().bottom));
      if (shortestColumnBottom - viewportBottom <= root.clientHeight * 1.5) requestMore();
    };
    const scheduleDistanceCheck = () => {
      if (!checkFrame) checkFrame = window.requestAnimationFrame(checkDistance);
    };
    root.addEventListener("scroll", scheduleDistanceCheck, { passive: true });
    const resizeObserver = typeof ResizeObserver === "undefined" ? undefined : new ResizeObserver(scheduleDistanceCheck);
    resizeObserver?.observe(root);
    root.querySelectorAll<HTMLElement>(".masonry-column").forEach((column) => resizeObserver?.observe(column));
    scheduleDistanceCheck();
    return () => {
      if (checkFrame) window.cancelAnimationFrame(checkFrame);
      root.removeEventListener("scroll", scheduleDistanceCheck);
      resizeObserver?.disconnect();
      observer.disconnect();
    };
  }, [isDemo, loadMore, searchActive, searchHasMore, searchLoading, searchLoadingMore, searchNextOffset, searchQuery]);

  useEffect(() => {
    if (view !== "hot") return;
    setHotOrder((current) => {
      const knownIds = new Set(current);
      const additions = posts
        .filter((post) => !knownIds.has(post.id))
        .sort((a, b) => hotScore(b) - hotScore(a))
        .map((post) => post.id);
      return additions.length ? [...current, ...additions] : current;
    });
  }, [posts, view]);

  const feedInitialBusy = searchActive ? searchLoading && searchPosts.length === 0 : initialLoading;
  const activeFeedError = searchActive ? searchError : feedError;
  const activeHasMore = searchActive ? searchHasMore : hasMore;
  const activeLoadingMore = searchActive ? searchLoadingMore : loadingMore;
  const activeSourcePosts = searchActive ? searchPosts : posts;

  const searchPanelSuggestions = useMemo(() => {
    const query = searchDraft.trim().toLocaleLowerCase();
    if (!query) return [];
    if (searchSuggestions.length) return searchSuggestions;

    const labels = new Set<string>();
    [...searchPosts, ...posts].forEach((post) => {
      for (const value of [post.topic, post.author, post.title]) {
        if (!value || labels.size >= 6) continue;
        if (value.toLocaleLowerCase().includes(query)) labels.add(value);
      }
    });
    return Array.from(labels).slice(0, 6);
  }, [posts, searchDraft, searchPosts, searchSuggestions]);

  const searchDiscoveryChips = ORIGINAL_SEARCH_DISCOVERY;

  const searchPreviewPosts = useMemo(() => {
    if (searchActive) return searchPosts.slice(0, 4);
    const query = searchDraft.trim();
    return query ? demoSearchPosts(posts, query).slice(0, 4) : recentViewedPosts.slice(0, 4);
  }, [posts, recentViewedPosts, searchActive, searchDraft, searchPosts]);

  const visiblePosts = useMemo(() => {
    const result = activeSourcePosts.filter((post) => {
      if (!searchActive && view === "saved" && !favorites.has(post.id)) return false;
      if (!selectedKinds.has(post.kind)) return false;
      return true;
    });
    if (searchActive || view !== "hot") return result;

    const orderById = new Map(hotOrder.map((id, index) => [id, index]));
    const ranked: FeedPost[] = [];
    const additions: FeedPost[] = [];
    result.forEach((post) => {
      if (orderById.has(post.id)) ranked.push(post);
      else additions.push(post);
    });
    ranked.sort((a, b) => (orderById.get(a.id) ?? 0) - (orderById.get(b.id) ?? 0));
    additions.sort((a, b) => hotScore(b) - hotScore(a));
    return [...ranked, ...additions];
  }, [activeSourcePosts, favorites, hotOrder, searchActive, selectedKinds, view]);

  const masonryColumns = useMemo(() => {
    return distributeFeedPosts(visiblePosts, masonryColumnCount, feedCoverRatiosRef.current);
  }, [masonryColumnCount, visiblePosts]);

  function selectCommunity(communityId: string | null) {
    if (searchQuery || searchDraft) clearSearch();
    if (communityId === selectedCommunityId) return;
    if (isDemo) {
      setSelectedCommunityId(communityId);
      feedScrollRef.current?.scrollTo({ top: 0, behavior: "auto" });
      return;
    }
    feedGenerationRef.current += 1;
    loadingRef.current = true;
    loadingGenerationRef.current = null;
    requestedOffsetsRef.current.clear();
    feedCoverRatiosRef.current.clear();
    setSelectedCommunityId(communityId);
    setPosts([]);
    setInitialLoading(true);
    setLoadingMore(false);
    setFeedError(undefined);
    setHasMore(true);
    setLastValue("");
    feedScrollRef.current?.scrollTo({ top: 0, behavior: "auto" });
  }

  function setSelectedKindsAndPersist(next: Set<PostKind>) {
    selectedKindsTouched.current = true;
    setSelectedKinds(next);
    const storedKinds = ALL_POST_KINDS.filter((kind) => next.has(kind));
    if (typeof chrome !== "undefined" && chrome.storage?.local) {
      chrome.storage.local.set({ [FILTER_KINDS_KEY]: storedKinds }).catch(() => undefined);
      return;
    }
    try {
      window.localStorage.setItem(FILTER_KINDS_KEY, JSON.stringify(storedKinds));
    } catch {
      // The active selection still works when persistence is unavailable.
    }
  }

  function toggleKind(kind: PostKind) {
    const next = new Set(selectedKinds);
    if (next.has(kind)) next.delete(kind); else next.add(kind);
    setSelectedKindsAndPersist(next);
  }

  function selectAllKinds() {
    setSelectedKindsAndPersist(new Set(ALL_POST_KINDS));
  }

  function selectThemePreference(preference: ThemePreference) {
    themePreferenceTouched.current = true;
    setThemePreference(preference);
    persistLocalThemePreference(preference);
    if (typeof chrome !== "undefined" && chrome.storage?.local) {
      chrome.storage.local.set({ [THEME_STORAGE_KEY]: preference }).catch(() => undefined);
    }
  }

  function resetFeedSelection() {
    clearSearch();
    setView("discover");
    selectAllKinds();
    setFilterOpen(false);
    selectCommunity(null);
  }

  function setLocalFavorite(id: string, saved: boolean) {
    favoritesTouched.current = true;
    setFavorites((current) => {
      const next = new Set(current);
      if (saved) next.add(id); else next.delete(id);
      if (typeof chrome !== "undefined" && chrome.storage?.local) {
        chrome.storage.local.set({ [FAVORITES_KEY]: Array.from(next) }).catch(() => undefined);
      }
      return next;
    });
  }

  function resetDetailRecommendations() {
    recommendationRequestRef.current += 1;
    setDetailRecommendations([]);
    setDetailRecommendationsLoading(false);
    setDetailRecommendationsError(undefined);
  }

  function communityForPost(post: FeedPost): Community | undefined {
    const topicId = post.topicId?.trim();
    if (topicId) {
      const byId = communities.find((community) => community.id === topicId);
      if (byId) return byId;
      if (post.topic) return { id: topicId, name: post.topic, iconUrl: post.topicIcon };
    }
    const topicName = post.topic.trim();
    if (!topicName) return undefined;
    return communities.find((community) => community.name === topicName);
  }

  const loadDetailRecommendations = useCallback(async (post: FeedPost) => {
    const requestId = recommendationRequestRef.current + 1;
    recommendationRequestRef.current = requestId;
    setDetailRecommendations([]);
    setDetailRecommendationsError(undefined);

    const community = communityForPost(post);
    const candidateFallback = [...posts, ...searchPosts, ...recentViewedPosts];
    if (isDemo) {
      setDetailRecommendations(rankedRecommendations(post, demoPosts ?? candidateFallback));
      setDetailRecommendationsLoading(false);
      return;
    }

    if (!community) {
      setDetailRecommendations(rankedRecommendations(post, candidateFallback));
      setDetailRecommendationsLoading(false);
      return;
    }

    setDetailRecommendationsLoading(true);
    try {
      const width = Math.min(Math.max(window.innerWidth - 260, 520), 1180);
      const page = await fetchFeedPage(0, width, community.id, "");
      if (recommendationRequestRef.current !== requestId) return;
      const mergedCandidates = mergePosts(page.posts, candidateFallback);
      setDetailRecommendations(rankedRecommendations(post, mergedCandidates));
    } catch (error) {
      if (recommendationRequestRef.current !== requestId) return;
      setDetailRecommendations(rankedRecommendations(post, candidateFallback));
      setDetailRecommendationsError(error instanceof Error ? error.message : "相关推荐加载失败");
    } finally {
      if (recommendationRequestRef.current === requestId) setDetailRecommendationsLoading(false);
    }
  }, [communities, demoPosts, isDemo, posts, recentViewedPosts, searchPosts]);

  const loadDetail = useCallback(async (post: FeedPost, navigate = true) => {
    rememberRecentPost(post);
    selectedIdRef.current = post.id;
    setSelectedPost(post);
    setDetail(undefined);
    setDetailError(undefined);
    setDetailLoading(true);
    resetDetailRecommendations();
    setFollowLoading(false);
    setPostActionLoading(undefined);
    setFavoritePickerOpen(false);
    setFavoriteFolders([]);
    setLikingCommentIds(new Set());
    commentRequestRef.current = undefined;
    replyRequestKeysRef.current.clear();
    setLoadingMoreComments(false);
    setLoadingReplyIds(new Set());
    if (navigate) history.pushState({ xiaoheishuDetail: true }, "", `#/post/${encodeURIComponent(post.id)}`);

    try {
      const nextDetail = isDemo ? demoDetails[post.id] : await fetchPostDetail(post.id, post);
      if (!nextDetail) throw new Error("No detail data for this post yet");
      if (selectedIdRef.current !== post.id) return;
      const localLikeState = postLikeOverridesRef.current.get(post.id);
      setDetail(localLikeState === undefined ? nextDetail : {
        ...nextDetail,
        post: withPostLikeState(nextDetail.post, localLikeState)
      });
      void loadDetailRecommendations(nextDetail.post);
      history.replaceState({
        ...(history.state ?? {}),
        xiaoheishuDetail: navigate || history.state?.xiaoheishuDetail === true
      }, "", `#/post/${encodeURIComponent(post.id)}`);
    } catch (error) {
      if (selectedIdRef.current === post.id) {
        setDetailError(error instanceof Error ? error.message : "帖子详情加载失败");
      }
    } finally {
      if (selectedIdRef.current === post.id) setDetailLoading(false);
    }
  }, [demoDetails, isDemo, loadDetailRecommendations]);

  useEffect(() => {
    if (!location.hash) history.replaceState(history.state, "", "#/feed");
    const onPopState = () => {
      const route = parseHashRoute();
      if (!route) {
        selectedIdRef.current = undefined;
        setSelectedPost(undefined);
        setDetail(undefined);
        setDetailError(undefined);
        resetDetailRecommendations();
        setFollowLoading(false);
        setPostActionLoading(undefined);
        setFavoritePickerOpen(false);
        setFavoriteFolders([]);
        setLikingCommentIds(new Set());
        replyRequestKeysRef.current.clear();
        setLoadingReplyIds(new Set());
        return;
      }
      if (route.id === selectedIdRef.current) return;
      const post = posts.find((item) => item.id === route.id) ?? placeholderPost(route.id);
      void loadDetail(post, false);
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, [loadDetail, posts]);

  useEffect(() => {
    const route = parseHashRoute();
    if (!route || route.id === selectedIdRef.current) return;
    const post = posts.find((item) => item.id === route.id) ?? placeholderPost(route.id);
    void loadDetail(post, false);
  }, [loadDetail, posts]);

  function closeDetail() {
    selectedIdRef.current = undefined;
    setSelectedPost(undefined);
    setDetail(undefined);
    setDetailError(undefined);
    setDetailLoading(false);
    resetDetailRecommendations();
    setFollowLoading(false);
    setPostActionLoading(undefined);
    setFavoritePickerOpen(false);
    setFavoriteFolders([]);
    setLikingCommentIds(new Set());
    replyRequestKeysRef.current.clear();
    setLoadingReplyIds(new Set());
    if (history.state?.xiaoheishuDetail) {
      history.back();
      return;
    }
    history.replaceState(history.state, "", "#/feed");
  }

  function openPostTopic(post: FeedPost) {
    const community = communityForPost(post);
    if (!community) {
      showImageActionNotice("No available topic information for this post", true);
      return;
    }

    if (!communities.some((item) => item.id === community.id)) {
      setCommunities((current) => current.some((item) => item.id === community.id)
        ? current
        : [community, ...current]);
    }

    selectedIdRef.current = undefined;
    setSelectedPost(undefined);
    setDetail(undefined);
    setDetailError(undefined);
    setDetailLoading(false);
    resetDetailRecommendations();
    setFollowLoading(false);
    setPostActionLoading(undefined);
    setFavoritePickerOpen(false);
    setFavoriteFolders([]);
    setLikingCommentIds(new Set());
    replyRequestKeysRef.current.clear();
    setLoadingReplyIds(new Set());
    setSearchOpen(false);
    setFilterOpen(false);
    setView("discover");
    selectAllKinds();
    history.replaceState({ ...(history.state ?? {}), xiaoheishuDetail: false }, "", "#/feed");
    selectCommunity(community.id);
  }

  async function toggleSelectedAuthorFollow() {
    if (!detail || followLoading) return;
    const linkId = detail.post.id;
    const followingId = detail.post.authorId;
    const nextFollowing = !Boolean(detail.post.isFollowing);

    if (!isDemo && !followingId) {
      showImageActionNotice("This post has no author id, so follow is unavailable", true);
      return;
    }

    setFollowLoading(true);
    try {
      if (!isDemo) await setPostAuthorFollowing(linkId, followingId!, nextFollowing);
      if (selectedIdRef.current !== linkId) return;

      setDetail((current) => current?.post.id === linkId ? {
        ...current,
        post: { ...current.post, isFollowing: nextFollowing }
      } : current);
      setSelectedPost((current) => current?.id === linkId
        ? { ...current, isFollowing: nextFollowing }
        : current);
      setPosts((current) => current.map((post) => (
        post.id === linkId || Boolean(followingId && post.authorId === followingId)
          ? { ...post, isFollowing: nextFollowing }
          : post
      )));
      showImageActionNotice(nextFollowing ? `Followed ${detail.post.author}` : `Unfollowed ${detail.post.author}`);
    } catch (error) {
      if (selectedIdRef.current === linkId) {
        showImageActionNotice(error instanceof Error ? error.message : "Follow state update failed", true);
      }
    } finally {
      if (selectedIdRef.current === linkId) setFollowLoading(false);
    }
  }

  function updatePostAcrossViews(linkId: string, updater: (post: FeedPost) => FeedPost) {
    setDetail((current) => current?.post.id === linkId ? { ...current, post: updater(current.post) } : current);
    setSelectedPost((current) => current?.id === linkId ? updater(current) : current);
    setPosts((current) => current.map((post) => post.id === linkId ? updater(post) : post));
  }

  function setPostLikePending(linkId: string, pending: boolean) {
    if (pending) likingPostIdsRef.current.add(linkId); else likingPostIdsRef.current.delete(linkId);
    setLikingPostIds((current) => {
      const next = new Set(current);
      if (pending) next.add(linkId); else next.delete(linkId);
      return next;
    });
  }

  function applyPostLikeState(linkId: string, liked: boolean) {
    updatePostAcrossViews(linkId, (post) => withPostLikeState(post, liked));
  }

  async function togglePostLike(post: FeedPost) {
    const linkId = post.id;
    if (likingPostIdsRef.current.has(linkId)) return;
    if (selectedIdRef.current === linkId && postActionLoading) return;

    const previousLiked = Boolean(post.isLiked);
    const nextLiked = !previousLiked;
    const selectedAtStart = selectedIdRef.current === linkId;

    postLikeOverridesRef.current.set(linkId, nextLiked);
    setPostLikePending(linkId, true);
    if (selectedAtStart) setPostActionLoading("like");
    applyPostLikeState(linkId, nextLiked);
    try {
      if (!isDemo) await setPostLiked(linkId, nextLiked);
      // A detail request can finish while the mutation is in flight. Applying the
      // target again brings that newly loaded copy in sync without double-counting.
      applyPostLikeState(linkId, nextLiked);
      if (!selectedIdRef.current || selectedIdRef.current === linkId) {
        showImageActionNotice(nextLiked ? "Liked" : "Unliked");
      }
    } catch (error) {
      postLikeOverridesRef.current.delete(linkId);
      applyPostLikeState(linkId, previousLiked);
      if (!selectedIdRef.current || selectedIdRef.current === linkId) {
        showImageActionNotice(error instanceof Error ? error.message : "Like state update failed", true);
      }
    } finally {
      setPostLikePending(linkId, false);
      if (selectedIdRef.current === linkId) {
        setPostActionLoading((current) => current === "like" ? undefined : current);
      }
    }
  }

  async function toggleSelectedPostFavorite(folderId?: string) {
    if (!detail || postActionLoading) return;
    const linkId = detail.post.id;
    const previousFavorited = Boolean(detail.post.isFavorited);
    const nextFavorited = !previousFavorited;
    let selectedFolderId = folderId ?? "";

    setPostActionLoading("favorite");
    if (nextFavorited && !isDemo && folderId === undefined) {
      try {
        const folders = await fetchFavoriteFolders();
        if (selectedIdRef.current !== linkId) return;
        const orderedFolders = [...folders].sort((left, right) => Number(right.isDefault) - Number(left.isDefault));
        setFavoriteFolders(orderedFolders);
        if (orderedFolders.length === 0) {
          setPostActionLoading(undefined);
          showImageActionNotice("当前账号还没有收藏夹，请先在原版小黑盒创建收藏夹", true);
          return;
        }
        if (orderedFolders.length > 1) {
          setFavoritePickerOpen(true);
          setPostActionLoading(undefined);
          return;
        }
        selectedFolderId = orderedFolders[0]?.id ?? "";
      } catch (error) {
        if (selectedIdRef.current === linkId) {
          setPostActionLoading(undefined);
          showImageActionNotice(error instanceof Error ? error.message : "Favorite folders failed to load", true);
        }
        return;
      }
    }

    const previousFavorites = detail.post.favorites ?? 0;
    const nextFavorites = Math.max(0, previousFavorites + (nextFavorited ? 1 : -1));
    const applyNext = (post: FeedPost): FeedPost => ({ ...post, isFavorited: nextFavorited, favorites: nextFavorites });
    const rollback = (post: FeedPost): FeedPost => ({ ...post, isFavorited: previousFavorited, favorites: previousFavorites });
    setFavoritePickerOpen(false);
    updatePostAcrossViews(linkId, applyNext);

    try {
      if (!isDemo) await setPostFavorited(linkId, nextFavorited, selectedFolderId);
      setLocalFavorite(linkId, nextFavorited);
      if (selectedIdRef.current === linkId) showImageActionNotice(nextFavorited ? "Favorited" : "Unfavorited");
    } catch (error) {
      updatePostAcrossViews(linkId, rollback);
      if (selectedIdRef.current === linkId) {
        showImageActionNotice(error instanceof Error ? error.message : "Favorite state update failed", true);
      }
    } finally {
      if (selectedIdRef.current === linkId) setPostActionLoading(undefined);
    }
  }

  async function toggleCommentLike(commentId: string) {
    if (!detail || likingCommentIds.has(commentId)) return;
    const target = findComment(detail.comments, commentId);
    if (!target) return;
    const linkId = detail.post.id;
    const previousLiked = Boolean(target.isLiked);
    const nextLiked = !previousLiked;
    const previousLikes = target.likes;
    const updateTarget = (liked: boolean, likes: number) => (comment: CommentItem): CommentItem => ({
      ...comment,
      isLiked: liked,
      likes
    });

    setLikingCommentIds((current) => new Set(current).add(commentId));
    setDetail((current) => current?.post.id === linkId ? {
      ...current,
      comments: updateComment(current.comments, commentId, updateTarget(nextLiked, Math.max(0, previousLikes + (nextLiked ? 1 : -1))))
    } : current);
    try {
      if (!isDemo) await setCommentLiked(commentId, nextLiked);
    } catch (error) {
      setDetail((current) => current?.post.id === linkId ? {
        ...current,
        comments: updateComment(current.comments, commentId, updateTarget(previousLiked, previousLikes))
      } : current);
      if (selectedIdRef.current === linkId) {
        showImageActionNotice(error instanceof Error ? error.message : "Comment like update failed", true);
      }
    } finally {
      setLikingCommentIds((current) => {
        const next = new Set(current);
        next.delete(commentId);
        return next;
      });
    }
  }

  async function loadMoreComments() {
    if (!detail || commentRequestRef.current || !detail.hasMoreComments || isDemo) return;
    const linkId = detail.post.id;
    const nextPage = detail.commentPage + 1;
    const requestKey = `${linkId}:${nextPage}`;
    commentRequestRef.current = requestKey;
    setLoadingMoreComments(true);
    try {
      const result = await fetchMoreComments(linkId, nextPage);
      if (selectedIdRef.current !== linkId) return;
      setDetail((current) => current && current.post.id === linkId ? {
        ...current,
        comments: mergeComments(current.comments, result.comments),
        hasMoreComments: result.hasMoreComments,
        commentPage: result.commentPage
      } : current);
      setDetailError(undefined);
    } catch (error) {
      if (selectedIdRef.current === linkId) {
        setDetailError(error instanceof Error ? error.message : "评论加载失败");
      }
    } finally {
      if (commentRequestRef.current === requestKey) {
        commentRequestRef.current = undefined;
        setLoadingMoreComments(false);
      }
    }
  }

  async function loadMoreReplies(rootCommentId: string) {
    if (!detail || isDemo) return;
    const root = detail.comments.find((comment) => comment.id === rootCommentId);
    if (!root?.hasMoreReplies || replyRequestKeysRef.current.has(rootCommentId)) return;

    const linkId = detail.post.id;
    const lastCommentId = root.replies.at(-1)?.id ?? "";
    const requestKey = `${linkId}:${rootCommentId}:${lastCommentId}`;
    replyRequestKeysRef.current.set(rootCommentId, requestKey);
    setLoadingReplyIds((current) => new Set(current).add(rootCommentId));

    try {
      const result = await fetchCommentReplies(rootCommentId, lastCommentId);
      if (selectedIdRef.current !== linkId) return;
      setDetail((current) => {
        if (!current || current.post.id !== linkId) return current;
        const comments = current.comments.map((comment) => {
          if (comment.id !== rootCommentId) return comment;
          const replies = [...comment.replies];
          const knownIds = new Set(replies.map((reply) => reply.id));
          result.replies.forEach((reply) => {
            if (knownIds.has(reply.id)) return;
            knownIds.add(reply.id);
            replies.push(reply);
          });
          const madeProgress = replies.length > comment.replies.length;
          const replyCount = Math.max(comment.replyCount ?? 0, replies.length);
          const hasMoreReplies = !result.exhausted
            && madeProgress
            && ((comment.replyCount ?? 0) > 0 ? replies.length < replyCount : true);
          return { ...comment, replies, replyCount, hasMoreReplies };
        });
        return { ...current, comments };
      });
      setDetailError(undefined);
    } catch (error) {
      if (selectedIdRef.current === linkId) {
        setDetailError(error instanceof Error ? error.message : "Replies failed to load");
      }
    } finally {
      if (replyRequestKeysRef.current.get(rootCommentId) === requestKey) {
        replyRequestKeysRef.current.delete(rootCommentId);
        setLoadingReplyIds((current) => {
          const next = new Set(current);
          next.delete(rootCommentId);
          return next;
        });
      }
    }
  }

  return (
    <div className="xhs-root" data-theme={resolvedTheme} data-theme-preference={themePreference}>
      <div className="app-shell">
        <aside className="sidebar">
          <BrandWordmark />

          <nav className="side-nav" aria-label="Feed navigation">
            <button
              className="active"
              aria-current="page"
              onClick={refreshDiscover}
            ><CompassIcon /><span>发现</span></button>
          </nav>

          <div className="sidebar__bottom">
            <section className="sidebar-settings" aria-label="HeyNote settings">
              <ThemeSwitcher preference={themePreference} onChange={selectThemePreference} />
              <ModeSwitcher />
            </section>
          </div>
        </aside>

        <main className="main-panel">
          <header className="topbar">
            <BrandWordmark compact />
            <div className="search-shell" ref={searchShellRef}>
              <form
                className={`search-box${searchOpen ? " is-open" : ""}${searchActive ? " is-active" : ""}`}
                role="search"
                onSubmit={(event) => {
                  event.preventDefault();
                  void runSearch(searchDraft);
                }}
              >
                <SearchIcon />
                <input
                  value={searchDraft}
                  aria-label="Search Heybox posts"
                  placeholder="Search posts, communities, players"
                  onFocus={() => setSearchOpen(true)}
                  onChange={(event) => setSearchDraft(event.target.value)}
                />
                {(searchDraft || searchActive) && (
                  <button
                    className="search-box__clear"
                    type="button"
                    aria-label="清空搜索"
                    title="清空搜索"
                    onClick={clearSearch}
                  >
                    <CloseIcon />
                  </button>
                )}
              </form>

              {searchOpen && (
                <div className="search-panel" role="dialog" aria-label="Search panel">
                  <div className="search-panel__head">
                    <strong>{searchDraft.trim() || "Search Heybox"}</strong>
                    <a href={originalSearchUrl(searchDraft || searchQuery)} target="_blank" rel="noreferrer">
                      原站打开
                      <ExternalIcon />
                    </a>
                  </div>

                  {searchDraft.trim() ? (
                    searchPanelSuggestions.length > 0 && (
                      <div className="search-panel__chips" aria-label="搜索建议">
                        <span>搜索建议</span>
                        {searchPanelSuggestions.map((label) => (
                          <button
                            type="button"
                            key={label}
                            onClick={() => {
                              setSearchDraft(label);
                              void runSearch(label);
                            }}
                          >
                            {label}
                          </button>
                        ))}
                      </div>
                    )
                  ) : (
                    <>
                      {searchHistory.length > 0 && (
                        <div className="search-panel__chips" aria-label="搜索历史">
                          <span>搜索历史</span>
                          {searchHistory.map((label) => (
                            <button
                              type="button"
                              key={label}
                              onClick={() => {
                                setSearchDraft(label);
                                void runSearch(label);
                              }}
                            >
                              {label}
                            </button>
                          ))}
                        </div>
                      )}

                      <div className="search-panel__chips" aria-label="搜索发现">
                        <span>搜索发现</span>
                        {searchDiscoveryChips.map((label) => (
                          <button
                            type="button"
                            key={label}
                            onClick={() => {
                              setSearchDraft(label);
                              void runSearch(label);
                            }}
                          >
                            {label}
                          </button>
                        ))}
                      </div>
                    </>
                  )}

                  <div className="search-panel__status" aria-live="polite">
                    {searchLoading
                      ? "正在同步搜索结果"
                      : searchError
                        ? searchError
                        : searchActive
                          ? `${searchPosts.length} 条结果`
                          : recentViewedPosts.length > 0 ? "最近浏览" : "还没有最近浏览"}
                  </div>

                  {searchPreviewPosts.length > 0 && (
                    <div className="search-panel__results">
                      {searchPreviewPosts.map((post) => (
                        <button
                          type="button"
                          key={post.id}
                          onClick={() => {
                            setSearchOpen(false);
                            void loadDetail(post);
                          }}
                        >
                          <span>
                            {post.topicIcon && (
                              <img
                                src={post.topicIcon}
                                alt=""
                                loading="lazy"
                                decoding="async"
                                referrerPolicy="no-referrer"
                              />
                            )}
                            <span>{post.topic}</span>
                          </span>
                          <strong><HeyboxText value={post.title} emojiSize={14} preserveLineBreaks={false} /></strong>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
            <div className="top-actions">
              <button type="button" onClick={refreshDiscover} disabled={feedInitialBusy || isDemo} title="Refresh feed"><RefreshIcon className={feedInitialBusy ? "spin" : ""} /></button>
              <button type="button" onClick={requestOriginalMode} title="Switch to original forum"><ExternalIcon /></button>
            </div>
          </header>

          <div className="feed-scroll" ref={feedScrollRef}>
            <div className="community-toolbar">
              <div
                className="community-list"
                ref={communityListRef}
                aria-label="Community feed"
                aria-busy={!isDemo && communities.length === 0 && !communityError}
              >
                <button
                  type="button"
                  data-community-id="all"
                  className={selectedCommunityId === null ? "active" : ""}
                  aria-pressed={selectedCommunityId === null}
                  onClick={() => selectCommunity(null)}
                >
                  <span className="community-list__icon community-list__icon--all" aria-hidden="true">全</span>
                  全部
                </button>
                {communities.map((community) => (
                  <button
                    type="button"
                    key={community.id}
                    data-community-id={community.id}
                    className={selectedCommunityId === community.id ? "active" : ""}
                    aria-pressed={selectedCommunityId === community.id}
                    onClick={() => selectCommunity(community.id)}
                  >
                    {community.iconUrl && (
                      <img
                        className="community-list__icon"
                        src={community.iconUrl}
                        alt=""
                        loading="lazy"
                        decoding="async"
                        referrerPolicy="no-referrer"
                      />
                    )}
                    {community.name}
                  </button>
                ))}
                {communityError && (
                  <button className="community-list__retry" type="button" onClick={() => void loadCommunities()}>
                    社区列表重试
                  </button>
                )}
              </div>

              <div className="feed-kind-filter" ref={kindFilterRef}>
                <button
                  className="feed-kind-filter__trigger"
                  type="button"
                  aria-haspopup="dialog"
                  aria-expanded={filterOpen}
                  onClick={() => setFilterOpen((open) => !open)}
                >
                  <FilterIcon />
                  <span>筛选</span>
                </button>

                {filterOpen && (
                  <div className="feed-kind-filter__popover" role="dialog" aria-label="Filter content types">
                    <div className="feed-kind-filter__heading">
                      <strong>内容类型</strong>
                      <button type="button" onClick={selectAllKinds}>全部</button>
                    </div>
                    <div className="feed-kind-filter__options" role="group" aria-label="可见内容类型">
                      {KIND_FILTER_OPTIONS.map(({ key, label, icon: Icon }) => (
                        <label key={key} className={selectedKinds.has(key) ? "is-checked" : ""}>
                          <input
                            type="checkbox"
                            checked={selectedKinds.has(key)}
                            onChange={() => toggleKind(key)}
                          />
                          <span className="feed-kind-filter__check" aria-hidden="true" />
                          <Icon />
                          <span>{label}</span>
                        </label>
                      ))}
                    </div>
                    <p>取消勾选的类型不会出现在瀑布流中</p>
                  </div>
                )}
              </div>
            </div>

            {activeFeedError && (
              <div className="feed-notice is-error">
                <div><strong>{activeSourcePosts.length ? "下一页暂时没有加载成功" : searchActive ? "没有拿到搜索结果" : "没有拿到信息流"}</strong><span>{activeFeedError}</span></div>
                <button type="button" onClick={() => void (searchActive ? runSearch(searchQuery) : activeSourcePosts.length ? loadMore() : loadInitial())}>{activeSourcePosts.length ? "重试本页" : "重新连接"}</button>
              </div>
            )}

            {feedInitialBusy ? <FeedSkeleton columns={masonryColumnCount} /> : visiblePosts.length ? (
              <section
                className="masonry-feed"
                aria-live="polite"
                aria-busy={activeLoadingMore}
                style={{ gridTemplateColumns: `repeat(${masonryColumnCount}, minmax(0, 1fr))` }}
              >
                {masonryColumns.map((columnPosts, columnIndex) => (
                  <div className="masonry-column" key={`column-${columnIndex}`}>
                    {columnPosts.map((post, rowIndex) => (
                      <PostCard
                        key={post.id}
                        post={post}
                        eager={rowIndex < 3}
                        revealDelay={feedRevealDelays.get(post.id)}
                        likeLoading={likingPostIds.has(post.id)}
                        onLike={() => void togglePostLike(post)}
                        onOpen={() => void loadDetail(post)}
                      />
                    ))}
                  </div>
                ))}
              </section>
            ) : !activeFeedError ? (
              <section className="empty-state">
                <span>Empty</span>
                <h2>{searchActive ? "没有找到相关帖子" : view === "saved" ? "还没有收藏帖子" : "这里还没有内容"}</h2>
                <p>{searchActive
                  ? "可以换个关键词再试。"
                  : view === "saved"
              ? "在帖子详情里收藏后会显示在这里。"
                  : selectedKinds.size === 0
                    ? "所有内容类型都被隐藏了。"
                    : "可以换个分区或内容类型看看。"}</p>
                <button type="button" onClick={resetFeedSelection}>{searchActive ? "回到推荐" : selectedKinds.size === 0 ? "显示全部类型" : "回到推荐"}</button>
              </section>
            ) : null}

            <div className="feed-sentinel" ref={sentinelRef}>
              {activeLoadingMore && <><i /><span>正在加载下一页</span></>}
              {!activeHasMore && activeSourcePosts.length > 0 && <span>{searchActive ? "搜索结果已到底" : "当前信息流已到底"}</span>}
            </div>
          </div>

        </main>
      </div>

      <div className="mobile-mode-switcher">
        <ModeSwitcher compact />
      </div>

      {detailLoading && selectedPost && (
        <div className="detail-load-progress" role="status" aria-label="正在加载帖子"><i /></div>
      )}

      {selectedPost && !detailLoading && !detail && detailError && (
        <div className="detail-load-error" role="alert">
          <span>{detailError}</span>
          <button type="button" onClick={() => void loadDetail(selectedPost, false)}>重试</button>
          <button type="button" onClick={closeDetail}>返回</button>
        </div>
      )}

      {selectedPost && detail && (
        <DetailViews
          detail={detail}
          error={detailError}
          onClose={closeDetail}
          onToggleFollow={() => void toggleSelectedAuthorFollow()}
          followLoading={followLoading}
          onTogglePostLike={() => detail && void togglePostLike(detail.post)}
          onTogglePostFavorite={() => void toggleSelectedPostFavorite()}
          postActionLoading={postActionLoading}
          favoriteFolders={favoriteFolders}
          favoritePickerOpen={favoritePickerOpen}
          onSelectFavoriteFolder={(folderId) => void toggleSelectedPostFavorite(folderId)}
          onCloseFavoritePicker={() => setFavoritePickerOpen(false)}
          onToggleCommentLike={(commentId) => void toggleCommentLike(commentId)}
          likingCommentIds={likingCommentIds}
          onRetry={() => void loadDetail(selectedPost, false)}
          onLoadMoreComments={() => void loadMoreComments()}
          loadingMoreComments={loadingMoreComments}
          onLoadMoreReplies={isDemo ? undefined : (rootCommentId) => void loadMoreReplies(rootCommentId)}
          loadingReplyIds={loadingReplyIds}
          onImageContextMenu={openImageContextMenu}
          recommendations={detailRecommendations}
          recommendationsLoading={detailRecommendationsLoading}
          recommendationsError={detailRecommendationsError}
          onOpenRecommendation={(post) => void loadDetail(post)}
          onOpenTopic={openPostTopic}
        />
      )}

      {imageContextMenu && (
        <ImageContextMenu
          state={imageContextMenu}
          onClose={closeImageContextMenu}
          onCopy={(target) => {
            void copyImageAction(target).then(() => {
              showImageActionNotice("Image copied");
            }).catch((error) => {
              showImageActionNotice(imageActionError(error, "图片复制失败"), true);
            });
          }}
          onDownload={(target) => {
            void downloadImageAction(target).then(() => {
              showImageActionNotice("Download started");
            }).catch((error) => {
              showImageActionNotice(imageActionError(error, "图片下载失败"), true);
            });
          }}
        />
      )}

      {imageActionNotice && (
        <div className={`image-action-toast${imageActionNotice.error ? " is-error" : ""}`} role="status">
          {imageActionNotice.message}
        </div>
      )}
    </div>
  );
}

