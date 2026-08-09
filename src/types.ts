export type PostKind = "image" | "video" | "article";

export interface Community {
  id: string;
  name: string;
}

export interface FavoriteFolder {
  id: string;
  name: string;
  count: number;
  isDefault: boolean;
}

export interface ImageMedia {
  kind: "image";
  url: string;
  thumbnail?: string;
  width?: number;
  height?: number;
}

export interface VideoMedia {
  kind: "video";
  url: string;
  poster: string;
  width?: number;
  height?: number;
  duration?: number;
  durationLabel?: string;
}

export type PostMedia = ImageMedia | VideoMedia;

export interface PostContentTagSubLabel {
  title: string;
  startColor?: string;
  endColor?: string;
}

export interface PostContentTag {
  name: string;
  tagId?: number;
  align?: "top" | "bottom";
  styleType?: 0 | 1 | 2;
  backgroundColor?: string;
  textColor?: string;
  iconUrl?: string;
  subLabel?: PostContentTagSubLabel;
}

export interface FeedPost {
  id: string;
  href: string;
  title: string;
  excerpt: string;
  author: string;
  authorId?: string;
  avatar?: string;
  level?: string;
  isFollowing?: boolean;
  topic: string;
  topicIcon?: string;
  contentTags?: PostContentTag[];
  media: PostMedia[];
  kind: PostKind;
  likes: number;
  isLiked?: boolean;
  favorites?: number;
  isFavorited?: boolean;
  comments: number;
  linkTag: number;
  hasVideo: boolean;
  createdAt?: string;
  ipLocation?: string;
}

export type ContentBlock =
  | { kind: "text"; text: string }
  | { kind: "html"; html: string }
  | { kind: "image"; url: string; thumbnail?: string; width?: number; height?: number };

export type HeyboxEmojiGroup = "cube" | "heygirl";

export type CommentContentPart =
  | { kind: "text"; text: string }
  | {
      kind: "emoji";
      code: string;
      group: HeyboxEmojiGroup;
      id: string;
      label: string;
    };

export interface CommentItem {
  id: string;
  author: string;
  avatar?: string;
  level?: string;
  text: string;
  content?: CommentContentPart[];
  images?: ImageMedia[];
  replyToCommentId?: string;
  replyToAuthor?: string;
  createdAt?: string;
  ipLocation?: string;
  likes: number;
  isLiked?: boolean;
  isCy?: boolean;
  isAuthorLiked?: boolean;
  replies: CommentItem[];
  replyCount?: number;
  hasMoreReplies?: boolean;
}

export interface PostDetail {
  post: FeedPost;
  kind: PostKind;
  blocks: ContentBlock[];
  media: PostMedia[];
  comments: CommentItem[];
  hasMoreComments: boolean;
  commentPage: number;
  shareUrl?: string;
}

export interface FeedResult {
  posts: FeedPost[];
  hasMore: boolean;
  nextOffset: number;
  lastValue?: string;
}

export type SearchType = "general" | "user";

export interface SearchSuggestion {
  id: string;
  text: string;
  iconUrl?: string;
  kind?: string;
}

export interface SearchMedal {
  id?: number;
  name: string;
  imageUrl?: string;
  achieved?: boolean;
  worn?: boolean;
  description?: string;
}

export interface SearchUser {
  id: string;
  username: string;
  avatar?: string;
  level?: string;
  recTag?: string;
  isFollowing?: boolean;
  medals: SearchMedal[];
}

export interface SearchFilterOption {
  id: string;
  name: string;
  value: string;
  selected?: boolean;
}

export interface SearchFilters {
  filterList: SearchFilterOption[];
  sortFilterList: SearchFilterOption[];
  timeRangeList: SearchFilterOption[];
}

export interface SearchFilterSelection {
  filter: string;
  sort: string;
  timeRange: string;
}

export interface SearchResult {
  query: string;
  searchType: SearchType;
  posts: FeedPost[];
  users: SearchUser[];
  filters: SearchFilters;
  hasMore: boolean;
  nextOffset: number;
}

export interface DetailResult {
  detail: PostDetail;
}

export interface CommentsResult {
  comments: CommentItem[];
  hasMoreComments: boolean;
  commentPage: number;
}

export interface CommentRepliesResult {
  rootCommentId: string;
  replies: CommentItem[];
  exhausted: boolean;
}

export type HeyboxApiOperation =
  | "feed"
  | "feedBanner"
  | "communityFeed"
  | "search"
  | "searchWelcome"
  | "searchFound"
  | "searchSuggestion"
  | "detail"
  | "comments"
  | "commentReplies"
  | "originalImage"
  | "favoriteFolders"
  | "likePost"
  | "favoritePost"
  | "likeComment"
  | "followUser"
  | "unfollowUser"
  | "followSearchUser"
  | "unfollowSearchUser";

export type HeyboxApiRequest =
  | {
      channel: "xiaoheishu-api";
      operation: "feed";
      params: { offset: number; width: number };
    }
  | {
      channel: "xiaoheishu-api";
      operation: "feedBanner";
      params: { [key: string]: never };
    }
  | {
      channel: "xiaoheishu-api";
      operation: "communityFeed";
      params: { topicId: string; offset: number; width: number; lastValue: string };
    }
  | {
      channel: "xiaoheishu-api";
      operation: "search";
      params: {
        query: string;
        searchType: SearchType;
        offset: number;
        limit: number;
        width: number;
        filterTag?: string;
        sortFilter?: string;
        timeRange?: string;
      };
    }
  | {
      channel: "xiaoheishu-api";
      operation: "searchWelcome" | "searchFound";
      params: { [key: string]: never };
    }
  | {
      channel: "xiaoheishu-api";
      operation: "searchSuggestion";
      params: { query: string };
    }
  | {
      channel: "xiaoheishu-api";
      operation: "detail";
      params: { linkId: string };
    }
  | {
      channel: "xiaoheishu-api";
      operation: "comments";
      params: { linkId: string; page: number; limit: number };
    }
  | {
      channel: "xiaoheishu-api";
      operation: "commentReplies";
      params: { rootCommentId: string; lastCommentId: string };
    }
  | {
      channel: "xiaoheishu-api";
      operation: "originalImage";
      params: { url: string };
    }
  | {
      channel: "xiaoheishu-api";
      operation: "favoriteFolders";
      params: { [key: string]: never };
    }
  | {
      channel: "xiaoheishu-api";
      operation: "likePost";
      params: { linkId: string; liked: boolean };
    }
  | {
      channel: "xiaoheishu-api";
      operation: "favoritePost";
      params: { linkId: string; favorited: boolean; folderId: string };
    }
  | {
      channel: "xiaoheishu-api";
      operation: "likeComment";
      params: { commentId: string; liked: boolean };
    }
  | {
      channel: "xiaoheishu-api";
      operation: "followUser" | "unfollowUser";
      params: { linkId: string; followingId: string };
    }
  | {
      channel: "xiaoheishu-api";
      operation: "followSearchUser" | "unfollowSearchUser";
      params: { userId: string };
    };

export type HeyboxApiResponse =
  | { ok: true; data: unknown }
  | { ok: false; error: string };
