import { useMemo } from "react";
import type { CommentContentPart } from "../types";
import { parseCommentContent } from "../data/heybox";
import { heyboxEmojiSprite } from "../data/heybox-emoji";

type EmojiPart = Extract<CommentContentPart, { kind: "emoji" }>;

interface HeyboxEmojiProps {
  emoji: EmojiPart;
  className?: string;
  size?: number;
}

interface HeyboxTextProps {
  value: string;
  emojiClassName?: string;
  emojiSize?: number;
  preserveLineBreaks?: boolean;
}

function TextWithBreaks({ value, preserveLineBreaks }: { value: string; preserveLineBreaks: boolean }) {
  if (!preserveLineBreaks || !value.includes("\n")) return <>{value}</>;
  return <>{value.split("\n").map((line, index) => <span key={`${index}-${line.slice(0, 12)}`}>{index > 0 && <br />}{line}</span>)}</>;
}

export function HeyboxEmoji({ emoji, className = "", size = 20 }: HeyboxEmojiProps) {
  return (
    <span
      className={`heybox-inline-emoji hb-emoji hb-emoji-${emoji.group} hb-emoji-${emoji.group}_${emoji.id} ${className}`.trim()}
      data-emoji={emoji.code}
      role="img"
      aria-label={`[${emoji.label}]`}
      title={emoji.label}
      style={{ ...heyboxEmojiSprite(emoji, size), width: size, height: size }}
    />
  );
}

/** Renders Xiaoheihe text while replacing known [cube_*] / [heygirl_*] labels with official sprites. */
export function HeyboxText({
  value,
  emojiClassName,
  emojiSize = 20,
  preserveLineBreaks = true
}: HeyboxTextProps) {
  const parts = useMemo(() => parseCommentContent(value), [value]);
  if (!parts.length) return <TextWithBreaks value={value} preserveLineBreaks={preserveLineBreaks} />;

  return (
    <>
      {parts.map((part, index) => part.kind === "text"
        ? <TextWithBreaks key={`text-${index}`} value={part.text} preserveLineBreaks={preserveLineBreaks} />
        : <HeyboxEmoji key={`emoji-${index}-${part.code}`} emoji={part} className={emojiClassName} size={emojiSize} />)}
    </>
  );
}
