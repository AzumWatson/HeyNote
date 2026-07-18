import type { CommentContentPart, HeyboxEmojiGroup } from "../types";

interface EmojiGroupDefinition {
  columns: number;
  rows: number;
  spriteUrl: string;
  names: readonly string[];
}

const EMOJI_GROUPS: Record<HeyboxEmojiGroup, EmojiGroupDefinition> = {
  cube: {
    columns: 6,
    rows: 17,
    spriteUrl: "https://static.max-c.com/heybox_web/emoji/cube/cube_emoji_v28.png",
    names: [
      "哭泣", "酷", "doge", "喜欢", "黑人问号", "惊讶",
      "开心", "捂脸哭", "晕", "感动", "委屈", "并不简单",
      "乖", "笑cry", "怒", "滑稽", "沧桑", "凄凉",
      "赞", "学习", "叹气", "加油", "摊手", "喷水",
      "打脸", "H币", "生气", "困", "闭嘴", "吐",
      "咕咕", "微笑", "哇", "汗", "吓", "睡觉",
      "2023", "圣诞树", "庆祝", "庆祝-圣诞", "你懂我", "我懂你",
      "阳", "比心", "wota", "鹅", "握草", "这是什么鸟",
      "上学-乐", "上学-丧", "打咩", "超人", "僵尸", "小鸡",
      "窝囊", "摸摸头", "电牛", "摘墨镜", "悟空", "2024",
      "良民", "嬉水女王", "2025", "浪人砍一刀", "吃鸡啦", "鸡毙你",
      "机智", "石化", "吹口哨", "思考", "太酷啦", "蛋糕",
      "毁灭战士", "P的谎言", "剑星伊芙", "欧润吉", "剑星渡鸦", "猛男微笑",
      "时间旅者", "来财", "我方了", "喜+1", "2026", "害羞",
      "吃瓜", "菜doge", "柠檬", "比耶", "爱心", "玫瑰",
      "+1", "-1", "点赞", "盒十", "耶", "鼓掌",
      "碰拳", "马年吉祥", "红包", "炒菜", "山姆无奈", "洛的点赞"
    ]
  },
  heygirl: {
    columns: 6,
    rows: 4,
    spriteUrl: "https://cdn.max-c.com/heybox_web/emoji/cube2/cube2_emoji.png",
    names: [
      "诶嘿", "哭", "白嫖怪", "疑问", "痴", "喜欢",
      "捏脸", "害羞", "苦酒入喉", "秃", "rua!", "吃瓜",
      "茄化", "无语", "这…", "敲开心", "开可乐", "哈哈",
      "滑稽", "偷看", "喝奶茶", "惊", "记下来", "挨刀"
    ]
  }
};

function isEmojiGroup(value: string): value is HeyboxEmojiGroup {
  return value === "cube" || value === "heygirl";
}

function idForIndex(index: number, columns: number): string {
  const row = Math.floor(index / columns) + 1;
  const column = index % columns + 1;
  return `${row}${column}`;
}

function emojiPart(group: HeyboxEmojiGroup, index: number): Extract<CommentContentPart, { kind: "emoji" }> {
  const definition = EMOJI_GROUPS[group];
  const label = definition.names[index];
  return {
    kind: "emoji",
    code: `${group}_${label}`,
    group,
    id: idForIndex(index, definition.columns),
    label
  };
}

export function heyboxEmojiFromCode(code: string): Extract<CommentContentPart, { kind: "emoji" }> | undefined {
  const separator = code.indexOf("_");
  if (separator <= 0) return undefined;
  const group = code.slice(0, separator);
  const label = code.slice(separator + 1);
  if (!isEmojiGroup(group) || !label) return undefined;
  const index = EMOJI_GROUPS[group].names.indexOf(label);
  return index >= 0 ? emojiPart(group, index) : undefined;
}

export function heyboxEmojiFromId(groupValue: string, id: string): Extract<CommentContentPart, { kind: "emoji" }> | undefined {
  if (!isEmojiGroup(groupValue) || !/^\d+$/.test(id)) return undefined;
  const definition = EMOJI_GROUPS[groupValue];
  const column = Number(id.slice(-1));
  const row = Number(id.slice(0, -1));
  if (row < 1 || row > definition.rows || column < 1 || column > definition.columns) return undefined;
  const index = (row - 1) * definition.columns + column - 1;
  return definition.names[index] ? emojiPart(groupValue, index) : undefined;
}

export function heyboxEmojiSprite(emoji: Extract<CommentContentPart, { kind: "emoji" }>, size = 20) {
  const definition = EMOJI_GROUPS[emoji.group];
  const column = Number(emoji.id.slice(-1));
  const row = Number(emoji.id.slice(0, -1));
  return {
    backgroundImage: `url("${definition.spriteUrl}")`,
    backgroundSize: `${definition.columns * size}px ${definition.rows * size}px`,
    backgroundPosition: `${-(column - 1) * size}px ${-(row - 1) * size}px`
  };
}
