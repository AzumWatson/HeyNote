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
import type { CommentItem, Community, FavoriteFolder, FeedPost, FeedResult, ImageMedia, PostDetail, PostKind, SearchFilterOption, SearchFilterSelection, SearchFilters, SearchResult, SearchSuggestion, SearchType, SearchUser } from "./types";
import {
  fetchCommentReplies,
  fetchFavoriteFolders,
  fetchFeedCommunities,
  fetchFeedPage,
  fetchSearchFound,
  fetchSearchPage,
  fetchSearchSuggestions,
  fetchSearchWelcomePage,
  fetchMoreComments,
  fetchPostDetail,
  setCommentLiked,
  setPostAuthorFollowing,
  setSearchUserFollowing,
  setPostFavorited,
  setPostLiked
} from "./data/heybox";
import { DetailViews } from "./components/DetailViews";
import { GeneratedTextCover } from "./components/GeneratedTextCover";
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
  TrashIcon,
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
const FEED_STEP = 30;
const FEED_BUFFER_PAGES = 3;
const FEED_REVEAL_DURATION_MS = 180;
const FEED_REVEAL_STAGGER_MS = 15;
const SEARCH_HISTORY_KEY = "website:bbs-search-history";
const SEARCH_TYPES: Array<{ value: SearchType; label: string }> = [
  { value: "general", label: "内容" },
  { value: "user", label: "用户" }
];
const EMPTY_SEARCH_FILTER_SELECTION: SearchFilterSelection = { filter: "", sort: "", timeRange: "" };
const ORIGINAL_FORUM_URL = "https://www.xiaoheihe.cn/app/bbs/home";
export const ORIGINAL_MODE_REQUEST_EVENT = "xiaoheishu:request-original-mode";

function isPostKind(value: unknown): value is PostKind {
  return typeof value === "string" && ALL_POST_KINDS.includes(value as PostKind);
}

function readSearchHistory(value: unknown): string[] {
  const entries = typeof value === "string"
    ? [value]
    : Array.isArray(value)
    ? value
    : (() => {
        const record = value && typeof value === "object" && !Array.isArray(value)
          ? value as Record<string, unknown>
          : {};
        return Array.isArray(record.list)
          ? record.list
          : Array.isArray(record.history)
            ? record.history
            : Array.isArray(record.data) ? record.data : [];
      })();
  return entries
    .map((item) => {
      if (typeof item === "string") return item;
      if (item && typeof item === "object") {
        const record = item as Record<string, unknown>;
        for (const key of ["name", "keyword", "word", "text", "value", "search_word", "search_key"]) {
          if (typeof record[key] === "string") return record[key] as string;
        }
        return "";
      }
      return "";
    })
    .map((item) => item.trim())
    .filter(Boolean)
    .filter((item, index, items) => items.indexOf(item) === index)
    .slice(0, 10);
}

function searchUserLevel(user: SearchUser): string {
  return user.level || "";
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
  if (/too (?:large|big)|过大|太大|exceed|limit/i.test(message)) {
    return "图片过大，建议使用下载图片";
  }
  if (/decode|decoded|解码|format|格式/i.test(message)) {
    return "这张图片暂时无法复制，建议使用下载图片";
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
    topic: "小黑盒",
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
  if (post.kind === "article") return <span className="kind-badge"><ArticleIcon />文章</span>;
  if (post.media.length > 1) return <span className="kind-badge"><ImageIcon />{post.media.length} 图</span>;
  return null;
}

function PostCard({ post, coverRatio, eager, revealDelay, likeLoading, onLike, onOpen }: {
  post: FeedPost;
  coverRatio?: number;
  eager?: boolean;
  revealDelay?: number;
  likeLoading: boolean;
  onLike: () => void;
  onOpen: () => void;
}) {
  const cover = mediaCover(post);

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
      <div
        className="feed-card__cover"
        style={{ aspectRatio: mediaRatio(post, coverRatio) }}
      >
        {cover ? (
          <img
            src={cover}
            alt=""
            loading={eager ? "eager" : "lazy"}
            decoding="async"
            referrerPolicy="no-referrer"
          />
        ) : (
          <GeneratedTextCover title={post.title} />
        )}
        <KindBadge post={post} />
        {post.topic && <span className="topic-chip">{post.topic}</span>}
        <div className="cover-wash" />
      </div>

      <div className="feed-card__body">
        <h3><HeyboxText value={post.title} emojiSize={18} preserveLineBreaks={false} /></h3>
        {post.kind === "article" && post.excerpt && <p><HeyboxText value={post.excerpt} emojiSize={16} /></p>}
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
            ) : <span className="author__fallback">盒</span>}
            <span className="author__name">{post.author}</span>
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
      </div>
    </article>
  );
}

