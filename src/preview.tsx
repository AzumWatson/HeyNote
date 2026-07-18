import type { CommentItem, Community, FeedPost, PostDetail, PostKind, PostMedia } from "./types";
import { parseCommentContent } from "./data/heybox";

function poster(
  background: string,
  accent: string,
  word: string,
  layout: boolean | { width: number; height: number } = false
): string {
  const width = typeof layout === "object" ? layout.width : layout ? 1200 : 720;
  const height = typeof layout === "object" ? layout.height : layout ? 760 : 960;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
    <defs><filter id="n"><feTurbulence type="fractalNoise" baseFrequency=".8" numOctaves="3" stitchTiles="stitch"/><feColorMatrix values="1 0 0 0 0 0 1 0 0 0 0 0 1 0 0 0 0 0 .1 0"/></filter></defs>
    <rect width="100%" height="100%" fill="${background}"/><circle cx="${width * .8}" cy="${height * .2}" r="${width * .28}" fill="${accent}" opacity=".82"/>
    <path d="M-60 ${height * .82} ${width * .62} ${height * .2} ${width * 1.08} ${height * .82} ${width * .35} ${height * 1.08}Z" fill="#171817" opacity=".92"/>
    <rect width="100%" height="100%" filter="url(#n)" opacity=".3"/><text x="48" y="84" fill="#171817" font-size="20" font-family="sans-serif" letter-spacing="7">PLAYER NOTE</text>
    <text x="48" y="${height - 72}" fill="white" font-size="${width > height ? 82 : 68}" font-weight="700" font-family="sans-serif">${word}</text>
  </svg>`;
  return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
}

function image(url: string, width = 720, height = 960): PostMedia {
  return { kind: "image", url, width, height };
}

const covers = {
  setup: poster("#d7edff", "#ff5e68", "SETUP"),
  video: poster("#dfe8d0", "#ffcc55", "VIDEO"),
  story: poster("#f4d7cd", "#f25345", "STORY", true),
  replay: poster("#d8d3f6", "#6c55d9", "REPLAY"),
  smoke: poster("#eadfbe", "#ff654f", "TACTIC"),
  retro: poster("#cde4db", "#ff7a55", "RETRO"),
  screenshot: poster("#f5d8e5", "#5b4dc6", "MOMENT"),
  build: poster("#f2d6b6", "#e04d3e", "BUILD")
};

export const demoCommunities: Community[] = [
  { id: "1", name: "PC游戏" },
  { id: "569", name: "VRChat" },
  { id: "2", name: "盒友杂谈" },
  { id: "3", name: "方舟：生存进化" },
  { id: "4", name: "艾尔登法环" },
  { id: "5", name: "Steam" },
  { id: "6", name: "星露谷物语" },
  { id: "7", name: "求生之路2" },
  { id: "8", name: "Gal游戏综合区" },
  { id: "9", name: "战争雷霆" },
  { id: "10", name: "绝地求生" },
  { id: "11", name: "崩坏：星穹铁道" }
];

export const demoPosts: FeedPost[] = [
  { id: "1", href: "#", title: "终于把桌面改成了理想工作站 [cube_喜欢]", excerpt: "光线、收纳和显示器支架都重新排了一遍。[heygirl_敲开心]", author: "夜航员", authorId: "demo-author-1", level: "Lv.14", isFollowing: false, topic: "数码硬件", contentTags: [{ name: "电脑求助", tagId: 16043, styleType: 2, backgroundColor: "#004b961a", textColor: "#004b96", iconUrl: "https://imgheybox.max-c.com/oa/2024/07/30/912b6ed8dba7f938a45fe00bddc0d697.png" }], media: [image(covers.setup), image(covers.smoke), image(covers.screenshot)], kind: "image", hasVideo: false, linkTag: 27, likes: 283, comments: 46 },
  { id: "2", href: "#", title: "二十平小家，把每一寸收纳都用起来", excerpt: "从测量到安装的完整过程。", author: "邻居小小A", topic: "生活分享", media: [{ kind: "video", url: "https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4", poster: covers.video, width: 720, height: 960, duration: 30, durationLabel: "00:30" }], kind: "video", hasVideo: true, linkTag: 1, likes: 581, comments: 24 },
  { id: "3", href: "#", title: "十年后重玩《巫师 3》，我才读懂这段支线", excerpt: "当年只顾着赶路，现在却在一个无名村庄停了很久。", author: "白果酒", topic: "PC 游戏", contentTags: [{ name: "Steam", align: "top", styleType: 1, backgroundColor: "#f3f4f5", textColor: "#14191e", iconUrl: covers.story }, { name: "剧情讨论", align: "bottom", styleType: 2, backgroundColor: "#004b961a", textColor: "#004b96" }], media: [image(covers.story, 1200, 760)], kind: "article", hasVideo: false, linkTag: 1, likes: 3401, comments: 307 },
  { id: "4", href: "#", title: "三角洲新赛季：适合独狼的三条撤离路线", excerpt: "不拼枪也能稳定带出。", author: "北港老六", topic: "三角洲行动", media: [], kind: "image", hasVideo: false, linkTag: 27, likes: 919, comments: 128 },
  { id: "5", href: "#", title: "这个 Boss 的第二阶段，其实在讲一场告别", excerpt: "机制、配乐和场景变化连在一起看，设计得太漂亮了。", author: "迟到的勇者", topic: "盒友杂谈", media: [image(covers.replay)], kind: "article", hasVideo: false, linkTag: 1, likes: 788, comments: 95 },
  { id: "6", href: "#", title: "CS2 烟雾教学：只记这四个点位就够用", excerpt: "新手友好，不需要复杂跳投。", author: "A 门保安", topic: "CS2", media: [image(covers.smoke)], kind: "image", hasVideo: false, linkTag: 27, likes: 562, comments: 71 },
  { id: "7", href: "#", title: "你们游戏里见过最安静的地图是哪一张？", excerpt: "不是恐怖，而是会让人放慢脚步的安静。", author: "雨天存档", topic: "盒友杂谈", media: [], kind: "image", hasVideo: false, linkTag: 27, likes: 2345, comments: 614 },
  { id: "8", href: "#", title: "把旧掌机修好以后，我爸先玩了一下午", excerpt: "一次普通维修，最后翻出了很多小时候的故事。", author: "螺丝刀少年", topic: "数码硬件", media: [image(covers.retro)], kind: "article", hasVideo: false, linkTag: 1, likes: 1104, comments: 203 },
  { id: "9", href: "#", title: "本周最离谱的游戏截图大赏", excerpt: "最后一张尤其重量级。", author: "截图键失灵", topic: "沙雕日常", media: [image(covers.screenshot)], kind: "image", hasVideo: false, linkTag: 27, likes: 458, comments: 77 },
  { id: "10", href: "#", title: "给第一次装机的人：别被参数表吓到", excerpt: "把预算和需求说清楚，选择会简单很多。", author: "硬件门诊", topic: "数码硬件", media: [image(covers.build)], kind: "article", hasVideo: false, linkTag: 1, likes: 667, comments: 89 }
];

const comments: CommentItem[] = [
  {
    id: "c1",
    author: "小白开小灶",
    level: "Lv.16",
    text: "这个信息密度刚刚好，先收藏再慢慢看。[cube_喜欢]",
    content: parseCommentContent("这个信息密度刚刚好，先收藏再慢慢看。[cube_喜欢]"),
    images: [
      { kind: "image", url: covers.story, thumbnail: poster("#f4d7cd", "#f25345", "COMMENT THUMB", { width: 300, height: 190 }), width: 1200, height: 760 },
      { kind: "image", url: covers.smoke, thumbnail: poster("#eadfbe", "#ff654f", "COMMENT THUMB", { width: 180, height: 240 }), width: 720, height: 960 }
    ],
    createdAt: "2 天前",
    ipLocation: "广东",
    likes: 5,
    replies: []
  },
  {
    id: "c2",
    author: "光在弦上",
    level: "Lv.10",
    text: "右侧评论独立滚动这个体验很舒服。",
    createdAt: "1 天前",
    ipLocation: "上海",
    likes: 2,
    replies: [{
      id: "c2-1",
      author: "夜航员",
      level: "Lv.14",
      text: "[heygirl_哈哈]",
      content: parseCommentContent('<span data-emoji="heygirl_哈哈" class="hb-emoji hb-emoji-heygirl hb-emoji-heygirl_36"></span>'),
      replyToAuthor: "光在弦上",
      createdAt: "18 小时前",
      likes: 1,
      replies: []
    }]
  }
];

const overflowToken = "66&6yy6yy6y6666y&66666y'y6666666y666666666y".repeat(9);
const overflowComments: CommentItem[] = [{
  id: "overflow-root",
  author: "超长评论测试用户名称也需要安全收缩",
  level: "Lv.14",
  text: `中文混排后接一个超长地址：https://example.com/help/article?token=${"abcdef0123456789".repeat(28)} [cube_喜欢]`,
  images: [{ kind: "image", url: covers.story, width: 1200, height: 760 }],
  createdAt: "刚刚",
  ipLocation: "本地样稿",
  likes: 2,
  replies: [{
    id: "overflow-reply",
    author: "玩家73801451",
    level: "Lv.21",
    text: overflowToken,
    createdAt: "刚刚",
    ipLocation: "本地样稿",
    likes: 0,
    replies: [{
      id: "overflow-reply-deep",
      author: "二层回复测试",
      level: "Lv.8",
      text: `回复中的连续字符：${"LONG_UNBROKEN_VALUE_".repeat(24)}`,
      createdAt: "刚刚",
      likes: 0,
      replies: []
    }]
  }]
}];

