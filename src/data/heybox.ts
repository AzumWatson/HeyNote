import type {
  CommentContentPart,
  CommentItem,
  CommentRepliesResult,
  CommentsResult,
  Community,
  ContentBlock,
  FavoriteFolder,
  FeedPost,
  FeedResult,
  HeyboxApiRequest,
  HeyboxApiResponse,
  ImageMedia,
  PostDetail,
  PostContentTag,
  PostKind,
  PostMedia,
  ProfilePageResult,
  SearchFilterOption,
  SearchFilterSelection,
  SearchFilters,
  SearchMedal,
  SearchResult,
  SearchSuggestion,
  SearchType,
  SearchUser,
  UserProfile,
  UserProfileStats,
  VideoMedia
} from "../types";
import { heyboxEmojiFromCode, heyboxEmojiFromId } from "./heybox-emoji";

const PAGE_STEP = 30;
const COMMUNITY_INITIAL_STEP = 10;
const COMMUNITY_PAGE_STEP = 30;
const COMMENT_LIMIT = 20;
const IMAGE_TEXT_LINK_TAGS = new Set([26, 27, 28]);
type UnknownRecord = Record<string, unknown>;

function asRecord(value: unknown): UnknownRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? value as UnknownRecord : {};
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function firstNonEmptyArray(...values: unknown[]): unknown[] {
  for (const value of values) {
    if (Array.isArray(value) && value.length > 0) return value;
  }
  return [];
}

function asText(...values: unknown[]): string {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
  }
  return "";
}

function asNumber(...values: unknown[]): number {
  for (const value of values) {
    if (value == null || value === "" || typeof value === "boolean") continue;
    const number = typeof value === "number" ? value : Number(value);
    if (Number.isFinite(number)) return number;
  }
  return 0;
}

function hasFieldValue(value: unknown): boolean {
  return value != null && value !== "";
}

function isEnabledFlag(value: unknown): boolean {
  return value === true || asNumber(value) === 1;
}

function optionalNumber(...values: unknown[]): number | undefined {
  for (const value of values) {
    const number = typeof value === "number" ? value : Number(value);
    if (Number.isFinite(number) && number > 0) return number;
  }
  return undefined;
}

function remoteUrl(value: unknown): string | undefined {
  if (typeof value === "string") {
    const candidate = value.trim();
    if (/^https?:\/\//i.test(candidate)) return candidate;
    if (/^\/\//.test(candidate)) return `https:${candidate}`;
  }
  const item = asRecord(value);
  const candidate = asText(item.url, item.src, item.img_url, item.image_url, item.image_new, item.thumb);
  if (/^https?:\/\//i.test(candidate)) return candidate;
  return /^\/\//.test(candidate) ? `https:${candidate}` : undefined;
}

function explicitOriginalUrl(value: unknown): string | undefined {
  const item = asRecord(value);
  return remoteUrl(item.original_url)
    || remoteUrl(item.original)
    || remoteUrl(item.origin_url)
    || remoteUrl(item.raw_url)
    || remoteUrl(item.large_url)
    || remoteUrl(item.source_url);
}

function explicitThumbnailUrl(value: unknown): string | undefined {
  const item = asRecord(value);
  return remoteUrl(item.thumbnail)
    || remoteUrl(item.thumbnail_url)
    || remoteUrl(item.thumb)
    || remoteUrl(item.thumb_url)
    || remoteUrl(item.small_url)
    || remoteUrl(item.preview_url)
    || remoteUrl(item.image_thumb);
}

function looksLikeThumbnailUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return /(?:^|\/)thumb(?:\.[a-z0-9]+)?$/i.test(url.pathname)
      || /(?:^|[_./-])thumb(?:nail)?(?:[_./-]|$)/i.test(url.pathname)
      || /(?:^|[?&])imageMogr2(?:[=/&]|$)/i.test(url.search);
  } catch {
    return false;
  }
}

function stripHtml(value: string): string {
  if (!value.includes("<")) return value.trim();
  if (typeof DOMParser !== "undefined") {
    return new DOMParser().parseFromString(value, "text/html").body.textContent?.trim() ?? "";
  }
  return value.replace(/<br\s*\/?\s*>/gi, "\n").replace(/<[^>]+>/g, "").trim();
}

function formatDate(value: unknown): string | undefined {
  if (typeof value === "string" && value.trim() && !/^\d+$/.test(value.trim())) return value.trim();
  const raw = Number(value);
  if (!Number.isFinite(raw) || raw <= 0) return undefined;
  const date = new Date(raw < 1e12 ? raw * 1000 : raw);
  if (Number.isNaN(date.getTime())) return undefined;
  return new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "short", day: "numeric" }).format(date);
}

function durationToSeconds(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) return value;
  if (typeof value !== "string" || !value.trim()) return undefined;
  const parts = value.split(":").map(Number);
  if (!parts.length || parts.some((part) => !Number.isFinite(part))) return undefined;
  return parts.reduce((total, part) => total * 60 + part, 0);
}

function firstRecord(value: unknown): UnknownRecord {
  if (Array.isArray(value)) return asRecord(value[0]);
  return asRecord(value);
}

function topicFrom(item: UnknownRecord): UnknownRecord {
  for (const value of [item.topics, item.topic, item.topic_info, item.category]) {
    const candidate = firstRecord(value);
    if (Object.keys(candidate).length > 0) return candidate;
  }
  return {};
}

function levelFrom(user: UnknownRecord, item: UnknownRecord): string | undefined {
  const levelInfo = asRecord(user.level_info);
  const level = asText(levelInfo.level, user.level, item.level);
  if (!level) return undefined;
  return /^Lv\./i.test(level) ? level : `Lv.${level}`;
}

