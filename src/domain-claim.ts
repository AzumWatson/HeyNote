type BrowseMode = "original" | "xiaoheishu";

interface InternalResponse {
  ok: boolean;
  error?: string;
}

const MODE_KEY = "xiaoheishu:browse-mode";
const HOME_PATH = "/app/bbs/home";
const TOGGLE_HOST_ID = "xiaoheishu-mode-toggle";
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

  // A real reload is deliberate: it destroys either the original site or the
  // React overlay completely before the other mode starts.
  history.replaceState(history.state, "", HOME_PATH);
  location.reload();
}

function mountOriginalModeToggle(label = "切换到小黑书"): void {
  const attach = () => {
    if (!isHomeRoute() || document.getElementById(TOGGLE_HOST_ID)) return;
    if (document.documentElement.dataset.xiaoheishu === "true") return;

    const host = document.createElement("div");
    host.id = TOGGLE_HOST_ID;
    host.dataset.xiaoheishuVersion = EXTENSION_VERSION;
    host.style.setProperty("all", "initial");
    host.style.position = "fixed";
    host.style.left = "18px";
    host.style.bottom = "18px";
    host.style.zIndex = "2147483647";

    const shadow = host.attachShadow({ mode: "closed" });
    const style = document.createElement("style");
    style.textContent = `
      :host {
        all: initial;
        color-scheme: light dark;
      }
      .mode-panel {
        --panel: rgba(255, 255, 255, .96);
        --control: #f1f1ef;
        --line: rgba(18, 18, 17, .12);
        --ink: #171717;
        --muted: #777772;
        width: 184px;
        box-sizing: border-box;
        padding: 11px;
        border: 1px solid var(--line);
        border-radius: 15px;
        color: var(--ink);
        background: var(--panel);
        box-shadow: 0 10px 30px rgba(0, 0, 0, .16);
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", sans-serif;
        backdrop-filter: blur(18px);
      }
      .mode-label {
        display: block;
        margin: 0 3px 7px;
        color: var(--muted);
        font-size: 9px;
        font-weight: 750;
        letter-spacing: .13em;
      }
      .mode-control {
        display: grid;
        grid-template-columns: 1fr 1.22fr;
        gap: 3px;
        padding: 3px;
        border: 1px solid var(--line);
        border-radius: 10px;
        background: var(--control);
      }
      .mode-option {
        appearance: none;
        min-width: 0;
        min-height: 31px;
        padding: 0 8px;
        border: 0;
        border-radius: 7px;
        color: var(--muted);
        background: transparent;
        cursor: pointer;
        font: 700 11px/1 -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", sans-serif;
        transition: color 150ms ease, background-color 150ms ease, transform 150ms ease, opacity 150ms ease;
        white-space: nowrap;
      }
      .mode-option.is-active {
        color: #fff;
        background: #ff3653;
        box-shadow: 0 5px 13px rgba(255, 54, 83, .24);
        cursor: default;
      }
      .mode-option:not(.is-active):hover {
        color: var(--ink);
        background: rgba(127, 127, 127, .12);
      }
      .mode-option:not(.is-active):active { transform: scale(.97); }
      .mode-option:not(.is-active):disabled { cursor: wait; opacity: .55; }
      @media (prefers-color-scheme: dark) {
        .mode-panel {
          --panel: rgba(27, 28, 26, .96);
          --control: rgba(255, 255, 255, .055);
          --line: rgba(255, 255, 255, .12);
          --ink: #f3f3ef;
          --muted: #9a9a94;
          box-shadow: 0 12px 34px rgba(0, 0, 0, .34);
        }
      }
    `;
    const panel = document.createElement("section");
    panel.className = "mode-panel";
    panel.setAttribute("aria-label", "浏览页面");
    const panelLabel = document.createElement("span");
    panelLabel.className = "mode-label";
    panelLabel.textContent = "浏览页面";
    const control = document.createElement("div");
    control.className = "mode-control";
    control.setAttribute("role", "group");
    control.setAttribute("aria-label", "在原版论坛和小黑书之间切换");
    const originalButton = document.createElement("button");
    originalButton.className = "mode-option is-active";
    originalButton.type = "button";
    originalButton.disabled = true;
    originalButton.setAttribute("aria-pressed", "true");
    originalButton.setAttribute("aria-current", "page");
    originalButton.textContent = "原版";
    const switchButton = document.createElement("button");
    switchButton.className = "mode-option";
    switchButton.type = "button";
    switchButton.setAttribute("aria-label", label);
    switchButton.setAttribute("aria-pressed", "false");
    switchButton.title = label;
    switchButton.textContent = "小黑书";
    switchButton.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      switchButton.disabled = true;
      switchButton.setAttribute("aria-busy", "true");
      void requestModeSwitch("xiaoheishu").catch((error: unknown) => {
        switchButton.disabled = false;
        switchButton.removeAttribute("aria-busy");
        console.error("[HeyNote] 无法切换浏览模式", error);
      });
    });
    control.append(originalButton, switchButton);
    panel.append(panelLabel, control);
    shadow.append(style, panel);
    (document.body ?? document.documentElement).appendChild(host);
  };

  if (document.body) attach();
  else document.addEventListener("DOMContentLoaded", attach, { once: true });
}

async function start(): Promise<void> {
  if (!isHomeRoute()) return;
  const stored = await chrome.storage.local.get(MODE_KEY);
  const mode: BrowseMode = stored[MODE_KEY] === "original" ? "original" : "xiaoheishu";

  if (mode === "original") {
    mountOriginalModeToggle();
    return;
  }

  try {
    const response = await chrome.runtime.sendMessage({
      channel: "xiaoheishu-internal",
      operation: "mount-domain-entry"
    }) as InternalResponse;
    if (!response?.ok) throw new Error(response?.error || "HeyNote 小黑书挂载失败");
  } catch (error) {
    // Fail open: keep Xiaoheihe's original page visible and make that state
    // persistent, so a transient extension failure never traps the user.
    await chrome.runtime.sendMessage({
      channel: "xiaoheishu-internal",
      operation: "switch-mode",
      mode: "original"
    }).catch(() => undefined);
    mountOriginalModeToggle("重试小黑书");
    console.error("[HeyNote] 覆盖层挂载失败，已显示原版论坛", error);
  }
}

void start();

export {};
