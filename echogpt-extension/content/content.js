(function () {
  const INLINE_TRIGGER_ID = "echogpt-inline-trigger";

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

    button.addEventListener("click", openSidebar);
    document.body.append(button);
  }

  async function openSidebar() {
    try {
      await chrome.runtime.sendMessage({ type: "OPEN_SIDEBAR" });
    } catch {
      // Extension context invalidated — ignore.
    }
  }

  function onSelectionChange() {
    const selection = window.getSelection();
    const text = selection?.toString().trim();
    if (!text) return;

    document.dispatchEvent(
      new CustomEvent("echogpt:selection", { detail: { text }, bubbles: true })
    );
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", injectTrigger, { once: true });
  } else {
    injectTrigger();
  }

  document.addEventListener("mouseup", onSelectionChange);

  chrome.runtime?.onMessage.addListener((message) => {
    if (message?.type === "PING_FROM_SIDEBAR") {
      console.debug("[EchoGPT] content script ready");
    }
  });
})();