function contentTagColor(value: unknown): string | undefined {
  const raw = asText(value).trim();
  if (!raw) return undefined;
  const segments = raw.match(/#[^#]+/g);
  let color = segments?.[0] ?? (raw.startsWith("#") ? raw : `#${raw}`);
  if (!/^#[0-9a-f]{3,4}$/i.test(color) && !/^#[0-9a-f]{6}([0-9a-f]{2})?$/i.test(color)) return undefined;
  // Xiaoheihe sends eight-digit colors as #AARRGGBB; CSS expects #RRGGBBAA.
  if (color.length === 9) color = `#${color.slice(3)}${color.slice(1, 3)}`;
  return color;
}

function contentTagIcon(value: unknown): string | undefined {
  const direct = remoteUrl(value);
  if (direct || typeof value !== "string") return direct;
  try {
    return remoteUrl(JSON.parse(value) as unknown);
  } catch {
    return undefined;
  }
}

function parseContentTags(value: unknown, legacyHashtags = false): PostContentTag[] {
  const entries = asArray(value);
  if (!entries.length) return [];

  const tags: PostContentTag[] = [];
  const seen = new Set<string>();
  entries.forEach((value) => {
    const item = asRecord(value);
    const rawName = asText(
      item.text,
      item.name,
      item.tag_name,
      item.hashtag_name,
      typeof value === "string" ? value : undefined
    ).trim();
    const name = legacyHashtags && rawName && !rawName.startsWith("#") ? `# ${rawName}` : rawName;
    if (!name) return;
    const tagId = optionalNumber(item.content_tag_id, item.tag_id, item.hashtag_id, item.id);
    const rawAlign = asText(item.align);
    const align = rawAlign === "top" || rawAlign === "bottom" ? rawAlign : undefined;
    const rawStyleType = asNumber(item.style_type);
    const styleType: 0 | 1 | 2 = rawStyleType === 1 || rawStyleType === 2 ? rawStyleType : 0;
    const backgroundColor = contentTagColor(item.bg_color);
    const textColor = contentTagColor(item.text_color);
    const iconUrl = contentTagIcon(item.icon);
    const rawSubLabel = asRecord(item.sublabel ?? item.sub_label);
    const subLabelTitle = asText(rawSubLabel.sub_title, rawSubLabel.title);
    const subLabel = subLabelTitle ? {
      title: subLabelTitle,
      startColor: contentTagColor(rawSubLabel.start_color),
      endColor: contentTagColor(rawSubLabel.end_color)
    } : undefined;
    const signature = [
      tagId ?? "",
      name.toLocaleLowerCase("zh-CN"),
      align ?? "",
      styleType,
      backgroundColor ?? "",
      textColor ?? "",
      iconUrl ?? "",
      subLabel?.title ?? ""
    ].join("\u0000");
    if (seen.has(signature)) return;
    seen.add(signature);
    tags.push({ name, tagId, align, styleType, backgroundColor, textColor, iconUrl, subLabel });
  });

  return tags;
}

function contentTagsFrom(item: UnknownRecord, fallback?: PostContentTag[]): PostContentTag[] {
  const contentTags = parseContentTags(item.content_tags);
  if (contentTags.length) return contentTags;
  const legacyHashtags = parseContentTags(item.hashtags, true);
  return legacyHashtags.length ? legacyHashtags : fallback ? [...fallback] : [];
}

function collectImageMedia(item: UnknownRecord): ImageMedia[] {
  const full = firstNonEmptyArray(item.imgs, item.images, item.pic_list, item.image_list);
  const thumbs = firstNonEmptyArray(item.thumbs, item.thumbnails);
  const positions = asArray(item.positions);
  const media: ImageMedia[] = full.flatMap((value, index): ImageMedia[] => {
    const fallbackUrl = remoteUrl(value);
    const originalUrl = explicitOriginalUrl(value);
    const url = originalUrl || fallbackUrl;
    if (!url) return [];
    const source = asRecord(value);
    const position = asRecord(positions[index]);
    const explicitThumbnail = remoteUrl(thumbs[index]) || explicitThumbnailUrl(source);
    return [{
      kind: "image" as const,
      url,
      thumbnail: explicitThumbnail
        || (originalUrl && fallbackUrl && fallbackUrl !== originalUrl ? fallbackUrl : undefined)
        || (looksLikeThumbnailUrl(url) ? url : undefined),
      width: optionalNumber(source.width, position.width),
      height: optionalNumber(source.height, position.height)
    }];
  });

  if (!media.length) {
    const cover = remoteUrl(item.video_thumb) || remoteUrl(item.cover) || remoteUrl(item.thumb) || remoteUrl(item.image);
    if (cover) media.push({ kind: "image", url: cover, thumbnail: looksLikeThumbnailUrl(cover) ? cover : undefined });
  }

  const seen = new Set<string>();
  return media.filter((entry) => !seen.has(entry.url) && Boolean(seen.add(entry.url)));
}

function videoMediaFrom(item: UnknownRecord, fallback?: VideoMedia): VideoMedia | undefined {
  const info = asRecord(item.video_info);
  const url = remoteUrl(info.url) || remoteUrl(item.video_url) || fallback?.url;
  const poster = remoteUrl(info.thumb)
    || remoteUrl(item.video_thumb)
    || remoteUrl(item.cover)
    || remoteUrl(item.thumb)
    || remoteUrl(item.image)
    || fallback?.poster;
  if (!url || !poster) return undefined;
  const durationLabel = asText(info.duration, item.duration) || fallback?.durationLabel;
  return {
    kind: "video",
    url,
    poster,
    width: optionalNumber(info.width, item.video_width, fallback?.width),
    height: optionalNumber(info.height, item.video_height, fallback?.height),
    duration: durationToSeconds(durationLabel) ?? fallback?.duration,
    durationLabel
  };
}

function postKind(item: UnknownRecord, fallback?: FeedPost): PostKind {
  const conceptType = item.use_concept_type;
  const hasExplicitConceptType = hasFieldValue(conceptType);
  // Xiaoheihe's detail route chooses the image-text renderer first.
  if (isEnabledFlag(conceptType)) return "image";

  const videoUrl = remoteUrl(item.video_url) || remoteUrl(asRecord(item.video_info).url);
  const hasVideoFlag = isEnabledFlag(item.has_video);
  const hasExplicitVideoFlag = hasFieldValue(item.has_video);
  const hasVideo = hasVideoFlag
    || Boolean(videoUrl)
    || (!hasExplicitConceptType && !hasExplicitVideoFlag && fallback?.kind === "video");
  if (hasVideo) return "video";

  // An explicit non-image concept type is an article. link_tag is only a
  // compatibility fallback for feed/legacy payloads that omit this field.
  if (hasExplicitConceptType) return "article";
  if (hasFieldValue(item.link_tag)) {
    return IMAGE_TEXT_LINK_TAGS.has(asNumber(item.link_tag)) ? "image" : "article";
  }
  if (fallback && !(fallback.kind === "video" && hasExplicitVideoFlag)) return fallback.kind;
  return IMAGE_TEXT_LINK_TAGS.has(asNumber(fallback?.linkTag)) ? "image" : "article";
}

function mapFeedPost(value: unknown, fallback?: FeedPost): FeedPost | null {
  const item = asRecord(value);
  const id = asText(item.linkid, item.link_id, item.id, fallback?.id);
  if (!id) return null;

  const user = asRecord(item.user ?? item.user_info ?? item.author);
  const topic = topicFrom(item);
  const kind = postKind(item, fallback);
  const fallbackVideo = fallback?.media.find((media): media is VideoMedia => media.kind === "video");
  const video = kind === "video" ? videoMediaFrom(item, fallbackVideo) : undefined;
  const imageMedia = collectImageMedia(item);
  const media: PostMedia[] = video ? [video] : imageMedia.length ? imageMedia : fallback?.media ?? [];
  const description = asText(item.description, item.summary, item.excerpt, fallback?.excerpt);
  const title = asText(item.title, item.link_title, item.subject, item.name, fallback?.title) || description.slice(0, 52);
  if (!title && !description) return null;
  const rawFollowStatus = hasFieldValue(item.follow_status)
    ? item.follow_status
    : hasFieldValue(user.follow_status) ? user.follow_status : undefined;
  const rawLiked = hasFieldValue(item.is_award_link) ? item.is_award_link : undefined;
  const rawFavorited = hasFieldValue(item.is_favour) ? item.is_favour : undefined;

  return {
    id,
    href: asText(item.share_url, fallback?.href) || `https://www.xiaoheihe.cn/app/bbs/link/${id}`,
    title,
    excerpt: description,
    author: asText(user.username, user.nickname, user.name, item.username, fallback?.author) || "盒友",
    authorId: asText(item.userid, user.userid, user.heybox_id, fallback?.authorId) || undefined,
    avatar: remoteUrl(user.avatar) || remoteUrl(item.avatar) || fallback?.avatar,
    level: levelFrom(user, item) || fallback?.level,
    isFollowing: hasFieldValue(rawFollowStatus) ? asNumber(rawFollowStatus) === 1 : fallback?.isFollowing,
    topic: asText(topic.name, item.topic_name, item.category_name, fallback?.topic) || "盒友杂谈",
    topicIcon: remoteUrl(topic.small_pic_url) || remoteUrl(topic.pic_url) || remoteUrl(topic.icon) || fallback?.topicIcon,
    contentTags: contentTagsFrom(item, fallback?.contentTags),
    media,
    kind,
    likes: asNumber(item.link_award_num, item.like_num, item.likes, item.thumb_up_num, fallback?.likes),
    isLiked: rawLiked === undefined ? fallback?.isLiked : asNumber(rawLiked) === 1,
    favorites: asNumber(item.favour_count, item.favorite_count, fallback?.favorites),
    isFavorited: rawFavorited === undefined ? fallback?.isFavorited : asNumber(rawFavorited) === 1,
    comments: asNumber(item.comment_num, item.comments, item.reply_num, fallback?.comments),
    linkTag: asNumber(item.link_tag, fallback?.linkTag),
    hasVideo: kind === "video",
    createdAt: formatDate(item.create_at) || fallback?.createdAt,
    ipLocation: asText(item.ip_location, fallback?.ipLocation) || undefined
  };
}

function parseContentBlocks(value: unknown, firstHtmlIsCompleteDocument = false): ContentBlock[] {
  if (value == null || value === "") return [];
  let entries: unknown[];
  if (Array.isArray(value)) entries = value;
  else if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value) as unknown;
      entries = Array.isArray(parsed) ? parsed : [parsed];
    } catch {
      const text = value.trim();
      return text
        ? [/<\/?[a-z][\s\S]*>/i.test(text) ? { kind: "html", html: text } : { kind: "text", text }]
        : [];
    }
  } else entries = [value];

  if (firstHtmlIsCompleteDocument) {
    const first = asRecord(entries[0]);
    if (asText(first.type).toLocaleLowerCase() === "html") entries = entries.slice(0, 1);
  }

  const blocks: ContentBlock[] = [];
  entries.forEach((entry) => {
    if (typeof entry === "string") {
      const text = entry.trim();
      if (text) blocks.push(/<\/?[a-z][\s\S]*>/i.test(text) ? { kind: "html", html: text } : { kind: "text", text });
      return;
    }
    const block = asRecord(entry);
    const type = asText(block.type).toLocaleLowerCase();
    if (type === "img" || type === "image") {
      const fallbackUrl = remoteUrl(block.url) || remoteUrl(block.src);
      const originalUrl = explicitOriginalUrl(block);
      const url = originalUrl || fallbackUrl;
      if (url) {
        const explicitThumbnail = explicitThumbnailUrl(block);
        blocks.push({
          kind: "image",
          url,
          thumbnail: explicitThumbnail
            || (originalUrl && fallbackUrl && fallbackUrl !== originalUrl ? fallbackUrl : undefined)
            || (looksLikeThumbnailUrl(url) ? url : undefined),
          width: optionalNumber(block.width),
          height: optionalNumber(block.height)
        });
      }
      return;
    }
    const text = asText(block.text, block.content, block.html);
    if (!text) return;
    if (type === "html" || /<\/?[a-z][\s\S]*>/i.test(text)) blocks.push({ kind: "html", html: text });
    else blocks.push({ kind: "text", text });
  });
  return blocks;
}