function SearchFilterPopover({
  filters,
  selection,
  selectedKinds,
  showKindFilter,
  onChange,
  onToggleKind,
  onSelectAllKinds
}: {
  filters: SearchFilters;
  selection: SearchFilterSelection;
  selectedKinds: Set<PostKind>;
  showKindFilter: boolean;
  onChange: (selection: SearchFilterSelection) => void;
  onToggleKind: (kind: PostKind) => void;
  onSelectAllKinds: () => void;
}) {
  const [open, setOpen] = useState(false);
  const filterRef = useRef<HTMLDivElement>(null);
  const groups: Array<{ key: keyof SearchFilterSelection; label: string; options: SearchFilterOption[] }> = [
    { key: "sort", label: "排序方式", options: filters.sortFilterList },
    { key: "timeRange", label: "时间范围", options: filters.timeRangeList },
    { key: "filter", label: "内容筛选", options: filters.filterList }
  ];
  const hasServerFilters = groups.some((group) => group.options.length > 0);
  const hasSortOrTimeFilters = filters.sortFilterList.length > 0 || filters.timeRangeList.length > 0;

  useEffect(() => {
    if (!open) return;
    const closeOnPointerDown = (event: PointerEvent) => {
      if (!filterRef.current || !event.composedPath().includes(filterRef.current)) setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", closeOnPointerDown);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnPointerDown);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  return (
    <div className="search-filter" ref={filterRef}>
      <button
        className="search-filter__trigger"
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        <FilterIcon />
        <span>筛选</span>
      </button>

      {open && (
        <div className="search-filter__popover" role="dialog" aria-label="搜索筛选">
          <div className="search-filter__heading">
            <div>
              <strong>筛选内容</strong>
              <span>{showKindFilter ? "内容类型即时生效，官方筛选会重新请求" : "用户搜索筛选"}</span>
            </div>
          </div>
          {showKindFilter && (
            <section className="search-filter__group search-filter__group--kinds">
              <div className="search-filter__group-title">
                <h3>内容类型</h3>
                <button type="button" onClick={onSelectAllKinds}>全选</button>
              </div>
              <div className="search-filter__kind-options">
                {KIND_FILTER_OPTIONS.map(({ key, label, icon: Icon }) => {
                  const selected = selectedKinds.has(key);
                  return (
                    <button
                      className={selected ? "is-active" : ""}
                      type="button"
                      key={key}
                      aria-pressed={selected}
                      onClick={() => onToggleKind(key)}
                    >
                      <Icon />
                      <span>{label}</span>
                      <i aria-hidden="true" />
                    </button>
                  );
                })}
              </div>
            </section>
          )}
          {hasServerFilters && (
            <div className="search-filter__server-heading">
              <h3>{hasSortOrTimeFilters ? "排序与时间" : "官方筛选"}</h3>
              <button type="button" onClick={() => onChange(EMPTY_SEARCH_FILTER_SELECTION)}>重置</button>
            </div>
          )}
          {groups.map((group) => group.options.length > 0 && (
            <section className="search-filter__group" key={group.key}>
              <h3>{group.label}</h3>
              <div className="search-filter__options">
                {group.options.map((option) => {
                  const selected = selection[group.key] === option.value
                    || (!selection[group.key]
                      && option.selected !== false
                      && (option.selected === true || option.value === "" || (group.key === "sort" && option.value === "default")));
                  return (
                    <button
                      className={selected ? "is-active" : ""}
                      type="button"
                      key={option.id}
                      aria-pressed={selected}
                      onClick={() => onChange({ ...selection, [group.key]: option.value })}
                    >
                      {option.name}
                    </button>
                  );
                })}
              </div>
            </section>
          ))}
          {!showKindFilter && groups.every((group) => group.options.length === 0) && (
            <p className="search-filter__empty">用户搜索暂时没有可用的官方筛选项</p>
          )}
        </div>
      )}
    </div>
  );
}

function SearchUserCard({
  user,
  followLoading,
  reveal,
  onToggleFollow
}: {
  user: SearchUser;
  followLoading: boolean;
  reveal: boolean;
  onToggleFollow: () => void;
}) {
  const visibleMedals = user.medals.slice(0, 3);
  return (
    <article className={`search-user-card${reveal ? " search-user-card--reveal" : ""}`}>
      <div className="search-user-card__avatar">
        {user.avatar ? (
          <img src={user.avatar} alt="" loading="lazy" decoding="async" referrerPolicy="no-referrer" />
        ) : <span>盒</span>}
      </div>
      <div className="search-user-card__body">
        <div className="search-user-card__name-row">
          <strong>{user.username}</strong>
          {searchUserLevel(user) && <span className="search-user-card__level">{searchUserLevel(user)}</span>}
        </div>
        {user.recTag && <p>{user.recTag}</p>}
        {visibleMedals.length > 0 && (
          <div className="search-user-card__medals" aria-label="用户勋章">
            {visibleMedals.map((medal) => (
              <span key={`${medal.id ?? medal.name}-${medal.name}`} title={medal.description || medal.name}>
                {medal.imageUrl ? <img src={medal.imageUrl} alt="" loading="lazy" referrerPolicy="no-referrer" /> : null}
                {medal.name}
              </span>
            ))}
          </div>
        )}
      </div>
      <div className="search-user-card__aside">
        <span className="search-user-card__id">ID {user.id}</span>
        <button
          className={`post-byline__follow${user.isFollowing ? " is-following" : ""}`.trim()}
          type="button"
          aria-pressed={Boolean(user.isFollowing)}
          aria-busy={followLoading}
          disabled={followLoading}
          onClick={(event) => {
            event.stopPropagation();
            onToggleFollow();
          }}
        >
          {followLoading
            ? <span className="post-byline__follow-spinner" aria-hidden="true" />
            : user.isFollowing
              ? "已关注"
              : <><b aria-hidden="true">＋</b>关注</>}
        </button>
      </div>
    </article>
  );
}

function SearchResultPanel({
  result,
  searchType,
  loading,
  error,
  likeLoadingIds,
  followLoadingIds,
  filterSelection,
  selectedKinds,
  masonryColumnCount,
  coverRatios,
  revealIds,
  onTypeChange,
  onFilterChange,
  onToggleKind,
  onSelectAllKinds,
  onToggleUserFollow,
  onRetry,
  onLike,
  onOpen
}: {
  result?: SearchResult;
  searchType: SearchType;
  loading: boolean;
  error?: string;
  likeLoadingIds: Set<string>;
  followLoadingIds: Set<string>;
  filterSelection: SearchFilterSelection;
  selectedKinds: Set<PostKind>;
  masonryColumnCount: number;
  coverRatios: Map<string, number>;
  revealIds: Set<string>;
  onTypeChange: (type: SearchType) => void;
  onFilterChange: (selection: SearchFilterSelection) => void;
  onToggleKind: (kind: PostKind) => void;
  onSelectAllKinds: () => void;
  onToggleUserFollow: (user: SearchUser) => void;
  onRetry: () => void;
  onLike: (post: FeedPost) => void;
  onOpen: (post: FeedPost) => void;
}) {
  const posts = searchType === "general"
    ? (result?.posts ?? []).filter((post) => selectedKinds.has(post.kind))
    : [];
  const users = result?.users ?? [];
  const masonryColumns = useMemo(
    () => distributeFeedPosts(posts, masonryColumnCount, coverRatios),
    [coverRatios, masonryColumnCount, posts]
  );
  const hasItems = searchType === "general" ? posts.length > 0 : users.length > 0;
  const searchRevealDelay = (post: FeedPost): number | undefined => {
    if (!revealIds.has("post:" + post.id)) return undefined;
    const index = posts.indexOf(post);
    return posts
      .slice(0, index)
      .filter((item) => revealIds.has("post:" + item.id))
      .length * FEED_REVEAL_STAGGER_MS;
  };
  return (
    <section className="search-results" aria-label="搜索结果" aria-busy={loading}>
      <div className="search-toolbar">
        <div className="community-list search-type-list" role="tablist" aria-label="搜索范围">
          {SEARCH_TYPES.map((tab) => (
            <button
              key={tab.value}
              className={searchType === tab.value ? "active" : ""}
              type="button"
              role="tab"
              aria-selected={searchType === tab.value}
              onClick={() => onTypeChange(tab.value)}
            >
              {tab.label}
            </button>
          ))}
        </div>
        <SearchFilterPopover
          filters={result?.filters ?? { filterList: [], sortFilterList: [], timeRangeList: [] }}
          selection={filterSelection}
          selectedKinds={selectedKinds}
          showKindFilter={searchType === "general"}
          onChange={onFilterChange}
          onToggleKind={onToggleKind}
          onSelectAllKinds={onSelectAllKinds}
        />
      </div>

      {error && (
        <div className="feed-notice is-error search-results__notice">
          <div><strong>搜索暂时失败</strong><span>{error}</span></div>
          <button type="button" onClick={onRetry}>重试</button>
        </div>
      )}

      {loading && !result ? (
        <div className="search-results__loading"><i /><span>正在搜索</span></div>
      ) : hasItems ? searchType === "general" ? (
        <section
          className="masonry-feed search-masonry-feed"
          aria-live="polite"
          aria-busy={loading}
          style={{ gridTemplateColumns: `repeat(${masonryColumnCount}, minmax(0, 1fr))` }}
        >
          {masonryColumns.map((columnPosts, columnIndex) => (
            <div className="masonry-column" key={`search-column-${columnIndex}`}>
              {columnPosts.map((post, rowIndex) => (
                <PostCard
                  key={post.id}
                  post={post}
                  coverRatio={coverRatios.get(post.id)}
                  eager={rowIndex < 2}
                  revealDelay={searchRevealDelay(post)}
                  likeLoading={likeLoadingIds.has(post.id)}
                  onLike={() => onLike(post)}
                  onOpen={() => onOpen(post)}
                />
              ))}
            </div>
          ))}
        </section>
      ) : (
        <div className="search-user-list">
          {users.map((user) => (
            <SearchUserCard
              key={user.id}
              user={user}
              followLoading={followLoadingIds.has(user.id)}
              reveal={revealIds.has(`user:${user.id}`)}
              onToggleFollow={() => onToggleUserFollow(user)}
            />
          ))}
        </div>
      ) : loading ? (
        <div className="search-results__loading search-results__loading--small"><i /><span>正在更新筛选结果</span></div>
      ) : !error ? (
        <div className="search-results__empty">
          <span>⌕</span>
          <h2>没有找到相关{searchType === "general" ? "内容" : "用户"}</h2>
          <p>试试更短的关键词，或换一个筛选条件。</p>
        </div>
      ) : null}

    </section>
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
      aria-label="小黑盒"
      title="HeyNote 小黑书"
    >
      <HeyboxLogo className="brand__logo" />
    </div>
  );
}

function ModeSwitcher({ compact = false }: { compact?: boolean }) {
  return (
    <section className={`mode-switcher${compact ? " mode-switcher--compact" : ""}`} aria-label="页面显示模式">
      {!compact && <span className="mode-switcher__label">浏览页面</span>}
      <div className="mode-switcher__control" role="group" aria-label="在原版论坛和小黑书之间切换">
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
          title="当前正在使用小黑书"
        >
          小黑书
        </button>
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

type SearchRoute = {
  query: string;
  searchType: SearchType;
  selection: SearchFilterSelection;
};

function parseSearchRoute(): SearchRoute | null {
  if (!location.hash.startsWith("#/search")) return null;
  const queryStart = location.hash.indexOf("?");
  const params = new URLSearchParams(queryStart >= 0 ? location.hash.slice(queryStart + 1) : "");
  const query = (params.get("q") ?? "").trim();
  if (!query) return null;
  return {
    query,
    searchType: params.get("type") === "user" ? "user" : "general",
    selection: {
      filter: params.get("filter") ?? "",
      sort: params.get("sort") ?? "",
      timeRange: params.get("time") ?? ""
    }
  };
}

function searchRouteHash(query: string, searchType: SearchType, selection: SearchFilterSelection): string {
  const params = new URLSearchParams({ q: query, type: searchType });
  if (selection.filter) params.set("filter", selection.filter);
  if (selection.sort) params.set("sort", selection.sort);
  if (selection.timeRange) params.set("time", selection.timeRange);
  return `#/search?${params.toString()}`;
}

function feedRouteHash(): string {
  return "#/feed";
}

export function App({ demoPosts, demoDetails = {}, demoCommunities = [] }: AppProps) {
  const isDemo = Boolean(demoPosts);
  const initialSearchRoute = parseSearchRoute();
  const [posts, setPosts] = useState<FeedPost[]>(demoPosts ?? []);
  const [view, setView] = useState<ViewMode>("discover");
  const [communities, setCommunities] = useState<Community[]>(demoCommunities);
  const [selectedCommunityId, setSelectedCommunityId] = useState<string | null>(null);
  const [selectedKinds, setSelectedKinds] = useState<Set<PostKind>>(() => new Set(ALL_POST_KINDS));
  const [themePreference, setThemePreference] = useState<ThemePreference>(readLocalThemePreference);
  const [systemDark, setSystemDark] = useState(prefersDarkColorScheme);
  const [filterOpen, setFilterOpen] = useState(false);
  const [searchInput, setSearchInput] = useState(initialSearchRoute?.query ?? "");
  const [searchQuery, setSearchQuery] = useState(initialSearchRoute?.query ?? "");
  const [searchType, setSearchType] = useState<SearchType>(initialSearchRoute?.searchType ?? "general");
  const [searchResult, setSearchResult] = useState<SearchResult>();
  const [searchFilterSelection, setSearchFilterSelection] = useState<SearchFilterSelection>(initialSearchRoute?.selection ?? EMPTY_SEARCH_FILTER_SELECTION);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState<string>();
  const [searchHistory, setSearchHistory] = useState<string[]>([]);
  const [searchFound, setSearchFound] = useState<string[]>([]);
  const [searchSuggestions, setSearchSuggestions] = useState<SearchSuggestion[]>([]);
  const [searchSuggestionLoading, setSearchSuggestionLoading] = useState(false);
  const [searchLandingLoading, setSearchLandingLoading] = useState(false);
  const [searchLandingError, setSearchLandingError] = useState<string>();
  const [searchRevealIds, setSearchRevealIds] = useState<Set<string>>(new Set());
  const [searchFollowLoadingIds, setSearchFollowLoadingIds] = useState<Set<string>>(new Set());
  const [searchFocused, setSearchFocused] = useState(false);
  const [communityError, setCommunityError] = useState<string>();
  const [favorites, setFavorites] = useState<Set<string>>(new Set());
  const [initialLoading, setInitialLoading] = useState(!isDemo);
  const [loadingMore, setLoadingMore] = useState(false);
  const [feedError, setFeedError] = useState<string>();
  const [hasMore, setHasMore] = useState(!isDemo);
  const [nextOffset, setNextOffset] = useState(FEED_STEP);
  const [lastValue, setLastValue] = useState("");
  const [hotOrder, setHotOrder] = useState<string[]>([]);
  const [masonryColumnCount, setMasonryColumnCount] = useState(() => feedColumnCount(
    typeof window === "undefined" ? 1200 : window.innerWidth
  ));
  const [feedRevealDelays, setFeedRevealDelays] = useState<Map<string, number>>(() => new Map());
  const [selectedPost, setSelectedPost] = useState<FeedPost>();
  const [detail, setDetail] = useState<PostDetail>();
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string>();
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
  const themePreferenceTouched = useRef(false);
  const feedScrollRef = useRef<HTMLDivElement>(null);
  const searchBoxRef = useRef<HTMLFormElement>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const communityListRef = useRef<HTMLDivElement>(null);
  const kindFilterRef = useRef<HTMLDivElement>(null);
  const loadingRef = useRef(false);
  const loadingGenerationRef = useRef<number | null>(null);
  const feedGenerationRef = useRef(0);
  const requestedOffsetsRef = useRef<Set<string>>(new Set());
  const selectedIdRef = useRef<string | undefined>(undefined);
  const likingPostIdsRef = useRef<Set<string>>(new Set());
  const postLikeOverridesRef = useRef<Map<string, boolean>>(new Map());
  const commentRequestRef = useRef<string | undefined>(undefined);
  const replyRequestKeysRef = useRef<Map<string, string>>(new Map());
  const imageNoticeTimerRef = useRef<number | null>(null);
  const feedRevealTimerRef = useRef<number | null>(null);
  const searchRevealTimerRef = useRef<number | null>(null);
  const feedCoverRatiosRef = useRef<Map<string, number>>(new Map());
  const searchCoverRatiosRef = useRef<Map<string, number>>(new Map());
  const feedPostIdsRef = useRef<Set<string>>(new Set((demoPosts ?? []).map((post) => post.id)));
  const searchGenerationRef = useRef(0);
  const suggestionGenerationRef = useRef(0);
  const searchLandingRequestedRef = useRef(false);
  const searchUserFollowIdsRef = useRef<Set<string>>(new Set());
  const searchResultIdsRef = useRef<Set<string>>(new Set());
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

  const stageSearchReveal = useCallback((result: SearchResult, replace = false) => {
    if (searchRevealTimerRef.current !== null) window.clearTimeout(searchRevealTimerRef.current);
    if (replace) searchResultIdsRef.current.clear();
    const additions = [
      ...result.posts.map((post) => `post:${post.id}`),
      ...result.users.map((user) => `user:${user.id}`)
    ].filter((id) => {
      if (searchResultIdsRef.current.has(id)) return false;
      searchResultIdsRef.current.add(id);
      return true;
    });
    setSearchRevealIds(new Set(additions));
    searchRevealTimerRef.current = window.setTimeout(() => {
      setSearchRevealIds(new Set());
      searchRevealTimerRef.current = null;
    }, FEED_REVEAL_DURATION_MS + Math.max(0, additions.length - 1) * FEED_REVEAL_STAGGER_MS + 80);
  }, []);

  useEffect(() => () => {
    if (imageNoticeTimerRef.current !== null) window.clearTimeout(imageNoticeTimerRef.current);
    if (feedRevealTimerRef.current !== null) window.clearTimeout(feedRevealTimerRef.current);
    if (searchRevealTimerRef.current !== null) window.clearTimeout(searchRevealTimerRef.current);
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

  useEffect(() => {
    let cancelled = false;
    const restore = (value: unknown) => {
      if (!cancelled) setSearchHistory(readSearchHistory(value));
    };
    try {
      const raw = window.localStorage.getItem(SEARCH_HISTORY_KEY);
      if (!raw) {
        restore([]);
      } else {
        try {
          restore(JSON.parse(raw));
        } catch {
          restore(raw);
        }
      }
    } catch {
      restore([]);
    }
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!searchFocused) return;
    const closeOnPointerDown = (event: PointerEvent) => {
      const node = searchBoxRef.current;
      if (!node || !event.composedPath().includes(node)) setSearchFocused(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setSearchFocused(false);
    };
    document.addEventListener("pointerdown", closeOnPointerDown);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnPointerDown);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [searchFocused]);

  useEffect(() => {
    if (!searchFocused || searchLandingRequestedRef.current) return;
    searchLandingRequestedRef.current = true;
    let cancelled = false;
    setSearchLandingLoading(true);
    setSearchLandingError(undefined);
    Promise.allSettled([fetchSearchWelcomePage(), fetchSearchFound()]).then(([welcome, found]) => {
      if (cancelled) return;
      const foundNames = found.status === "fulfilled" && found.value.length > 0
        ? found.value
        : welcome.status === "fulfilled" ? welcome.value.map((item) => item.text) : [];
      setSearchFound(foundNames);
      if (found.status === "rejected" && welcome.status === "rejected") {
        setSearchLandingError("官方搜索发现暂时不可用");
      }
      setSearchLandingLoading(false);
    });
    return () => { cancelled = true; };
  }, [searchFocused]);

  useEffect(() => {
    const query = searchInput.trim();
    suggestionGenerationRef.current += 1;
    const generation = suggestionGenerationRef.current;
    if (!searchFocused || searchQuery || !query) {
      setSearchSuggestions([]);
      setSearchSuggestionLoading(false);
      return;
    }
    setSearchSuggestionLoading(true);
    const timer = window.setTimeout(() => {
      void fetchSearchSuggestions(query).then((suggestions) => {
        if (suggestionGenerationRef.current === generation) {
          setSearchSuggestions(suggestions);
          setSearchSuggestionLoading(false);
        }
      }).catch(() => {
        if (suggestionGenerationRef.current === generation) {
          setSearchSuggestions([]);
          setSearchSuggestionLoading(false);
        }
      });
    }, 260);
    return () => window.clearTimeout(timer);
  }, [searchFocused, searchInput, searchQuery]);

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

  function rememberSearch(query: string) {
    const normalized = query.trim();
    if (!normalized) return;
    setSearchHistory((current) => {
      const next = [normalized, ...current.filter((item) => item !== normalized)].slice(0, 10);
      try {
        window.localStorage.setItem(SEARCH_HISTORY_KEY, JSON.stringify(next));
      } catch {
        // Keep the in-memory history when storage is unavailable.
      }
      return next;
    });
  }

  const clearSearchHistory = useCallback(() => {
    setSearchHistory([]);
    try {
      window.localStorage.removeItem(SEARCH_HISTORY_KEY);
    } catch {
      // Keep the visible history cleared when storage is unavailable.
    }
  }, []);

  function currentSearchWidth(): number {
    return Math.max(320, Math.round(feedScrollRef.current?.clientWidth || window.innerWidth));
  }

  const clearSearch = useCallback((syncUrl = true) => {
    searchGenerationRef.current += 1;
    suggestionGenerationRef.current += 1;
    searchResultIdsRef.current.clear();
    searchCoverRatiosRef.current.clear();
    setSearchInput("");
    setSearchQuery("");
    setSearchResult(undefined);
    setSearchFilterSelection(EMPTY_SEARCH_FILTER_SELECTION);
    setSearchError(undefined);
    setSearchSuggestions([]);
    setSearchRevealIds(new Set());
    setSearchLoading(false);
    setSearchFocused(false);
    if (syncUrl && location.hash !== feedRouteHash()) {
      history.replaceState({
        ...(history.state ?? {}),
        xiaoheishuDetail: false,
        xiaoheishuSearch: false
      }, "", feedRouteHash());
    }
    feedScrollRef.current?.scrollTo({ top: 0, behavior: "auto" });
  }, []);

  const clearSearchInput = useCallback(() => {
    suggestionGenerationRef.current += 1;
    setSearchInput("");
    setSearchSuggestions([]);
    setSearchSuggestionLoading(false);
  }, []);

  const handleSearchInputChange = useCallback((value: string) => {
    setSearchInput(value);
    setSearchFocused(true);
    if (!searchQuery) return;
    searchGenerationRef.current += 1;
    searchResultIdsRef.current.clear();
    searchCoverRatiosRef.current.clear();
    setSearchQuery("");
    setSearchResult(undefined);
    setSearchFilterSelection(EMPTY_SEARCH_FILTER_SELECTION);
    setSearchError(undefined);
    setSearchLoading(false);
    if (location.hash !== feedRouteHash()) {
      history.replaceState({
        ...(history.state ?? {}),
        xiaoheishuDetail: false,
        xiaoheishuSearch: false
      }, "", feedRouteHash());
    }
  }, [searchQuery]);

  const runSearch = useCallback(async (
    rawQuery: string,
    requestedType: SearchType = searchType,
    requestedSelection?: SearchFilterSelection,
    syncUrl = true
  ) => {
    const query = rawQuery.trim();
    if (!query) return;
    const sameSearch = query === searchQuery && requestedType === searchType;
    const selection = requestedSelection ?? (sameSearch ? searchFilterSelection : EMPTY_SEARCH_FILTER_SELECTION);
    const generation = searchGenerationRef.current + 1;
    searchGenerationRef.current = generation;
    if (!sameSearch) {
      searchResultIdsRef.current.clear();
      searchCoverRatiosRef.current.clear();
    }
    setSearchInput(query);
    setSearchQuery(query);
    setSearchType(requestedType);
    setSearchFilterSelection(selection);
    if (!sameSearch) setSearchResult(undefined);
    setSearchError(undefined);
    setSearchSuggestions([]);
    setSearchLoading(true);
    setSearchFocused(false);
    rememberSearch(query);
    if (syncUrl) {
      const nextHash = searchRouteHash(query, requestedType, selection);
      const nextState = {
        ...(history.state ?? {}),
        xiaoheishuDetail: false,
        xiaoheishuSearch: true
      };
      if (sameSearch) history.replaceState(nextState, "", nextHash);
      else history.pushState(nextState, "", nextHash);
    }
    feedScrollRef.current?.scrollTo({ top: 0, behavior: "auto" });
    try {
      const result = await fetchSearchPage(
        query,
        requestedType,
        0,
        currentSearchWidth(),
        selection
      );
      if (searchGenerationRef.current !== generation) return;
      const coverRatios = requestedType === "general"
        ? await preloadFeedCoverRatios(result.posts, () => searchGenerationRef.current === generation)
        : new Map<string, number>();
      if (searchGenerationRef.current !== generation) return;
      coverRatios.forEach((ratio, postId) => searchCoverRatiosRef.current.set(postId, ratio));
      setSearchResult(result);
      stageSearchReveal(result, true);
    } catch (error) {
      if (searchGenerationRef.current !== generation) return;
      setSearchError(error instanceof Error ? error.message : "搜索请求失败");
    } finally {
      if (searchGenerationRef.current === generation) setSearchLoading(false);
    }
  }, [searchFilterSelection, searchQuery, searchType, stageSearchReveal]);

  useEffect(() => {
    const route = parseSearchRoute();
    if (route) void runSearch(route.query, route.searchType, route.selection, false);
  }, []);

  const loadMoreSearch = useCallback(async () => {
    if (
      !searchResult?.hasMore
      || searchLoading
      || !searchQuery
      || (searchType === "general" && selectedKinds.size === 0)
    ) return;
    const generation = searchGenerationRef.current;
    setSearchLoading(true);
    try {
      const next = await fetchSearchPage(
        searchQuery,
        searchType,
        searchResult.nextOffset,
        currentSearchWidth(),
        searchFilterSelection
      );
      if (searchGenerationRef.current !== generation) return;
      const coverRatios = searchType === "general"
        ? await preloadFeedCoverRatios(next.posts, () => searchGenerationRef.current === generation)
        : new Map<string, number>();
      if (searchGenerationRef.current !== generation) return;
      coverRatios.forEach((ratio, postId) => searchCoverRatiosRef.current.set(postId, ratio));
      setSearchResult((current) => {
        if (!current) return next;
        return {
          ...current,
          posts: mergePosts(current.posts, next.posts),
          users: [...current.users, ...next.users.filter((user) => !current.users.some((item) => item.id === user.id))],
          filters: next.filters.filterList.length || next.filters.sortFilterList.length || next.filters.timeRangeList.length
            ? next.filters
            : current.filters,
          hasMore: next.hasMore,
          nextOffset: next.nextOffset
        };
      });
      stageSearchReveal(next);
      setSearchError(undefined);
    } catch (error) {
      if (searchGenerationRef.current === generation) {
        setSearchError(error instanceof Error ? error.message : "搜索下一页加载失败");
      }
    } finally {
      if (searchGenerationRef.current === generation) setSearchLoading(false);
    }
  }, [searchFilterSelection, searchLoading, searchQuery, searchResult, searchType, selectedKinds.size, stageSearchReveal]);

  useEffect(() => {
    const activeButton = Array.from(communityListRef.current?.querySelectorAll<HTMLButtonElement>("button[data-community-id]") ?? [])
      .find((button) => button.dataset.communityId === (selectedCommunityId ?? "all"));
    activeButton?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [communities, selectedCommunityId]);

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
        ? outcome.error instanceof Error ? outcome.error.message : "后续内容预加载失败，请稍后重试"
        : undefined);
    } catch (error) {
      if (feedGenerationRef.current !== generation) return;
      if (!initialPageVisible) {
        setPosts([]);
        setHasMore(false);
        setFeedError(error instanceof Error ? error.message : "暂时无法读取小黑盒信息流");
      } else {
        setFeedError(error instanceof Error ? error.message : "后续内容预加载失败，请稍后重试");
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
  }, [clearSearch, loadInitial]);

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
        ? outcome.error instanceof Error ? outcome.error.message : "下一页加载失败，请稍后重试"
        : undefined);
    } catch (error) {
      if (feedGenerationRef.current !== generation) return;
      requestedOffsetsRef.current.delete(requestKey);
      setFeedError(error instanceof Error ? error.message : "下一页加载失败，请稍后重试");
    } finally {
      if (loadingGenerationRef.current === generation) {
        loadingGenerationRef.current = null;
        loadingRef.current = false;
        setLoadingMore(false);
      }
    }
  }, [hasMore, initialLoading, isDemo, lastValue, nextOffset, selectedCommunityId, selectedKinds.size, stageFeedReveal]);

  useEffect(() => {
    const target = sentinelRef.current;
    const root = feedScrollRef.current;
    if (!target || !root || isDemo) return;
    const loadNext = () => {
      if (searchQuery) void loadMoreSearch();
      else void loadMore();
    };
    const observer = new IntersectionObserver((entries) => {
      if (entries[0]?.isIntersecting) loadNext();
    }, { root, rootMargin: "300px 0px", threshold: 0.01 });
    observer.observe(target);
    let checkFrame = 0;
    const checkDistance = () => {
      checkFrame = 0;
      const columns = Array.from(root.querySelectorAll<HTMLElement>(".masonry-column"));
      if (!columns.length) {
        if (root.scrollHeight - root.scrollTop - root.clientHeight < 320) loadNext();
        return;
      }
      const viewportBottom = root.getBoundingClientRect().bottom;
      const shortestColumnBottom = Math.min(...columns.map((column) => column.getBoundingClientRect().bottom));
      if (shortestColumnBottom - viewportBottom <= root.clientHeight * 1.5) loadNext();
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
  }, [isDemo, loadMore, loadMoreSearch, searchQuery]);

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

  const visiblePosts = useMemo(() => {
    const result = posts.filter((post) => {
      if (view === "saved" && !favorites.has(post.id)) return false;
      if (!selectedKinds.has(post.kind)) return false;
      return true;
    });
    if (view !== "hot") return result;

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
  }, [favorites, hotOrder, posts, selectedKinds, view]);

  const masonryColumns = useMemo(() => {
    return distributeFeedPosts(visiblePosts, masonryColumnCount, feedCoverRatiosRef.current);
  }, [masonryColumnCount, visiblePosts]);

  function selectCommunity(communityId: string | null) {
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

  const loadDetail = useCallback(async (post: FeedPost, navigate = true) => {
    selectedIdRef.current = post.id;
    setSelectedPost(post);
    setDetail(undefined);
    setDetailError(undefined);
    setDetailLoading(true);
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
      if (!nextDetail) throw new Error("这个样稿帖子还没有详情数据");
      if (selectedIdRef.current !== post.id) return;
      const localLikeState = postLikeOverridesRef.current.get(post.id);
      setDetail(localLikeState === undefined ? nextDetail : {
        ...nextDetail,
        post: withPostLikeState(nextDetail.post, localLikeState)
      });
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
  }, [demoDetails, isDemo]);

  useEffect(() => {
    if (!location.hash) history.replaceState(history.state, "", "#/feed");
    const resetDetailState = () => {
      selectedIdRef.current = undefined;
      setSelectedPost(undefined);
      setDetail(undefined);
      setDetailError(undefined);
      setFollowLoading(false);
      setPostActionLoading(undefined);
      setFavoritePickerOpen(false);
      setFavoriteFolders([]);
      setLikingCommentIds(new Set());
      replyRequestKeysRef.current.clear();
      setLoadingReplyIds(new Set());
    };
    const onPopState = () => {
      const searchRoute = parseSearchRoute();
      if (searchRoute) {
        resetDetailState();
        const sameSearch = searchRoute.query === searchQuery
          && searchRoute.searchType === searchType
          && searchRoute.selection.filter === searchFilterSelection.filter
          && searchRoute.selection.sort === searchFilterSelection.sort
          && searchRoute.selection.timeRange === searchFilterSelection.timeRange;
        if (!sameSearch) void runSearch(searchRoute.query, searchRoute.searchType, searchRoute.selection, false);
        return;
      }
      const route = parseHashRoute();
      if (!route) {
        resetDetailState();
        if (searchQuery) clearSearch(false);
        return;
      }
      if (route.id === selectedIdRef.current) return;
      const post = posts.find((item) => item.id === route.id) ?? placeholderPost(route.id);
      void loadDetail(post, false);
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, [clearSearch, loadDetail, posts, runSearch, searchFilterSelection, searchQuery, searchType]);

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

  async function toggleSelectedAuthorFollow() {
    if (!detail || followLoading) return;
    const linkId = detail.post.id;
    const followingId = detail.post.authorId;
    const nextFollowing = !Boolean(detail.post.isFollowing);

    if (!isDemo && !followingId) {
      showImageActionNotice("这个帖子没有返回作者 ID，暂时无法关注", true);
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
      showImageActionNotice(nextFollowing ? `已关注 ${detail.post.author}` : `已取消关注 ${detail.post.author}`);
    } catch (error) {
      if (selectedIdRef.current === linkId) {
        showImageActionNotice(error instanceof Error ? error.message : "关注状态更新失败", true);
      }
    } finally {
      if (selectedIdRef.current === linkId) setFollowLoading(false);
    }
  }

  async function toggleSearchUserFollow(user: SearchUser) {
    const userId = user.id;
    if (searchUserFollowIdsRef.current.has(userId)) return;
    const nextFollowing = !Boolean(user.isFollowing);
    searchUserFollowIdsRef.current.add(userId);
    setSearchFollowLoadingIds((current) => new Set(current).add(userId));
    const updateFollowing = (following: boolean) => {
      setSearchResult((current) => current
        ? { ...current, users: current.users.map((item) => item.id === userId ? { ...item, isFollowing: following } : item) }
        : current);
      setPosts((current) => current.map((post) => post.authorId === userId ? { ...post, isFollowing: following } : post));
      setDetail((current) => current?.post.authorId === userId ? { ...current, post: { ...current.post, isFollowing: following } } : current);
      setSelectedPost((current) => current?.authorId === userId ? { ...current, isFollowing: following } : current);
    };

    updateFollowing(nextFollowing);
    try {
      if (!isDemo) await setSearchUserFollowing(userId, nextFollowing);
      showImageActionNotice(nextFollowing ? `已关注 ${user.username}` : `已取消关注 ${user.username}`);
    } catch (error) {
      updateFollowing(!nextFollowing);
      showImageActionNotice(error instanceof Error ? error.message : "关注状态更新失败", true);
    } finally {
      searchUserFollowIdsRef.current.delete(userId);
      setSearchFollowLoadingIds((current) => {
        const next = new Set(current);
        next.delete(userId);
        return next;
      });
    }
  }

  function updatePostAcrossViews(linkId: string, updater: (post: FeedPost) => FeedPost) {
    setDetail((current) => current?.post.id === linkId ? { ...current, post: updater(current.post) } : current);
    setSelectedPost((current) => current?.id === linkId ? updater(current) : current);
    setPosts((current) => current.map((post) => post.id === linkId ? updater(post) : post));
    setSearchResult((current) => current
      ? { ...current, posts: current.posts.map((post) => post.id === linkId ? updater(post) : post) }
      : current);
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
        showImageActionNotice(nextLiked ? "已点赞" : "已取消点赞");
      }
    } catch (error) {
      postLikeOverridesRef.current.delete(linkId);
      applyPostLikeState(linkId, previousLiked);
      if (!selectedIdRef.current || selectedIdRef.current === linkId) {
        showImageActionNotice(error instanceof Error ? error.message : "点赞状态更新失败", true);
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
          showImageActionNotice(error instanceof Error ? error.message : "收藏夹加载失败", true);
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
      if (selectedIdRef.current === linkId) showImageActionNotice(nextFavorited ? "已收藏" : "已取消收藏");
    } catch (error) {
      updatePostAcrossViews(linkId, rollback);
      if (selectedIdRef.current === linkId) {
        showImageActionNotice(error instanceof Error ? error.message : "收藏状态更新失败", true);
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
        showImageActionNotice(error instanceof Error ? error.message : "评论点赞状态更新失败", true);
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
        setDetailError(error instanceof Error ? error.message : "子回复加载失败");
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

          <nav className="side-nav" aria-label="信息流导航">
            <button
              className="active"
              aria-current="page"
              onClick={refreshDiscover}
            ><CompassIcon /><span>发现</span></button>
          </nav>

          <div className="sidebar__bottom">
            <section className="sidebar-settings" aria-label="小黑书设置">
              <ThemeSwitcher preference={themePreference} onChange={selectThemePreference} />
              <ModeSwitcher />
            </section>
          </div>
        </aside>

        <main className="main-panel">
          <header className="topbar">
            <BrandWordmark compact />
            <form
              className={`search-box${searchFocused ? " is-focused" : ""}`}
              ref={searchBoxRef}
              role="search"
              onSubmit={(event) => {
                event.preventDefault();
                void runSearch(searchInput, searchType);
              }}
            >
              <SearchIcon />
              <input
                value={searchInput}
                aria-label="搜索内容或用户"
                placeholder="搜索内容或用户"
                onFocus={() => setSearchFocused(true)}
                onChange={(event) => handleSearchInputChange(event.target.value)}
              />
              {searchInput && (
                <button
                  className="search-box__clear"
                  type="button"
                  aria-label="清空搜索"
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => {
                    if (searchQuery) clearSearchInput();
                    else setSearchInput("");
                  }}
                >
                  ×
                </button>
              )}
              {searchFocused && !searchQuery && (
                <div className="search-popover" role="listbox" aria-label={searchInput.trim() ? "搜索联想" : "搜索入口"}>
                  {searchInput.trim() ? (
                    <>
                      <div className="search-suggestion-list">
                        {searchSuggestions.map((suggestion) => (
                          <button
                            key={suggestion.id}
                            type="button"
                            onMouseDown={(event) => event.preventDefault()}
                            onClick={() => void runSearch(suggestion.text, searchType)}
                          >
                            <span>{suggestion.text}</span>
                          </button>
                        ))}
                      </div>
                      {searchSuggestionLoading && searchSuggestions.length === 0 && (
                        <div className="search-popover__status"><i />正在获取联想词</div>
                      )}
                      {!searchSuggestionLoading && searchSuggestions.length === 0 && (
                        <div className="search-popover__status">按 Enter 搜索“{searchInput.trim()}”</div>
                      )}
                    </>
                  ) : (
                    <>
                      {searchHistory.length > 0 && (
                        <section className="search-popover__section">
                          <div className="search-popover__heading search-history__heading">
                            <strong>历史记录</strong>
                            <button
                              className="search-history__clear"
                              type="button"
                              aria-label="清空历史记录"
                              onMouseDown={(event) => event.preventDefault()}
                              onClick={clearSearchHistory}
                            >
                              <TrashIcon />
                            </button>
                          </div>
                          <div className="search-popover__items">
                            {searchHistory.map((item) => (
                              <button
                                key={item}
                                type="button"
                                onMouseDown={(event) => event.preventDefault()}
                                onClick={() => void runSearch(item, searchType)}
                              >
                                {item}
                              </button>
                            ))}
                          </div>
                        </section>
                      )}
                      <section className="search-popover__section search-popover__section--found">
                        <div className="search-popover__heading"><strong>猜你想搜</strong></div>
                        {searchFound.length > 0 ? (
                          <div className="search-guess-list">
                            {searchFound.map((item) => (
                              <button
                                key={item}
                                type="button"
                                onMouseDown={(event) => event.preventDefault()}
                                onClick={() => void runSearch(item, searchType)}
                              >
                                <span>{item}</span>
                              </button>
                            ))}
                          </div>
                        ) : searchLandingLoading ? (
                          <div className="search-popover__status"><i />正在加载官方发现</div>
                        ) : (
                          <div className="search-popover__status">暂时没有官方发现</div>
                        )}
                      </section>
                      {searchLandingError && <p className="search-popover__error">{searchLandingError}</p>}
                    </>
                  )}
                </div>
              )}
            </form>
            <div className="top-actions">
              <button type="button" onClick={refreshDiscover} disabled={initialLoading || isDemo} title="刷新信息流"><RefreshIcon className={initialLoading ? "spin" : ""} /></button>
              <button type="button" onClick={requestOriginalMode} title="切换到原版论坛"><ExternalIcon /></button>
            </div>
          </header>

          <div className="feed-scroll" ref={feedScrollRef}>
            {searchQuery ? (
              <SearchResultPanel
                result={searchResult}
                searchType={searchType}
                loading={searchLoading}
                error={searchError}
                likeLoadingIds={likingPostIds}
                followLoadingIds={searchFollowLoadingIds}
                filterSelection={searchFilterSelection}
                selectedKinds={selectedKinds}
                masonryColumnCount={masonryColumnCount}
                coverRatios={searchCoverRatiosRef.current}
                revealIds={searchRevealIds}
                onTypeChange={(type) => {
                  void runSearch(searchQuery, type);
                }}
                onFilterChange={(selection) => void runSearch(searchQuery, searchType, selection)}
                onToggleKind={toggleKind}
                onSelectAllKinds={selectAllKinds}
                onToggleUserFollow={(user) => void toggleSearchUserFollow(user)}
                onRetry={() => void runSearch(searchQuery, searchType)}
                onLike={(post) => void togglePostLike(post)}
                onOpen={(post) => void loadDetail(post)}
              />
            ) : <>
            <div className="community-toolbar">
              <div
                className="community-list"
                ref={communityListRef}
                aria-label="社区信息流"
                aria-busy={!isDemo && communities.length === 0 && !communityError}
              >
                <button
                  type="button"
                  data-community-id="all"
                  className={selectedCommunityId === null ? "active" : ""}
                  aria-pressed={selectedCommunityId === null}
                  onClick={() => selectCommunity(null)}
                >
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
                  <div className="feed-kind-filter__popover" role="dialog" aria-label="筛选内容类型">
                    <div className="feed-kind-filter__heading">
                      <strong>内容类型</strong>
                      <button type="button" onClick={selectAllKinds}>全选</button>
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

            {feedError && (
              <div className="feed-notice is-error">
                <div><strong>{posts.length ? "下一页暂时没有加载成功" : "没有拿到信息流"}</strong><span>{feedError}</span></div>
                <button type="button" onClick={() => void (posts.length ? loadMore() : loadInitial())}>{posts.length ? "重试本页" : "重新连接"}</button>
              </div>
            )}

            {initialLoading ? <FeedSkeleton columns={masonryColumnCount} /> : visiblePosts.length ? (
              <section
                className="masonry-feed"
                aria-live="polite"
                aria-busy={loadingMore}
                style={{ gridTemplateColumns: `repeat(${masonryColumnCount}, minmax(0, 1fr))` }}
              >
                {masonryColumns.map((columnPosts, columnIndex) => (
                  <div className="masonry-column" key={`column-${columnIndex}`}>
                    {columnPosts.map((post, rowIndex) => (
                      <PostCard
                        key={post.id}
                        post={post}
                        coverRatio={feedCoverRatiosRef.current.get(post.id)}
                        eager={rowIndex < 2}
                        revealDelay={feedRevealDelays.get(post.id)}
                        likeLoading={likingPostIds.has(post.id)}
                        onLike={() => void togglePostLike(post)}
                        onOpen={() => void loadDetail(post)}
                      />
                    ))}
                  </div>
                ))}
              </section>
            ) : !feedError ? (
              <section className="empty-state">
                <span>空</span>
                <h2>{view === "saved" ? "还没有收藏帖子" : "这里暂时没有内容"}</h2>
                <p>{view === "saved"
              ? "在帖子详情里点收藏，帖子就会留在这里。"
                  : selectedKinds.size === 0
                    ? "当前三个内容类型都已取消勾选。"
                    : "换一个社区或内容类型试试。"}</p>
                <button type="button" onClick={resetFeedSelection}>{selectedKinds.size === 0 ? "显示全部类型" : "回到推荐"}</button>
              </section>
            ) : null}
            </>}

            <div className="feed-sentinel" ref={sentinelRef}>
              {searchQuery
                ? searchLoading && searchResult && <><i /><span>正在加载下一页</span></>
                : loadingMore && <><i /><span>正在加载下一页</span></>}
              {searchQuery
                ? searchResult && !searchResult.hasMore && <span>已经看到这一批内容的末尾</span>
                : !hasMore && posts.length > 0 && <span>已经看到这一批内容的末尾</span>}
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
        />
      )}

      {imageContextMenu && (
        <ImageContextMenu
          state={imageContextMenu}
          onClose={closeImageContextMenu}
          onCopy={(target) => {
            void copyImageAction(target).then(() => {
              showImageActionNotice("图片已复制");
            }).catch((error) => {
              showImageActionNotice(imageActionError(error, "图片复制失败"), true);
            });
          }}
          onDownload={(target) => {
            void downloadImageAction(target).then(() => {
              showImageActionNotice("已开始下载");
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
