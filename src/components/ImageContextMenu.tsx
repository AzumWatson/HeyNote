import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { ImageActionTarget } from "../image-actions";

export interface ImageContextMenuState {
  x: number;
  y: number;
  target: ImageActionTarget;
}

interface ImageContextMenuProps {
  state: ImageContextMenuState;
  onClose: () => void;
  onCopy: (target: ImageActionTarget) => void;
  onDownload: (target: ImageActionTarget) => void;
}

const MENU_WIDTH = 148;
const MENU_HEIGHT = 88;
const VIEWPORT_GAP = 10;
export const IMAGE_CONTEXT_MENU_OPEN_ATTRIBUTE = "data-xiaoheishu-image-menu-open";

export function ImageContextMenu({ state, onClose, onCopy, onDownload }: ImageContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState(() => ({ left: state.x, top: state.y }));

  useLayoutEffect(() => {
    const width = menuRef.current?.offsetWidth || MENU_WIDTH;
    const height = menuRef.current?.offsetHeight || MENU_HEIGHT;
    setPosition({
      left: Math.max(VIEWPORT_GAP, Math.min(state.x, window.innerWidth - width - VIEWPORT_GAP)),
      top: Math.max(VIEWPORT_GAP, Math.min(state.y, window.innerHeight - height - VIEWPORT_GAP))
    });
    menuRef.current?.querySelector<HTMLButtonElement>("button")?.focus({ preventScroll: true });
  }, [state]);

  useEffect(() => {
    document.documentElement.setAttribute(IMAGE_CONTEXT_MENU_OPEN_ATTRIBUTE, "true");
    const closeOnPointerDown = (event: PointerEvent) => {
      const menu = menuRef.current;
      if (!menu || !event.composedPath().includes(menu)) onClose();
    };
    const closeOnKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      onClose();
    };
    const close = () => onClose();
    document.addEventListener("pointerdown", closeOnPointerDown, true);
    window.addEventListener("keydown", closeOnKeyDown, true);
    window.addEventListener("resize", close, { passive: true });
    window.addEventListener("scroll", close, { passive: true, capture: true });
    window.addEventListener("blur", close);
    return () => {
      document.documentElement.removeAttribute(IMAGE_CONTEXT_MENU_OPEN_ATTRIBUTE);
      document.removeEventListener("pointerdown", closeOnPointerDown, true);
      window.removeEventListener("keydown", closeOnKeyDown, true);
      window.removeEventListener("resize", close);
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("blur", close);
    };
  }, [onClose]);

  function activate(action: (target: ImageActionTarget) => void) {
    const target = state.target;
    onClose();
    action(target);
  }

  return (
    <div
      ref={menuRef}
      className="image-context-menu"
      role="menu"
      aria-label="图片操作"
      style={position}
      onContextMenu={(event) => event.preventDefault()}
      onKeyDown={(event) => {
        if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
        event.preventDefault();
        const buttons = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>("button"));
        const current = buttons.indexOf(document.activeElement as HTMLButtonElement);
        const delta = event.key === "ArrowDown" ? 1 : -1;
        buttons[(current + delta + buttons.length) % buttons.length]?.focus();
      }}
    >
      <button type="button" role="menuitem" onClick={() => activate(onDownload)}>下载图片</button>
      <button type="button" role="menuitem" onClick={() => activate(onCopy)}>复制图片</button>
    </div>
  );
}
