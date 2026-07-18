import { HeyboxText } from "./HeyboxText";

export function GeneratedTextCover({
  title,
  variant = "feed"
}: {
  title: string;
  variant?: "feed" | "detail";
}) {
  return (
    <div className={`text-cover text-cover--${variant}`} aria-hidden="true">
      <span className="text-cover__eyebrow">HEYNOTE</span>
      <strong className="text-cover__title">
        <HeyboxText
          value={title}
          emojiSize={variant === "detail" ? 34 : 22}
          preserveLineBreaks={false}
        />
      </strong>
    </div>
  );
}
