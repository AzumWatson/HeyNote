import type { SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement>;

function IconBase({ children, ...props }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>
      {children}
    </svg>
  );
}

export function SearchIcon(props: IconProps) {
  return <IconBase {...props}><circle cx="11" cy="11" r="6.5" /><path d="m16 16 4 4" /></IconBase>;
}

export function CompassIcon(props: IconProps) {
  return <IconBase {...props}><circle cx="12" cy="12" r="9" /><path d="m15.7 8.3-2.1 5.3-5.3 2.1 2.1-5.3 5.3-2.1Z" /></IconBase>;
}

export function FlameIcon(props: IconProps) {
  return <IconBase {...props}><path d="M12.3 21c4.1 0 7-2.9 7-6.8 0-3-1.6-5.5-4.8-8.3.1 2.4-1 3.6-2 4.3.2-3.2-1.5-5.4-4-7.2.2 3-3.8 6-3.8 11.2 0 3.9 3 6.8 7.6 6.8Z" /><path d="M9.2 17.2c0-1.6 1.2-2.7 3.4-4.8-.2 2 .9 2.7 1.3 3.7.7 1.8-.5 3.6-2.4 3.6-1.3 0-2.3-1-2.3-2.5Z" /></IconBase>;
}

export function BookmarkIcon(props: IconProps) {
  return <IconBase {...props}><path d="M6.5 4.5c0-1 1-1.8 2.1-1.8h6.8c1.1 0 2.1.8 2.1 1.8v16l-5.5-3.7-5.5 3.7v-16Z" /></IconBase>;
}

export function SystemThemeIcon(props: IconProps) {
  return <IconBase {...props}><rect x="3.5" y="4.5" width="17" height="12" rx="2.2" /><path d="M8.5 20h7M12 16.5V20" /></IconBase>;
}

export function SunIcon(props: IconProps) {
  return <IconBase {...props}><circle cx="12" cy="12" r="3.4" /><path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M18.7 5.3l-1.4 1.4M6.7 17.3l-1.4 1.4" /></IconBase>;
}

export function MoonIcon(props: IconProps) {
  return <IconBase {...props}><path d="M20.2 15.1A8.5 8.5 0 0 1 8.9 3.8 8.6 8.6 0 1 0 20.2 15Z" /></IconBase>;
}

export function RefreshIcon(props: IconProps) {
  return <IconBase {...props}><path d="M20 7v5h-5" /><path d="M18.4 16.4A8 8 0 1 1 19.8 9L20 12" /></IconBase>;
}

export function CloseIcon(props: IconProps) {
  return <IconBase {...props}><path d="m6 6 12 12M18 6 6 18" /></IconBase>;
}

export function HeartIcon({ fill = "none", ...props }: IconProps) {
  return <IconBase fill={fill} {...props}><path d="M20.8 8.8c0 5.2-8.8 10.1-8.8 10.1S3.2 14 3.2 8.8A4.4 4.4 0 0 1 12 8a4.4 4.4 0 0 1 8.8.8Z" /></IconBase>;
}

function HeyboxSolidIcon({ children, ...props }: IconProps) {
  return (
    <svg viewBox="0 0 1024 1024" fill="currentColor" aria-hidden="true" {...props}>
      {children}
    </svg>
  );
}

/** Official Xiaoheihe `bbs_thumbs-up_filled_24x24` glyph. */
export function ThumbUpIcon(props: IconProps) {
  return (
    <HeyboxSolidIcon {...props}>
      <path d="M617.344 323.157333l194.005333 6.826667c32.853333 1.152 64.896 10.197333 93.44 26.368l28.032 15.829333a95.573333 95.573333 0 0 1 43.989334 112.213334c-4.437333 13.952-8.192 27.562667-11.306667 40.789333-1.365333 5.973333-2.090667 12.074667-2.090667 18.176l-.938666 49.493333a244.693333 244.693333 0 0 1-16.64 84.138667l-19.968 51.242667a80.213333 80.213333 0 0 0-4.693334 16.768l-10.666666 63.146666a285.44 285.44 0 0 1-22.272 72.192l-5.461334 11.861334c-13.056 28.330667-41.429333 46.464-69.461333 46.464h-336c-61.056 0-103.808-11.306667-139.946667-27.989334V323.157333C369.237333 298.666667 400.426667 272.298667 411.989333 250.794667c44.416-82.133333 0-161.834667 81.706667-202.282667 37.546667-18.602667 164.437333-8.618667 123.605333 274.645333zM281.344 322.688v587.946667l-164.053333 23.466666a27.989333 27.989333 0 0 1-31.957334-27.733333V350.72c0-15.488 12.544-27.989333 27.989334-27.989333h168.021333z" />
    </HeyboxSolidIcon>
  );
}

