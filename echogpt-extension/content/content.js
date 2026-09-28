(function () {
  const INLINE_TRIGGER_ID = "echogpt-inline-trigger";
  const TOAST_ID = "echogpt-toast-host";
  const PAGE_TEXT_LIMIT = 3000;

  /* ================= Toast (shadow DOM, isolated from page CSS) ================= */

  const TOAST_CSS = `
    :host { all: initial; }
    .toast {
      position: fixed;
      right: 16px;
      bottom: 68px;
      display: flex;
      align-items: center;
      gap: 8px;
      max-width: 280px;
      padding: 10px 16px 10px 12px;
      border-radius: 999px;
      font-family: Inter, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
      font-size: 13px;
      font-weight: 500;
      line-height: 1.2;
      color: #ffffff;
      background: #14141f;
      box-shadow: 0 8px 24px rgba(0, 0, 0, 0.32);
      z-index: 2147483647;
      pointer-events: none;
      animation: echogpt-toast 2s cubic-bezier(0.22, 1, 0.36, 1) forwards;
    }
    .toast__icon {
      display: grid;
      place-items: center;
      flex: 0 0 auto;
      width: 18px;
      height: 18px;
    }
    .toast__icon svg { width: 18px; height: 18px; display: block; }
    .toast__text { min-width: 0; }

    .toast--ok .toast__icon { color: #34d399; }
    .toast--warn .toast__icon { color: #fbbf24; }

    @keyframes echogpt-toast {
      0%   { opacity: 0; transform: translateY(14px) scale(0.96); }
      18%  { opacity: 1; transform: translateY(0) scale(1); }
      72%  { opacity: 1; transform: translateY(0) scale(1); }
      100% { opacity: 0; transform: translateY(-8px) scale(0.97); }
    }

    @media (prefers-reduced-motion: reduce) {
      .toast { animation: echogpt-toast 2s linear forwards; }
    }
  `;

  const ICON_OK =
    '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true">' +
    '<path d="M12 2.5a9.5 9.5 0 1 1 0 19 9.5 9.5 0 0 1 0-19Z" fill="currentColor" opacity=".18"/>' +
    '<path d="m8 12.4 2.6 2.6L16 9.6" stroke="currentColor" stroke-width="2.2" ' +
    'stroke-linecap="round" stroke-linejoin="round"/></svg>';

  const ICON_WARN =
    '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true">' +
    '<path d="M12 2.5a9.5 9.5 0 1 1 0 19 9.5 9.5 0 0 1 0-19Z" fill="currentColor" opacity=".18"/>' +
    '<path d="M12 7.5v5.2M12 16.4v.1" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>';

  function toastHost() {
    let host = document.getElementById(TOAST_ID);
    if (host?.shadowRoot) return host.shadowRoot;

    host = document.createElement("div");
    host.id = TOAST_ID;
    host.style.cssText = "position:fixed;top:0;left:0;width:0;height:0;";
    (document.body || document.documentElement).append(host);

    const shadow = host.attachShadow({ mode: "open" });
    const style = document.createElement("style");
    style.textContent = TOAST_CSS;
    shadow.append(style);

    return shadow;
  }

  function showToast(text, variant = "ok") {
    const shadow = toastHost();
    shadow.querySelector(".toast")?.remove();

    const toast = document.createElement("div");
    toast.className = `toast toast--${variant}`;
    toast.setAttribute("role", "status");
    toast.setAttribute("aria-live", "polite");

    const icon = document.createElement("span");
    icon.className = "toast__icon";
    icon.setAttribute("aria-hidden", "true");
    icon.innerHTML = variant === "warn" ? ICON_WARN : ICON_OK;

    const label = document.createElement("span");
    label.className = "toast__text";
    label.textContent = text;

    toast.append(icon, label);
    shadow.append(toast);

    setTimeout(() => toast.remove(), 2000);
  }

  /* ================= Page / selection extraction ================= */

  function getPageText(limit = PAGE_TEXT_LIMIT) {
    // Work on a clone so the injected trigger button never leaks into the context.
    const clone = document.body?.cloneNode(true);
    clone?.querySelector(`#${INLINE_TRIGGER_ID}`)?.remove();

    const raw = clone?.innerText || "";
    return raw.replace(/\s+/g, " ").trim().slice(0, limit);
  }

  function getSelection() {
    return window.getSelection()?.toString().trim() || "";
  }

  /* ================= Quick actions ================= */

  const ACTIONS = {
    SUMMARIZE_PAGE: {
      label: "Summarize Page",
      run: () => `Summarize this page: ${getPageText() || document.title}`
    },
    EXPLAIN_SELECTION: {
      label: "Explain Selection",
      requiresSelection: true,
      run: (selection) => `Explain this: ${selection}`
    },
    REWRITE_TEXT: {
      label: "Rewrite Text",
      requiresSelection: true,
      run: (selection) => `Rewrite this text: ${selection}`
    },
    SEARCH_WITH_AI: {
      label: "Search with AI",
      run: (selection) => `Search and explain: ${selection || document.title}`
    }
  };

  async function runAction(name) {
    const action = ACTIONS[name];
    if (!action) return { ok: false, error: "unknown-action" };

    const selection = getSelection();

    if (action.requiresSelection && !selection) {
      showToast("Please select some text first", "warn");
      return { ok: false, error: "no-selection" };
    }

    const prompt = action.run(selection);

    try {
      await chrome.runtime.sendMessage({
        type: "ACTION_PROMPT",
        payload: {
          action: name,
          label: action.label,
          prompt,
          url: location.href,
          pageTitle: document.title
        }
      });
    } catch {
      showToast("EchoGPT is not responding", "warn");
      return { ok: false, error: "bridge-unavailable" };
    }

    showToast("Sent to EchoGPT", "ok");
    chrome.runtime.sendMessage({ type: "OPEN_SIDEBAR" }).catch(() => {});

    return { ok: true };
  }

  /* ================= Floating trigger ================= */

  function injectTrigger() {
    if (document.getElementById(INLINE_TRIGGER_ID)) return;

    const button = document.createElement("button");
    button.id = INLINE_TRIGGER_ID;
    button.type = "button";
    button.title = "Ask EchoGPT";
    button.textContent = "E";
    button.setAttribute("aria-label", "Ask EchoGPT");

    Object.assign(button.style, {
      position: "fixed",
      right: "16px",
      bottom: "16px",
      width: "40px",
      height: "40px",
      borderRadius: "10px",
      border: "none",
      cursor: "pointer",
      fontFamily: "Inter, system-ui, sans-serif",
      fontWeight: "700",
      fontSize: "16px",
      color: "#ffffff",
      background: "linear-gradient(135deg, #7c3aed, #2563eb)",
      boxShadow: "0 4px 14px rgba(20, 20, 31, 0.25)",
      zIndex: "2147483647"
    });

    button.addEventListener("click", () => {
      chrome.runtime.sendMessage({ type: "OPEN_SIDEBAR" }).catch(() => {});
    });

    document.body.append(button);
  }

  function onSelectionChange() {
    const text = getSelection();
    if (!text) return;

    document.dispatchEvent(
      new CustomEvent("echogpt:selection", { detail: { text }, bubbles: true })
    );
  }

  /* ================= Wiring ================= */

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", injectTrigger, { once: true });
  } else {
    injectTrigger();
  }

  document.addEventListener("mouseup", onSelectionChange);

  if (typeof chrome !== "undefined" && chrome.runtime?.onMessage) {
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      if (message?.type === "GET_PAGE_TEXT") {
        sendResponse({ text: getPageText(6000), title: document.title, url: location.href });
        return true;
      }

      if (message?.type in ACTIONS) {
        runAction(message.type)
          .then(sendResponse)
          .catch(() => sendResponse({ ok: false, error: "failed" }));
        return true;
      }

      return false;
    });
  }
})();