function detailFor(post: FeedPost): PostDetail {
  const imageBlocks = post.media.filter((item) => item.kind === "image").map((item) => ({ kind: "image" as const, url: item.url, thumbnail: item.thumbnail, width: item.width, height: item.height }));
  const blocks = post.kind === "article" ? [
    { kind: "html" as const, html: `<p>${post.excerpt}</p><h2>慢下来以后，细节才开始出现 [cube_感动]</h2><p>真正打动人的往往不是任务奖励，而是人物在那些不起眼的瞬间里做出的选择。重新回到这里，我第一次愿意把对白听完，也第一次注意到场景里的天气、声音和停顿。</p><blockquote>好的游戏故事，不只发生在过场动画里，也发生在玩家愿意停下来的那一刻。</blockquote><p>这也是我想把这段经历认真记下来的原因。<span data-emoji="heygirl_喜欢" class="hb-emoji hb-emoji-heygirl hb-emoji-heygirl_26"></span></p>` },
    ...imageBlocks.slice(0, 1),
    { kind: "html" as const, html: "<p>图片会留在作者安排的段落之间，而不是统一堆到文章末尾。</p>" },
    ...imageBlocks.slice(1)
  ] : [
    { kind: "text" as const, text: post.excerpt || "这是帖子正文的视觉样稿。真实扩展会从小黑盒详情接口读取文字、图片和评论。" },
    ...imageBlocks
  ];
  return { post, kind: post.kind, media: post.media, blocks, comments, hasMoreComments: false, commentPage: 1 };
}