/** Official Xiaoheihe `common_star_filled_24x24` glyph. */
export function StarIcon(props: IconProps) {
  return (
    <HeyboxSolidIcon {...props}>
      <path d="M512 106.666667 381.525333 372.864 85.333333 415.829333l214.613334 209.749334L248.576 917.333333 512 776.96l263.424 140.373333-50.944-291.754666L938.666667 415.829333l-294.570667-42.965333L511.957333 106.666667z" />
      <path d="M511.872 64a42.666667 42.666667 0 0 1 38.314667 23.68l122.154666 246.186667 272.469334 39.722666a42.666667 42.666667 0 0 1 23.722666 72.704l-198.186666 194.090667 47.061333 269.653333a42.666667 42.666667 0 0 1-62.122667 44.928L512 825.301333l-243.242667 129.706667a42.666667 42.666667 0 0 1-62.122666-45.013333l47.402666-269.568-198.485333-194.048a42.666667 42.666667 0 0 1 23.68-72.746667l273.962667-39.722667 120.490666-245.973333a42.666667 42.666667 0 0 1 38.229334-23.893333zM512.213333 203.136 605.866667 391.808a42.666667 42.666667 0 0 0 32.042666 23.253333l209.365334 30.549334-152.661334 149.504a42.666667 42.666667 0 0 0-12.202666 37.802666l35.882666 205.653334-186.24-99.285334a42.666667 42.666667 0 0 0-40.149333 0l-186.112 99.2 36.138667-205.482666a42.666667 42.666667 0 0 0-12.16-37.930667l-152.874667-149.418667 210.773333-30.592a42.666667 42.666667 0 0 0 32.213334-23.466666l92.330666-188.458667z" />
    </HeyboxSolidIcon>
  );
}

/** Official Xiaoheihe `bbs_comment_filled_24x24` glyph. */
export function CommentIcon(props: IconProps) {
  return (
    <HeyboxSolidIcon {...props}>
      <path d="M149.333333 128A106.666667 106.666667 0 0 0 42.666667 234.666667v426.666666C42.666667 720.213333 85.333333 768 149.333333 768c51.413333 0 64 28.672 64 64v97.066667a34.133333 34.133333 0 0 0 56.192 26.026666l173.44-146.730666A170.666667 170.666667 0 0 1 553.173333 768H874.666667a106.666667 106.666667 0 0 0 106.666666-106.666667v-426.666666A106.666667 106.666667 0 0 0 874.666667 128H149.333333z" />
    </HeyboxSolidIcon>
  );
}

export function ArrowIcon(props: IconProps) {
  return <IconBase {...props}><path d="M5 12h14M14 7l5 5-5 5" /></IconBase>;
}

export function GridIcon(props: IconProps) {
  return <IconBase {...props}><rect x="4" y="4" width="6" height="6" rx="1" /><rect x="14" y="4" width="6" height="6" rx="1" /><rect x="4" y="14" width="6" height="6" rx="1" /><rect x="14" y="14" width="6" height="6" rx="1" /></IconBase>;
}

export function FilterIcon(props: IconProps) {
  return <IconBase {...props}><path d="M4 7h10M18 7h2M4 17h2M10 17h10" /><circle cx="16" cy="7" r="2" /><circle cx="8" cy="17" r="2" /></IconBase>;
}

export function PlayIcon({ fill = "currentColor", ...props }: IconProps) {
  return <IconBase fill={fill} {...props}><path d="m9 7 8 5-8 5V7Z" /></IconBase>;
}

export function VideoIcon(props: IconProps) {
  return <IconBase {...props}><rect x="3.5" y="5.5" width="13" height="13" rx="3" /><path d="m16.5 10 4-2v8l-4-2" /></IconBase>;
}

export function ArticleIcon(props: IconProps) {
  return <IconBase {...props}><path d="M6 3.5h9l3 3v14H6v-17Z" /><path d="M14.5 3.5V7H18M9 11h6M9 14.5h6M9 18h4" /></IconBase>;
}

export function ImageIcon(props: IconProps) {
  return <IconBase {...props}><rect x="3.5" y="4.5" width="17" height="15" rx="2.5" /><circle cx="9" cy="10" r="1.5" /><path d="m5.5 17 4.2-4 3 2.8 2.1-2 3.7 3.2" /></IconBase>;
}

export function ExternalIcon(props: IconProps) {
  return <IconBase {...props}><path d="M13 5h6v6M19 5l-8 8" /><path d="M17 13v5a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V8a1 1 0 0 1 1-1h5" /></IconBase>;
}

export function ChevronIcon(props: IconProps) {
  return <IconBase {...props}><path d="m9 6 6 6-6 6" /></IconBase>;
}