/** Mirrors ArticleKit: a leading html block already contains the whole ordered document. */
export function parseArticleContent(value: unknown): ContentBlock[] {
  return parseContentBlocks(value, true);
}

function appendCommentText(parts: CommentContentPart[], value: string): void {
  if (!value) return;
  const previous = parts.at(-1);
  if (previous?.kind === "text") previous.text += value;
  else parts.push({ kind: "text", text: value });
}

function appendCommentTokens(parts: CommentContentPart[], value: string): void {
  const tokenPattern = /\[([^\]_]+)_([^\]_]+)\]/g;
  let cursor = 0;
  let match: RegExpExecArray | null;
  while ((match = tokenPattern.exec(value))) {
    const emoji = heyboxEmojiFromCode(`${match[1]}_${match[2]}`);
    if (!emoji) continue;
    appendCommentText(parts, value.slice(cursor, match.index));
    parts.push(emoji);
    cursor = match.index + match[0].length;
  }
  appendCommentText(parts, value.slice(cursor));
}

function trimCommentParts(parts: CommentContentPart[]): CommentContentPart[] {
  const normalized = parts.map((part) => part.kind === "text"
    ? { ...part, text: part.text.replace(/\n{3,}/g, "\n\n") }
    : part);
  const firstText = normalized.find((part) => part.kind === "text");
  if (firstText?.kind === "text") firstText.text = firstText.text.trimStart();
  for (let index = normalized.length - 1; index >= 0; index -= 1) {
    const lastText = normalized[index];
    if (lastText.kind !== "text") continue;
    lastText.text = lastText.text.trimEnd();
    break;
  }
  return normalized.filter((part) => part.kind !== "text" || Boolean(part.text));
}

export function parseCommentContent(value: string): CommentContentPart[] {
  const source = value.trim();
  if (!source) return [];

  if (typeof DOMParser === "undefined") {
    const withTokens = source
      .replace(/<span\b[^>]*\bdata-emoji=["']([^"']+)["'][^>]*>[\s\S]*?<\/span>/gi, "[$1]")
      .replace(/<span\b[^>]*\bclass=["'][^"']*\bhb-emoji-([a-z0-9-]+)_([0-9]+)\b[^"']*["'][^>]*>[\s\S]*?<\/span>/gi, (_match, group: string, id: string) => {
        const emoji = heyboxEmojiFromId(group, id);
        return emoji ? `[${emoji.code}]` : "";
      });
    const parts: CommentContentPart[] = [];
    appendCommentTokens(parts, stripHtml(withTokens));
    return trimCommentParts(parts);
  }

  const parts: CommentContentPart[] = [];
  const body = new DOMParser().parseFromString(source, "text/html").body;
  const blockTags = new Set(["BLOCKQUOTE", "DIV", "LI", "OL", "P", "PRE", "UL"]);
  const appendBreak = () => {
    if (!parts.length) return;
    const previous = parts.at(-1);
    if (previous?.kind === "text" && previous.text.endsWith("\n")) return;
    appendCommentText(parts, "\n");
  };

  const walk = (node: globalThis.Node): void => {
    if (node.nodeType === 3) {
      appendCommentTokens(parts, node.nodeValue ?? "");
      return;
    }
    if (!(node instanceof Element)) return;

    const dataEmoji = node.getAttribute("data-emoji");
    const dataEmojiPart = dataEmoji ? heyboxEmojiFromCode(dataEmoji) : undefined;
    if (dataEmojiPart) {
      parts.push(dataEmojiPart);
      return;
    }

    const classEmoji = (node.getAttribute("class") ?? "").match(/(?:^|\s)hb-emoji-([a-z0-9-]+)_([0-9]+)(?:\s|$)/i);
    const classEmojiPart = classEmoji ? heyboxEmojiFromId(classEmoji[1], classEmoji[2]) : undefined;
    if (classEmojiPart) {
      parts.push(classEmojiPart);
      return;
    }

    if (node.tagName === "BR") {
      appendBreak();
      return;
    }
    const isBlock = blockTags.has(node.tagName);
    if (isBlock) appendBreak();
    Array.from(node.childNodes).forEach(walk);
    if (isBlock) appendBreak();
  };

  Array.from(body.childNodes).forEach(walk);
  return trimCommentParts(parts);
}

function plainCommentText(parts: CommentContentPart[]): string {
  return parts.map((part) => part.kind === "text" ? part.text : `[${part.code}]`).join("").trim();
}

