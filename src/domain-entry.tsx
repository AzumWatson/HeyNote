import { Component, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { App, ORIGINAL_MODE_REQUEST_EVENT } from "./App";
import { prefersDarkColorScheme, readLocalThemePreference, resolveTheme } from "./theme";
import appStyles from "./styles.css?inline";

type BrowseMode = "original" | "xiaoheishu";

interface InternalResponse {
  ok: boolean;
  error?: string;
}

const HOME_PATH = "/app/bbs/home";
const OVERLAY_ID = "xiaoheishu-overlay";
const ISOLATION_STYLE_ID = "xiaoheishu-page-isolation";
const EXTENSION_VERSION = chrome.runtime.getManifest().version;

function isHomeRoute(): boolean {
  return location.protocol === "https:"
    && location.hostname === "www.xiaoheihe.cn"
    && location.pathname === HOME_PATH;
}

async function requestModeSwitch(mode: BrowseMode): Promise<void> {
  const response = await chrome.runtime.sendMessage({
    channel: "xiaoheishu-internal",
    operation: "switch-mode",
    mode
  }) as InternalResponse;
  if (!response?.ok) throw new Error(response?.error || "浏览模式切换失败");
  history.replaceState(history.state, "", HOME_PATH);
  location.reload();
}

interface BoundaryProps {
  children: ReactNode;
  onFailure: (error: unknown) => void;
}

class OverlayErrorBoundary extends Component<BoundaryProps, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  componentDidCatch(error: unknown): void {
    this.props.onFailure(error);
  }

  render(): ReactNode {
    return this.state.failed ? null : this.props.children;
  }
}

function mount(): void {
  if (!isHomeRoute() || document.getElementById(OVERLAY_ID)) return;
  if (document.documentElement.dataset.xiaoheishuMounting === "true") return;
  document.documentElement.dataset.xiaoheishuMounting = "true";

  const attach = () => {
    if (!isHomeRoute() || !document.body || document.getElementById(OVERLAY_ID)) return;

    const initialTheme = resolveTheme(readLocalThemePreference(), prefersDarkColorScheme());
    const initialCanvas = initialTheme === "dark" ? "#111210" : "#f7f7f5";
    const initialInk = initialTheme === "dark" ? "#f2f2ee" : "#171717";
    const overlay = document.createElement("div");
    overlay.id = OVERLAY_ID;
    overlay.dataset.xiaoheishuVersion = EXTENSION_VERSION;
    overlay.setAttribute("role", "application");
    overlay.setAttribute("aria-label", "小黑书浏览界面");
    overlay.style.position = "fixed";
    overlay.style.inset = "0";
    overlay.style.zIndex = "2147483000";
    overlay.dataset.xiaoheishuTheme = initialTheme;
    overlay.style.background = initialCanvas;
    overlay.style.visibility = "visible";
    overlay.style.contain = "layout paint style";

    const shadow = overlay.attachShadow({ mode: "open" });
    const style = document.createElement("style");
    style.textContent = `
      :host {
        all: initial;
        position: fixed;
        inset: 0;
        display: block;
        overflow: hidden;
        background: ${initialCanvas};
        color: ${initialInk};
        color-scheme: ${initialTheme};
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", sans-serif;
      }
      ${appStyles}
    `;
    const rootElement = document.createElement("div");
    rootElement.id = "root";
    rootElement.dataset.xiaoheishuRoot = "true";
    shadow.append(style, rootElement);
    document.body.appendChild(overlay);

    const isolationStyle = document.createElement("style");
    isolationStyle.id = ISOLATION_STYLE_ID;
    isolationStyle.textContent = `
      html[data-xiaoheishu="true"],
      html[data-xiaoheishu="true"] > body { overflow: hidden !important; }
      html[data-xiaoheishu="true"] > body > :not(#${OVERLAY_ID}) { visibility: hidden !important; }
      html[data-xiaoheishu="true"] > body > #${OVERLAY_ID} { visibility: visible !important; }
    `;
    (document.head ?? document.documentElement).appendChild(isolationStyle);

    let root: Root | undefined;
    let switchingToOriginal = false;
    const handleOriginalModeRequest = () => {
      if (switchingToOriginal) return;
      switchingToOriginal = true;
      void requestModeSwitch("original").catch((error: unknown) => {
        switchingToOriginal = false;
        console.error("[HeyNote] 无法响应原版论坛切换请求", error);
      });
    };
    window.addEventListener(ORIGINAL_MODE_REQUEST_EVENT, handleOriginalModeRequest);

    const failOpen = (error: unknown) => {
      window.setTimeout(() => {
        window.removeEventListener(ORIGINAL_MODE_REQUEST_EVENT, handleOriginalModeRequest);
        delete document.documentElement.dataset.xiaoheishu;
        delete document.documentElement.dataset.xiaoheishuMounting;
        delete document.documentElement.dataset.xiaoheishuVersion;
        root?.unmount();
        isolationStyle.remove();
        overlay.remove();
        void chrome.runtime.sendMessage({
          channel: "xiaoheishu-internal",
          operation: "switch-mode",
          mode: "original"
        }).then(() => {
          history.replaceState(history.state, "", HOME_PATH);
          location.reload();
        }).catch(() => undefined);
        console.error("[HeyNote] React 覆盖层渲染失败，已恢复原版论坛", error);
      }, 0);
    };

    try {
      const hash = /^#\/(?:feed(?:[/?]|$)|search(?:[/?]|$)|(?:post|article)\/[^/?#]+(?:[/?]|$))/.test(location.hash)
        ? location.hash
        : "#/feed";
      history.replaceState(history.state, "", `${HOME_PATH}${hash}`);
      root = createRoot(rootElement);
      root.render(
        <OverlayErrorBoundary onFailure={failOpen}>
          <App />
        </OverlayErrorBoundary>
      );
      document.documentElement.dataset.xiaoheishu = "true";
      document.documentElement.dataset.xiaoheishuVersion = EXTENSION_VERSION;
    } catch (error) {
      failOpen(error);
    }
  };

  if (document.body) attach();
  else document.addEventListener("DOMContentLoaded", attach, { once: true });
}

mount();