function galleryFixturePost(id: string, imageCount: number): FeedPost {
  const media = Array.from({ length: imageCount }, (_, index) => image(
    poster(index % 2 ? "#eadfbe" : "#d7edff", index % 2 ? "#ff654f" : "#ff5e68", String(index + 1))
  ));
  return {
    id,
    href: "#",
    title: `${imageCount} 张图片导航边界样稿`,
    excerpt: "只用于验证圆点导航显示上限。",
    author: "视觉测试",
    topic: "开发样稿",
    media,
    kind: "image",
    hasVideo: false,
    linkTag: 27,
    likes: 0,
    comments: 0
  };
}

function adaptiveFixturePost(
  id: string,
  width: number,
  height: number,
  word: string,
  omitFirstDimensions = false
): FeedPost {
  const cover = poster("#d7edff", "#ff5e68", word, { width, height });
  const firstImage: PostMedia = omitFirstDimensions
    ? { kind: "image", url: cover }
    : image(cover, width, height);
  return {
    id,
    href: "#",
    title: `${word} 首图自适应弹窗样稿`,
    excerpt: `首图尺寸 ${width} × ${height}，用于验证弹窗宽度连续计算。`,
    author: "视觉测试",
    topic: "开发样稿",
    media: [firstImage, image(covers.story, 1200, 760)],
    kind: "image",
    hasVideo: false,
    linkTag: 27,
    likes: 0,
    comments: 0
  };
}