function commentImageEntries(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (typeof value === "string") {
    const source = value.trim();
    if (!source) return [];
    if (source.startsWith("[") || source.startsWith("{")) {
      try {
        const parsed = JSON.parse(source) as unknown;
        if (Array.isArray(parsed)) return parsed;
        if (parsed && typeof parsed === "object") return [parsed];
      } catch {
        // The official create-comment request uses semicolon-delimited URLs.
      }
    }
    return source.split(";").map((entry) => entry.trim()).filter(Boolean);
  }
  if (value && typeof value === "object") {
    const record = asRecord(value);
    const nested = firstNonEmptyArray(record.items, record.list, record.imgs, record.images);
    return nested.length ? nested : [value];
  }
  return [];
}

function commentImageFrom(value: unknown): ImageMedia | null {
  const source = asRecord(value);
  const fallbackUrl = remoteUrl(value);
  const originalUrl = explicitOriginalUrl(value);
  const url = originalUrl || fallbackUrl;
  if (!url) return null;
  return {
    kind: "image",
    url,
    thumbnail: explicitThumbnailUrl(source)
      || (originalUrl && fallbackUrl && originalUrl !== fallbackUrl ? fallbackUrl : undefined)
      || (looksLikeThumbnailUrl(url) ? url : undefined),
    width: optionalNumber(source.width, source.w, source.image_width),
    height: optionalNumber(source.height, source.h, source.image_height)
  };
}

function commentInlineImages(value: string): ImageMedia[] {
  if (!/<img\b/i.test(value)) return [];

  if (typeof DOMParser === "undefined") {
    return (value.match(/<img\b[^>]*>/gi) ?? []).flatMap((tag): ImageMedia[] => {
      if (/\bdata-emoji\s*=|\bhb-emoji(?:-|\s|["'])/i.test(tag)) return [];
      let thumbnail: string | undefined;
      for (const attribute of ["data-thumbnail", "data-thumb", "src"]) {
        const match = tag.match(new RegExp(`(?:^|[\\s<])${attribute}\\s*=\\s*["']([^"']+)["']`, "i"));
        thumbnail = remoteUrl(match?.[1]);
        if (thumbnail) break;
      }
      let original: string | undefined;
      for (const attribute of ["data-full-src", "data-original", "data-url", "data-src"]) {
        const match = tag.match(new RegExp(`(?:^|[\\s<])${attribute}\\s*=\\s*["']([^"']+)["']`, "i"));
        original = remoteUrl(match?.[1]);
        if (original) break;
      }
      const url = original || thumbnail;
      if (!url) return [];
      return [{
        kind: "image",
        url,
        thumbnail: thumbnail && thumbnail !== url ? thumbnail : looksLikeThumbnailUrl(url) ? url : undefined,
        width: optionalNumber(tag.match(/\b(?:data-width|width)\s*=\s*["']?(\d+)/i)?.[1]),
        height: optionalNumber(tag.match(/\b(?:data-height|height)\s*=\s*["']?(\d+)/i)?.[1])
      }];
    });
  }

  const body = new DOMParser().parseFromString(value, "text/html").body;
  return Array.from(body.querySelectorAll("img")).flatMap((image): ImageMedia[] => {
    if (image.hasAttribute("data-emoji") || image.className.split(/\s+/).some((name) => name.startsWith("hb-emoji"))) {
      return [];
    }
    let thumbnail: string | undefined;
    for (const attribute of ["data-thumbnail", "data-thumb", "src"]) {
      thumbnail = remoteUrl(image.getAttribute(attribute));
      if (thumbnail) break;
    }
    let original: string | undefined;
    for (const attribute of ["data-full-src", "data-original", "data-url", "data-src"]) {
      original = remoteUrl(image.getAttribute(attribute));
      if (original) break;
    }
    const url = original || thumbnail;
    if (!url) return [];
    return [{
      kind: "image",
      url,
      thumbnail: thumbnail && thumbnail !== url ? thumbnail : looksLikeThumbnailUrl(url) ? url : undefined,
      width: optionalNumber(image.getAttribute("data-width"), image.getAttribute("width")),
      height: optionalNumber(image.getAttribute("data-height"), image.getAttribute("height"))
    }];
  });
}

function commentImagesFrom(item: UnknownRecord, rawText: string): ImageMedia[] {
  const attachments = [item.imgs, item.images, item.pic_list, item.image_list, item.pics]
    .flatMap(commentImageEntries)
    .map(commentImageFrom)
    .filter((image): image is ImageMedia => Boolean(image));
  const images = [...attachments, ...commentInlineImages(rawText)];
  const seen = new Set<string>();
  return images.filter((image) => !seen.has(image.url) && Boolean(seen.add(image.url)));
}

export function parseCommentImages(value: unknown, rawText = ""): ImageMedia[] {
  return commentImagesFrom(asRecord(value), rawText);
}

function mergeCommentItems(current: CommentItem[], incoming: CommentItem[]): CommentItem[] {
  const merged = [...current];
  const known = new Set(current.map((comment) => comment.id));
  incoming.forEach((comment) => {
    if (known.has(comment.id)) return;
    known.add(comment.id);
    merged.push(comment);
  });
  return merged;
}

function mapComment(value: unknown, fallbackId = ""): CommentItem | null {
  const item = asRecord(value);
  const user = asRecord(item.user ?? item.user_info ?? item.author);
  const replyUser = asRecord(item.replyuser ?? item.reply_user);
  const id = asText(item.commentid, item.comment_id, item.id, fallbackId);
  const rawText = asText(item.text, item.comment_text, item.content, item.description);
  const content = parseCommentContent(rawText);
  const images = parseCommentImages(item, rawText);
  if (!id || (!content.length && !images.length)) return null;
  const nested = asArray(item.replies ?? item.children ?? item.sub_comments)
    .map((reply, index) => mapComment(reply, `${id}-${index}`))
    .filter((reply): reply is CommentItem => Boolean(reply));
  const replyCount = Math.max(asNumber(item.child_num, item.reply_num, item.reply_count), nested.length);
  return {
    id,
    author: asText(user.username, user.nickname, user.name, item.username) || "盒友",
    authorId: asText(user.userid, user.user_id, user.heybox_id, user.id, item.userid, item.user_id, item.author_id) || undefined,
    avatar: remoteUrl(user.avatar) || remoteUrl(item.avatar),
    level: levelFrom(user, item),
    text: plainCommentText(content),
    content,
    images,
    replyToCommentId: asText(item.replyid, item.reply_id, item.parent_comment_id) || undefined,
    replyToAuthor: asText(replyUser.username, replyUser.nickname, replyUser.name, item.reply_username) || undefined,
    createdAt: formatDate(item.create_at),
    ipLocation: asText(item.ip_location) || undefined,
    likes: asNumber(item.up, item.support_num, item.like_num),
    isLiked: hasFieldValue(item.is_support) ? asNumber(item.is_support) === 1 : undefined,
    isCy: isEnabledFlag(item.is_cy),
    isAuthorLiked: isEnabledFlag(item.is_author_award),
    replies: nested,
    replyCount,
    hasMoreReplies: asNumber(item.has_more) === 1 && nested.length < replyCount
  };
}

function mapCommentGroups(value: unknown, fallbackPrefix = "p1"): CommentItem[] {
  return asArray(value).flatMap((groupValue, groupIndex) => {
    const group = asRecord(groupValue);
    const rows = asArray(group.comment);
    if (!rows.length) {
      const single = mapComment(groupValue, `${fallbackPrefix}-comment-${groupIndex}`);
      return single ? [single] : [];
    }
    const root = mapComment(rows[0], `${fallbackPrefix}-comment-${groupIndex}`);
    if (!root) return [];
    const inlineReplies = rows.slice(1)
      .map((reply, index) => mapComment(reply, `${root.id}-${index}`))
      .filter((reply): reply is CommentItem => Boolean(reply));
    const replies = mergeCommentItems(root.replies, inlineReplies);
    const replyCount = Math.max(root.replyCount ?? 0, replies.length);
    return [{
      ...root,
      replies,
      replyCount,
      hasMoreReplies: Boolean(root.hasMoreReplies && replies.length < replyCount)
    }];
  });
}

function resultRecord(payload: unknown): UnknownRecord {
  const root = asRecord(payload);
  if (root.status === "show_captcha") {
    throw new Error("小黑盒要求完成安全验证，请先在原版页面完成验证后重试");
  }
  if (root.status === "login" || root.status === "relogin" || root.status === "lack_token") {
    throw new Error("小黑盒登录状态已失效，请先登录后重试");
  }
  if (root.status !== "ok") throw new Error(asText(root.msg) || "小黑盒接口暂时不可用");
  return asRecord(root.result);
}

// Search endpoints have returned both {status:"ok", result:...} and
// {msg:"", result:...} across web versions. Treat an omitted status as success,
// while preserving the same login/captcha protections as the other endpoints.
function searchApiResultRecord(payload: unknown): UnknownRecord {
  const root = asRecord(payload);
  if (root.status === "show_captcha") {
    throw new Error("小黑盒要求完成安全验证，请先在原版页面完成验证后重试");
  }
  if (root.status === "login" || root.status === "relogin" || root.status === "lack_token") {
    throw new Error("小黑盒登录状态已失效，请先登录后重试");
  }
  if (root.status !== undefined && root.status !== "ok") {
    throw new Error(asText(root.msg) || "小黑盒搜索接口暂时不可用");
  }
  return asRecord(root.result);
}

function searchResultRecord(payload: unknown): UnknownRecord {
  const result = searchApiResultRecord(payload);
  if (!Object.keys(result).length) throw new Error("小黑盒搜索接口返回为空");
  return result;
}

async function callBackground(request: HeyboxApiRequest): Promise<unknown> {
  if (typeof chrome === "undefined" || !chrome.runtime?.sendMessage) {
    throw new Error("本地视觉样稿不会请求小黑盒；请安装扩展并从小黑盒页面打开");
  }
  let response: HeyboxApiResponse | undefined;
  try {
    response = await chrome.runtime.sendMessage<HeyboxApiRequest, HeyboxApiResponse>(request);
  } catch (error) {
    throw new Error(error instanceof Error ? error.message : "扩展后台没有响应");
  }
  if (!response) throw new Error("扩展后台没有返回数据，请重新打开 HeyNote 小黑书");
  if (!response.ok) throw new Error(response.error);
  return response.data;
}

const originalImageUrlCache = new Map<string, string>();
const originalImageUrlRequests = new Map<string, Promise<string>>();

function isOfficialImageUrl(value: string): boolean {
  try {
    const url = new URL(value);
    const hostname = url.hostname.toLocaleLowerCase("en-US").replace(/\.$/, "");
    if (url.username || url.password || url.hash) return false;
    if (url.port && url.port !== "80" && url.port !== "443") return false;
    return (url.protocol === "https:" || url.protocol === "http:")
      && (
        hostname === "max-c.com"
        || hostname.endsWith(".max-c.com")
        || hostname === "xiaoheihe.cn"
        || hostname.endsWith(".xiaoheihe.cn")
      );
  } catch {
    return false;
  }
}

function directOriginalImageUrl(value: string): string | undefined {
  try {
    const url = new URL(value);
    if (!/^\?imageMogr2(?:\/|$)/i.test(url.search)) return undefined;
    url.search = "";
    if (looksLikeThumbnailUrl(url.href)) return undefined;
    return url.href;
  } catch {
    return undefined;
  }
}

function originalImageUrlFromPayload(payload: unknown): string | undefined {
  const result = resultRecord(payload);
  const imgs = result.imgs;
  if (Array.isArray(imgs)) {
    for (const image of imgs) {
      const url = remoteUrl(image);
      if (url) return url;
    }
  }
  return remoteUrl(imgs)
    || remoteUrl(result.original_url)
    || remoteUrl(result.url);
}

/** Resolve a Xiaoheihe CDN thumbnail lazily. Valid request failures deliberately keep the thumbnail visible. */
export async function resolveOriginalImageUrl(thumbnailUrl: string): Promise<string> {
  const source = remoteUrl(thumbnailUrl);
  if (!source) throw new Error("图片地址无效");
  if (!isOfficialImageUrl(source)) return source;
  const directOriginal = directOriginalImageUrl(source);
  if (directOriginal) {
    originalImageUrlCache.set(source, directOriginal);
    return directOriginal;
  }

  const cached = originalImageUrlCache.get(source);
  if (cached) return cached;
  const pending = originalImageUrlRequests.get(source);
  if (pending) return pending;

  const request = (async () => {
    try {
      const payload = await callBackground({
        channel: "xiaoheishu-api",
        operation: "originalImage",
        params: { url: source }
      });
      const apiOriginal = originalImageUrlFromPayload(payload);
      const original = apiOriginal || source;
      if (original === source) return source;
      originalImageUrlCache.set(source, original);
      return original;
    } catch {
      return source;
    } finally {
      originalImageUrlRequests.delete(source);
    }
  })();
  originalImageUrlRequests.set(source, request);
  return request;
}

export async function fetchFeedCommunities(): Promise<Community[]> {
  const payload = await callBackground({
    channel: "xiaoheishu-api",
    operation: "feedBanner",
    params: {}
  });
  const result = resultRecord(payload);
  const topicBanner = asRecord(result.topic_banner);
  const entries = [
    ...asArray(topicBanner.top_topics).slice(1),
    ...asArray(topicBanner.subscribed_topics)
  ];
  const seen = new Set<string>();
  return entries.flatMap((value): Community[] => {
    const item = asRecord(value);
    const id = asText(item.topic_id);
    const name = asText(item.name);
    if (!id || !name || seen.has(id)) return [];
    seen.add(id);
    return [{ id, name }];
  });
}

/**
 * Fetch an all-feed page, or an official topic feed when communityId is present.
 * Pass the previous result's lastValue back on the next community request.
 */
export async function fetchFeedPage(
  offset = 0,
  width = 720,
  communityId?: string | null,
  lastValue = ""
): Promise<FeedResult> {
  const safeWidth = Math.max(480, Math.round(width));
  const topicId = communityId?.trim();
  const payload = await callBackground(topicId ? {
    channel: "xiaoheishu-api",
    operation: "communityFeed",
    params: { topicId, offset, width: safeWidth, lastValue }
  } : {
    channel: "xiaoheishu-api",
    operation: "feed",
    params: { offset, width: safeWidth }
  });
  const result = resultRecord(payload);
  const rawLinks = asArray(result.links);
  const links = rawLinks.filter((value) => asNumber(asRecord(value).content_type) !== 18);
  const posts = links.map((value) => mapFeedPost(value)).filter((post): post is FeedPost => Boolean(post));
  if (links.length > 0 && posts.length === 0) {
    throw new Error("小黑盒信息流字段发生了变化，当前页面暂时无法解析");
  }
  const nextLastValue = asText(result.lastval, result.last_val, result.next_lastval) || undefined;
  const pageStep = topicId
    ? offset === 0 ? COMMUNITY_INITIAL_STEP : COMMUNITY_PAGE_STEP
    : PAGE_STEP;
  return {
    posts,
    hasMore: rawLinks.length > 0,
    nextOffset: offset + pageStep,
    ...(nextLastValue ? { lastValue: nextLastValue } : {})
  };
}

function searchTypeValue(value: unknown): SearchType | undefined {
  return value === "general" || value === "user" ? value : undefined;
}

function mapSearchMedal(value: unknown): SearchMedal | null {
  const item = asRecord(value);
  const name = asText(item.name, item.medal_name);
  if (!name) return null;
  const id = optionalNumber(item.id, item.medal_id);
  return {
    ...(id === undefined ? {} : { id }),
    name,
    imageUrl: remoteUrl(item.img_url) || remoteUrl(item.image_url) || remoteUrl(item.icon),
    achieved: hasFieldValue(item.achieved) ? isEnabledFlag(item.achieved) : undefined,
    worn: hasFieldValue(item.wear) ? isEnabledFlag(item.wear) : undefined,
    description: asText(item.description) || undefined
  };
}

function mapSearchUser(value: unknown): SearchUser | null {
  const info = asRecord(value);
  const nestedUser = asRecord(info.user ?? info.user_info);
  const id = asText(info.userid, info.user_id, info.id, nestedUser.userid, nestedUser.user_id, nestedUser.id);
  const username = asText(info.username, info.nickname, info.name, nestedUser.username, nestedUser.nickname, nestedUser.name);
  if (!id || !username) return null;
  const level = levelFrom(info, {}) || levelFrom(nestedUser, info);
  const rawMedals = firstNonEmptyArray(info.medals, info.medal, nestedUser.medals, nestedUser.medal);
  const medals = rawMedals
    .map(mapSearchMedal)
    .filter((medal): medal is SearchMedal => Boolean(medal));
  const followingValue = hasFieldValue(info.is_follow)
    ? info.is_follow
    : hasFieldValue(info.follow_status) ? info.follow_status : nestedUser.is_follow ?? nestedUser.follow_status;
  return {
    id,
    username,
    avatar: remoteUrl(info.avatar) || remoteUrl(info.avartar) || remoteUrl(nestedUser.avatar) || remoteUrl(nestedUser.avartar),
    level: level || undefined,
    recTag: asText(info.rec_tag, nestedUser.rec_tag) || undefined,
    isFollowing: hasFieldValue(followingValue) ? isEnabledFlag(followingValue) : undefined,
    medals
  };
}

function emptyUserProfileStats(): UserProfileStats {
  return {
    following: 0,
    followers: 0,
    likesAndFavorites: 0,
    favorites: 0,
    history: 0,
    posts: 0
  };
}

function mapUserProfile(value: unknown): UserProfile | null {
  const info = asRecord(value);
  const nestedUser = asRecord(info.user ?? info.user_info);
  const bbsInfo = asRecord(info.bbs_info ?? nestedUser.bbs_info);
  const id = asText(
    info.userid,
    info.user_id,
    info.heybox_id,
    nestedUser.userid,
    nestedUser.user_id,
    nestedUser.heybox_id
  );
  const username = asText(
    info.username,
    info.nickname,
    nestedUser.username,
    nestedUser.nickname
  );
  if (!id || !username) return null;

  const rawMedals = firstNonEmptyArray(info.medals, info.medal, nestedUser.medals, nestedUser.medal);
  const medals = rawMedals
    .map(mapSearchMedal)
    .filter((medal): medal is SearchMedal => Boolean(medal));
  const followingValue = hasFieldValue(bbsInfo.follow_status)
    ? bbsInfo.follow_status
    : hasFieldValue(info.follow_status) ? info.follow_status : undefined;
  const stats: UserProfileStats = {
    following: asNumber(bbsInfo.follow_num, info.follow_num, info.following_count),
    followers: asNumber(bbsInfo.fan_num, info.fan_num, info.follower_count),
    likesAndFavorites: asNumber(
      bbsInfo.be_favoured_num,
      info.be_favoured_num,
      bbsInfo.awd_num,
      info.awd_num
    ),
    favorites: asNumber(bbsInfo.favour_num, info.favour_num, info.favorite_count),
    history: asNumber(bbsInfo.visit_num, info.visit_num, info.history_count),
    posts: asNumber(bbsInfo.post_link_num, info.post_link_num, info.post_count)
  };
  return {
    id,
    username,
    avatar: remoteUrl(info.avatar) || remoteUrl(info.avartar) || remoteUrl(nestedUser.avatar) || remoteUrl(nestedUser.avartar),
    level: levelFrom(info, nestedUser) || undefined,
    signature: asText(info.signature, nestedUser.signature) || undefined,
    ipLocation: asText(info.ip_location, nestedUser.ip_location) || undefined,
    isFollowing: hasFieldValue(followingValue) ? isEnabledFlag(followingValue) : undefined,
    medals,
    stats
  };
}

function searchItems(result: UnknownRecord): UnknownRecord[] {
  const items = Array.isArray(result.items)
    ? result.items
    : asRecord(result.items).list ?? asRecord(result.items).items;
  return asArray(items).map(asRecord).filter((item) => Object.keys(item).length > 0);
}

function searchList(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  const item = asRecord(value);
  const nested = item.list ?? item.items ?? item.data;
  if (Array.isArray(nested)) return nested;
  if (asText(item.name, item.title, item.label, item.text, item.keyword, item.word)) return [value];
  return [];
}

function mapSearchFilterOption(value: unknown, group: string, index: number): SearchFilterOption | null {
  const item = asRecord(value);
  const name = asText(item.name, item.title, item.label, item.text, item.desc, value);
  if (!name) return null;
  const explicitKey = typeof item.key === "string"
    ? item.key
    : typeof item.key === "number" && Number.isFinite(item.key) ? String(item.key) : undefined;
  const optionValue = explicitKey ?? (asText(
    item.value,
    item.filter_value,
    item.sort_value,
    item.time_range,
    item.id,
    item.report_id,
    item.code
  ) || (typeof value === "string" ? value : name));
  return {
    id: `${group}-${optionValue || name}-${index}`,
    name,
    value: optionValue,
    selected: hasFieldValue(item.selected)
      ? isEnabledFlag(item.selected)
      : hasFieldValue(item.is_selected)
        ? isEnabledFlag(item.is_selected)
        : hasFieldValue(item.is_select)
          ? isEnabledFlag(item.is_select)
          : hasFieldValue(item.checked) ? isEnabledFlag(item.checked) : undefined
  };
}

function searchFilterNestedItems(value: unknown): unknown[] {
  const item = asRecord(value);
  return firstNonEmptyArray(
    searchList(item.filters),
    searchList(item.options),
    searchList(item.items),
    searchList(item.list),
    searchList(item.data)
  );
}

function searchFilterGroupKey(value: unknown): string {
  const item = asRecord(value);
  return asText(item.key, item.type, item.name, item.desc)
    .toLocaleLowerCase("en-US")
    .replaceAll("-", "_")
    .replaceAll(" ", "_");
}

function searchFilterGroupValues(source: unknown, keys: Set<string>): unknown[] {
  return searchList(source).flatMap((value) => {
    const nested = searchFilterNestedItems(value);
    return nested.length && keys.has(searchFilterGroupKey(value)) ? nested : [];
  });
}

function searchFilterOptionValues(source: unknown, excludedGroups = new Set<string>()): unknown[] {
  return searchList(source).flatMap((value) => {
    const nested = searchFilterNestedItems(value);
    if (!nested.length) return [value];
    return excludedGroups.has(searchFilterGroupKey(value)) ? [] : nested;
  });
}

function mapSearchFilters(result: UnknownRecord): SearchFilters {
  const nestedFilters = asRecord(result.filters ?? result.filter);
  const rawFilterGroups = [
    ...searchList(result.filter_list),
    ...searchList(nestedFilters.filter_list)
  ];
  const sortGroupKeys = new Set(["sort_filter", "sort_type", "sort"]);
  const timeGroupKeys = new Set(["time_range", "time"]);
  const filterOptionValues = searchFilterOptionValues(
    rawFilterGroups,
    new Set([...sortGroupKeys, ...timeGroupKeys])
  );
  const sortOptionValues = [
    ...searchFilterGroupValues(rawFilterGroups, sortGroupKeys),
    ...searchFilterOptionValues(result.sort_filter_list),
    ...searchFilterOptionValues(nestedFilters.sort_filter_list)
  ];
  const timeOptionValues = [
    ...searchFilterGroupValues(rawFilterGroups, timeGroupKeys),
    ...searchFilterOptionValues(result.time_range_list),
    ...searchFilterOptionValues(nestedFilters.time_range_list)
  ];
  const mapOptions = (values: unknown[], group: string): SearchFilterOption[] => values
    .map((value, index) => mapSearchFilterOption(value, group, index))
    .filter((value): value is SearchFilterOption => Boolean(value))
    .filter((value, index, options) => options.findIndex((item) => item.value === value.value) === index);
  const filterList = mapOptions(filterOptionValues, "filter");
  const sortFilterList = mapOptions(sortOptionValues, "sort");
  const timeRangeList = mapOptions(timeOptionValues, "time");
  return { filterList, sortFilterList, timeRangeList };
}

function mapSearchSuggestion(value: unknown, index: number): SearchSuggestion | null {
  const item = asRecord(value);
  const text = asText(item.name, item.text, item.keyword, item.word, item.title, value);
  if (!text) return null;
  return {
    id: asText(item.id, item.keyword_id, item.word_id) || `${text}-${index}`,
    text,
    iconUrl: remoteUrl(item.icon_url) || remoteUrl(item.icon) || remoteUrl(item.image_url),
    kind: asText(item.type, item.kind, item.category) || undefined
  };
}

function searchSuggestionsFrom(result: UnknownRecord): SearchSuggestion[] {
  const nested = asRecord(result.suggestion ?? result.suggestions ?? result.search_suggestion);
  const welcomeItems = asArray(result.Lists ?? result.lists).flatMap((value) => (
    searchList(asRecord(value).items)
  ));
  return firstNonEmptyArray(
    searchList(result.list),
    searchList(result.items),
    searchList(result.suggestion),
    searchList(result.suggestions),
    searchList(result.search_suggestion),
    welcomeItems,
    searchList(nested)
  )
    .map((value, index) => mapSearchSuggestion(value, index))
    .filter((value): value is SearchSuggestion => Boolean(value))
    .filter((value, index, values) => values.findIndex((item) => item.text === value.text) === index)
    .slice(0, 12);
}

function searchFoundNamesFrom(result: UnknownRecord): string[] {
  const searchFound = asRecord(result.search_found);
  return searchList(searchFound.list)
    .map((value) => asText(asRecord(value).name, value))
    .filter((value, index, values) => Boolean(value) && values.indexOf(value) === index)
    .slice(0, 20);
}

export async function fetchSearchWelcomePage(): Promise<SearchSuggestion[]> {
  const payload = await callBackground({
    channel: "xiaoheishu-api",
    operation: "searchWelcome",
    params: {}
  });
  return searchSuggestionsFrom(searchApiResultRecord(payload));
}

export async function fetchSearchFound(): Promise<string[]> {
  const payload = await callBackground({
    channel: "xiaoheishu-api",
    operation: "searchFound",
    params: {}
  });
  return searchFoundNamesFrom(searchApiResultRecord(payload));
}

export async function fetchSearchSuggestions(query: string): Promise<SearchSuggestion[]> {
  const payload = await callBackground({
    channel: "xiaoheishu-api",
    operation: "searchSuggestion",
    params: { query: query.trim() }
  });
  return searchSuggestionsFrom(searchApiResultRecord(payload));
}

export async function fetchCurrentUser(): Promise<UserProfile> {
  const payload = await callBackground({
    channel: "xiaoheishu-api",
    operation: "currentUser",
    params: {}
  });
  const result = resultRecord(payload);
  const accountDetail = asRecord(result.account_detail);
  const profile = asRecord(result.profile);
  const merged = {
    ...profile,
    ...accountDetail,
    userid: accountDetail.userid ?? profile.heybox_id,
    username: accountDetail.username ?? profile.nickname,
    avatar: accountDetail.avatar ?? accountDetail.avartar ?? profile.avatar,
    avartar: accountDetail.avartar ?? accountDetail.avatar ?? profile.avatar
  };
  const user = mapUserProfile(merged);
  if (!user) throw new Error("当前登录账号信息不完整");
  return user;
}

export async function fetchUserProfile(userId: string): Promise<UserProfile> {
  const payload = await callBackground({
    channel: "xiaoheishu-api",
    operation: "userProfile",
    params: { userId: userId.trim() }
  });
  const result = resultRecord(payload);
  const user = mapUserProfile(result.account_detail ?? result.user ?? result);
  if (!user) throw new Error("个人资料字段发生了变化，当前页面暂时无法解析");
  return user;
}

export async function fetchProfileEvents(
  userId: string,
  width = 720,
  lastValue = ""
): Promise<Pick<ProfilePageResult, "posts" | "hasMore" | "nextLastValue">> {
  const payload = await callBackground({
    channel: "xiaoheishu-api",
    operation: "profileEvents",
    params: {
      userId: userId.trim(),
      width: Math.max(320, Math.round(width)),
      lastValue
    }
  });
  const result = resultRecord(payload);
  const moments = asArray(result.moments);
  const posts = moments
    .map((value) => mapFeedPost(value))
    .filter((post): post is FeedPost => Boolean(post));
  const nextLastValue = asText(result.lastval, result.last_val, result.next_lastval);
  if (moments.length > 0 && posts.length === 0) {
    throw new Error("个人动态字段发生了变化，当前页面暂时无法解析");
  }
  return {
    posts,
    hasMore: Boolean(nextLastValue),
    nextLastValue
  };
}

/** Fetch one official search page. Only type=link content and type=user users are exposed. */
export async function fetchSearchPage(
  query: string,
  searchType: SearchType,
  offset = 0,
  width = 720,
  selection: SearchFilterSelection = { filter: "", sort: "", timeRange: "" }
): Promise<SearchResult> {
  const safeQuery = query.trim();
  const safeType = searchTypeValue(searchType) ?? "general";
  const limit = 30;
  const safeOffset = Math.max(0, Math.round(offset));
  const payload = await callBackground({
    channel: "xiaoheishu-api",
    operation: "search",
    params: {
      query: safeQuery,
      searchType: safeType,
      offset: safeOffset,
      limit,
      width: Math.max(320, Math.round(width)),
      ...(selection.filter ? { filterTag: selection.filter } : {}),
      ...(selection.sort ? { sortFilter: selection.sort } : {}),
      ...(selection.timeRange ? { timeRange: selection.timeRange } : {})
    }
  });
  const result = searchResultRecord(payload);
  const items = searchItems(result);
  const posts: FeedPost[] = [];
  const users: SearchUser[] = [];
  const seenPosts = new Set<string>();
  const seenUsers = new Set<string>();

  items.forEach((entry) => {
    const type = asText(entry.type).toLocaleLowerCase("en-US");
    const info = [
      entry.info,
      entry.data,
      type === "link" ? entry.link : undefined,
      type === "user" ? entry.user : undefined,
      entry
    ]
      .map(asRecord)
      .find((value) => Object.keys(value).length > 0) ?? {};
    if (safeType === "user" && type === "user") {
      const user = mapSearchUser(info);
      if (user && !seenUsers.has(user.id)) {
        seenUsers.add(user.id);
        users.push(user);
      }
      return;
    }
    if (safeType === "general" && type === "link") {
      const post = mapFeedPost(info);
      if (!post || seenPosts.has(post.id)) return;
      seenPosts.add(post.id);
      posts.push({
        ...post,
        title: stripHtml(post.title),
        excerpt: stripHtml(post.excerpt)
      });
    }
  });

  const explicitHasMore = hasFieldValue(result.has_more)
    ? isEnabledFlag(result.has_more)
    : hasFieldValue(result.has_more_page)
      ? isEnabledFlag(result.has_more_page)
      : undefined;
  const realResultCount = safeType === "general" ? posts.length : users.length;
  // A mixed page can contain spaces, topics and other modules around a small
  // number of real results. Only an explicit server flag or the absence of
  // real results can end pagination; raw item count is never used here.
  const hasMore = realResultCount > 0 && (explicitHasMore === undefined ? true : explicitHasMore);
  return {
    query: safeQuery,
    searchType: safeType,
    posts,
    users,
    filters: mapSearchFilters(result),
    hasMore,
    nextOffset: safeOffset + limit
  };
}

export async function fetchPostDetail(linkId: string, fallbackPost?: FeedPost): Promise<PostDetail> {
  const payload = await callBackground({
    channel: "xiaoheishu-api",
    operation: "detail",
    params: { linkId }
  });
  const result = resultRecord(payload);
  const rawLink = asRecord(result.link);
  if (!Object.keys(rawLink).length) throw new Error("帖子不存在、已删除或当前账号不可见");

  const rawPost = mapFeedPost(rawLink, fallbackPost);
  if (!rawPost) throw new Error("帖子详情缺少必要字段");
  const kind = rawPost.kind;
  const blocks = kind === "article" ? parseArticleContent(rawLink.text) : parseContentBlocks(rawLink.text);
  const knownImages = [
    ...rawPost.media.filter((media): media is ImageMedia => media.kind === "image"),
    ...(fallbackPost?.media.filter((media): media is ImageMedia => media.kind === "image") ?? [])
  ];
  const blockImages: ImageMedia[] = blocks
    .flatMap((block) => block.kind === "image" ? [{ ...block, kind: "image" as const }] : [])
    .map((image, index) => {
      const matching = knownImages.find((candidate) => candidate.url === image.url && candidate.width && candidate.height)
        ?? knownImages.find((candidate) => candidate.url === image.url)
        ?? knownImages[index];
      return {
        ...image,
        thumbnail: image.thumbnail ?? matching?.thumbnail,
        width: image.width ?? matching?.width,
        height: image.height ?? matching?.height
      };
    });
  const fallbackVideo = fallbackPost?.media.find((media): media is VideoMedia => media.kind === "video");
  const video = kind === "video" ? videoMediaFrom(rawLink, fallbackVideo) : undefined;
  const media: PostMedia[] = video
    ? [video]
    : blockImages.length
      ? blockImages
      : rawPost.media;
  const post: FeedPost = { ...rawPost, kind, media, hasVideo: kind === "video" };

  return {
    post,
    kind,
    blocks,
    media,
    comments: mapCommentGroups(result.comments, "p1"),
    hasMoreComments: asNumber(result.has_more_floors) === 1,
    commentPage: 1,
    shareUrl: asText(rawLink.share_url, post.href) || undefined
  };
}

export async function fetchMoreComments(linkId: string, page: number): Promise<CommentsResult> {
  const safePage = Math.max(2, Math.round(page));
  const payload = await callBackground({
    channel: "xiaoheishu-api",
    operation: "comments",
    params: { linkId, page: safePage, limit: COMMENT_LIMIT }
  });
  const result = resultRecord(payload);
  return {
    comments: mapCommentGroups(result.comments, `p${safePage}`),
    hasMoreComments: asNumber(result.has_more_floors) === 1,
    commentPage: safePage
  };
}

export async function fetchCommentReplies(rootCommentId: string, lastCommentId: string): Promise<CommentRepliesResult> {
  const payload = await callBackground({
    channel: "xiaoheishu-api",
    operation: "commentReplies",
    params: { rootCommentId, lastCommentId }
  });
  const result = resultRecord(payload);
  const replies = asArray(result.comments)
    .map((reply, index) => mapComment(reply, `${rootCommentId}-more-${lastCommentId || "first"}-${index}`))
    .filter((reply): reply is CommentItem => Boolean(reply));
  return {
    rootCommentId,
    replies,
    exhausted: replies.length === 0
  };
}

export async function setPostAuthorFollowing(linkId: string, followingId: string, following: boolean): Promise<void> {
  const payload = await callBackground({
    channel: "xiaoheishu-api",
    operation: following ? "followUser" : "unfollowUser",
    params: { linkId, followingId }
  });
  const response = asRecord(payload);
  if (response.status !== "ok") {
    throw new Error(asText(response.msg, response.message) || (following ? "关注失败" : "取消关注失败"));
  }
}

export async function setSearchUserFollowing(userId: string, following: boolean): Promise<void> {
  const payload = await callBackground({
    channel: "xiaoheishu-api",
    operation: following ? "followSearchUser" : "unfollowSearchUser",
    params: { userId }
  });
  const response = asRecord(payload);
  if (response.status !== "ok") {
    throw new Error(asText(response.msg, response.message) || (following ? "关注失败" : "取消关注失败"));
  }
}

function assertSuccessfulMutation(payload: unknown, fallbackMessage: string): void {
  const response = asRecord(payload);
  if (response.status !== "ok") {
    throw new Error(asText(response.msg, response.message) || fallbackMessage);
  }
}

export async function fetchFavoriteFolders(): Promise<FavoriteFolder[]> {
  const payload = await callBackground({
    channel: "xiaoheishu-api",
    operation: "favoriteFolders",
    params: {}
  });
  const result = resultRecord(payload);
  return asArray(result.folders).flatMap((value): FavoriteFolder[] => {
    const folder = asRecord(value);
    const id = asText(folder.id, folder.folder_id);
    const name = asText(folder.name, folder.title);
    if (!id || !name) return [];
    return [{
      id,
      name,
      count: asNumber(folder.count, folder.link_count),
      isDefault: asNumber(folder.is_default) === 1
    }];
  });
}

export async function setPostLiked(linkId: string, liked: boolean): Promise<void> {
  const payload = await callBackground({
    channel: "xiaoheishu-api",
    operation: "likePost",
    params: { linkId, liked }
  });
  assertSuccessfulMutation(payload, liked ? "点赞失败" : "取消点赞失败");
}

export async function setPostFavorited(linkId: string, favorited: boolean, folderId = ""): Promise<void> {
  const payload = await callBackground({
    channel: "xiaoheishu-api",
    operation: "favoritePost",
    params: { linkId, favorited, folderId }
  });
  assertSuccessfulMutation(payload, favorited ? "收藏失败" : "取消收藏失败");
}

export async function setCommentLiked(commentId: string, liked: boolean): Promise<void> {
  const payload = await callBackground({
    channel: "xiaoheishu-api",
    operation: "likeComment",
    params: { commentId, liked }
  });
  assertSuccessfulMutation(payload, liked ? "评论点赞失败" : "取消评论点赞失败");
}