function largeCompositorFixturePost(): FeedPost {
  const makeLargeImage = (background: string, accent: string, word: string): PostMedia => ({
    kind: "image",
    url: poster(background, accent, word, { width: 4097, height: 2305 }),
    thumbnail: poster(background, accent, word, { width: 960, height: 540 }),
    width: 4097,
    height: 2305
  });
  return {
    id: "gpu-large",
    href: "#",
    title: "超大原图合成接缝回归样稿",
    excerpt: "用于验证原图初次适配与切换下一张时不会留下 GPU 分块竖线。",
    author: "视觉测试",
    level: "Lv.14",
    topic: "开发样稿",
    media: [
      makeLargeImage("#111724", "#f05747", "LARGE A"),
      makeLargeImage("#20131b", "#4f8ef7", "LARGE B")
    ],
    kind: "image",
    hasVideo: false,
    linkTag: 27,
    likes: 0,
    comments: 0
  };
}

function progressiveArticleFixturePost(): FeedPost {
  const makeArticleImage = (background: string, accent: string, word: string, index: number): PostMedia => ({
    kind: "image",
    url: poster(background, accent, `${word} FULL`, { width: 1800 + index * 120, height: 1200 + index * 80 }),
    thumbnail: poster(background, accent, `${word} THUMB`, { width: 540, height: 360 }),
    width: 1800 + index * 120,
    height: 1200 + index * 80
  });
  return {
    id: "article-progressive",
    href: "#",
    title: "文章图片渐进加载回归样稿",
    excerpt: "用于验证文章先显示缩略图，图片接近阅读区域后才无感替换为原图。",
    author: "视觉测试",
    level: "Lv.14",
    topic: "开发样稿",
    media: [
      makeArticleImage("#e7e0d4", "#e96552", "ARTICLE A", 0),
      makeArticleImage("#d6e3e8", "#4078bd", "ARTICLE B", 1),
      makeArticleImage("#e4d9eb", "#825ab6", "ARTICLE C", 2),
      makeArticleImage("#dce8d8", "#4f9b6b", "ARTICLE D", 3)
    ],
    kind: "article",
    hasVideo: false,
    linkTag: 1,
    likes: 0,
    comments: 0
  };
}

function commentOverflowFixturePost(): FeedPost {
  return {
    id: "comment-overflow",
    href: "#",
    title: "超长评论断行回归样稿",
    excerpt: "用于检查连续 ASCII、URL、表情、图片和嵌套回复不会撑破评论侧栏。",
    author: "视觉测试",
    level: "Lv.14",
    topic: "开发样稿",
    media: [image(covers.setup)],
    kind: "image",
    hasVideo: false,
    linkTag: 27,
    likes: 0,
    comments: 1
  };
}

const demoDetailsFromFeed = Object.fromEntries(demoPosts.map((post) => [post.id, detailFor(post)])) as Record<string, PostDetail>;

export const demoDetails: Record<string, PostDetail> = {
  ...demoDetailsFromFeed,
  "gallery-12": detailFor(galleryFixturePost("gallery-12", 12)),
  "gallery-13": detailFor(galleryFixturePost("gallery-13", 13)),
  "adaptive-tall": detailFor(adaptiveFixturePost("adaptive-tall", 480, 1200, "TALL")),
  "adaptive-mid": detailFor(adaptiveFixturePost("adaptive-mid", 720, 960, "PORTRAIT")),
  "adaptive-square": detailFor(adaptiveFixturePost("adaptive-square", 900, 900, "SQUARE")),
  "adaptive-wide": detailFor(adaptiveFixturePost("adaptive-wide", 1200, 675, "WIDE")),
  "adaptive-natural": detailFor(adaptiveFixturePost("adaptive-natural", 600, 1000, "NATURAL", true)),
  "gpu-large": detailFor(largeCompositorFixturePost()),
  "article-progressive": detailFor(progressiveArticleFixturePost()),
  "comment-overflow": {
    ...detailFor(commentOverflowFixturePost()),
    comments: overflowComments
  }
};
