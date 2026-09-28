const KEY = "chatHistory";

const els = {
  list: document.getElementById("list"),
  empty: document.getElementById("empty"),
  search: document.getElementById("search"),
  clearAll: document.getElementById("clearAll"),
  skeleton: document.getElementById("skeletonList"),
  toastHost: document.getElementById("toastHost")
};

let entries = [];

/* ---------- Toasts ---------- */

const TOAST_ICONS = {
  success:
    '<svg viewBox="0 0 24 24" width="16" height="16" fill="none"><path d="M12 2.5a9.5 9.5 0 1 1 0 19 9.5 9.5 0 0 1 0-19Z" fill="currentColor" opacity=".18"/><path d="m8 12.4 2.6 2.6L16 9.6" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  error:
    '<svg viewBox="0 0 24 24" width="16" height="16" fill="none"><path d="M12 2.5a9.5 9.5 0 1 1 0 19 9.5 9.5 0 0 1 0-19Z" fill="currentColor" opacity=".18"/><path d="M12 7.5v5.2M12 16.4v.1" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>',
  info: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none"><circle cx="12" cy="12" r="9.2" stroke="currentColor" stroke-width="1.8"/><path d="M12 11v5.2M12 7.8v.1" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
  warning:
    '<svg viewBox="0 0 24 24" width="16" height="16" fill="none"><path d="M12 3.4 21 19.6H3L12 3.4Z" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="M12 9.6v4M12 16.2v.1" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
  primary: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none"><path d="M4 5.5A2.5 2.5 0 0 1 6.5 3h11A2.5 2.5 0 0 1 20 5.5v7a2.5 2.5 0 0 1-2.5 2.5H9l-5 4v-13.5Z" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/></svg>'
};

/**
 * Push a toast onto the shared stack.
 * @param {string} message - The text to show
 * @param {"success"|"error"|"info"|"warning"|"primary"} [type] - Toast variant
 * @param {{timeout?: number}} [options] - Auto-dismiss delay in ms
 */
function toast(message, type = "info", { timeout = 3000 } = {}) {
  if (!els.toastHost) return;

  const node = document.createElement("div");
  node.className = `toast toast--${type}`;
  node.setAttribute("role", type === "error" ? "alert" : "status");

  const icon = document.createElement("span");
  icon.className = "toast__icon";
  icon.setAttribute("aria-hidden", "true");
  icon.innerHTML = TOAST_ICONS[type] || TOAST_ICONS.info;

  const text = document.createElement("span");
  text.className = "toast__text";
  text.textContent = message;

  const close = document.createElement("button");
  close.className = "toast__close";
  close.type = "button";
  close.title = "Dismiss";
  close.setAttribute("aria-label", "Dismiss notification");
  close.textContent = "×";
  close.addEventListener("click", () => dismissToast(node));

  node.append(icon, text, close);
  els.toastHost.append(node);
  node.timer = setTimeout(() => dismissToast(node), timeout);
}

/**
 * Slide a toast out and remove it.
 * @param {HTMLElement} node - The toast element
 */
function dismissToast(node) {
  if (!node || node.classList.contains("is-leaving")) return;
  clearTimeout(node.timer);
  node.classList.add("is-leaving");
  node.addEventListener("animationend", () => node.remove(), { once: true });
  setTimeout(() => node.remove(), 400);
}

/* ---------- Theme ---------- */

/**
 * Resolve a theme string to "light" or "dark".
 * @param {string} theme - "light", "dark", or "system"
 * @returns {string} "light" or "dark"
 */
function resolveTheme(theme) {
  if (theme === "light" || theme === "dark") return theme;
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

/**
 * Apply the given theme to the document root.
 * @param {string} theme - "light", "dark", or "system"
 */
function applyTheme(theme) {
  document.documentElement.dataset.theme = resolveTheme(theme);
}

function formatTime(ts) {
  return new Date(ts).toLocaleString();
}

function render() {
  const query = els.search.value.trim().toLowerCase();
  const filtered = query
    ? entries.filter(
        (e) =>
          (e.prompt || "").toLowerCase().includes(query) ||
          (e.title || "").toLowerCase().includes(query) ||
          (e.model || "").toLowerCase().includes(query)
      )
    : entries;

  els.list.replaceChildren();
  els.empty.classList.toggle("hidden", filtered.length > 0);
  els.empty.hidden = filtered.length > 0;
  els.empty.textContent = entries.length
    ? "No matching conversations."
    : "No conversations yet.";

  filtered.forEach((entry, index) => {
    const li = document.createElement("li");
    li.className = "history-item";
    li.style.setProperty("--delay", `${Math.min(index, 12) * 40}ms`);

    const body = document.createElement("div");
    body.className = "history-body-text";

    const prompt = document.createElement("p");
    prompt.className = "history-prompt";
    prompt.textContent = entry.prompt || entry.title || "Untitled chat";

    const time = document.createElement("time");
    time.className = "history-time";
    time.dateTime = new Date(entry.time).toISOString();
    time.textContent = formatTime(entry.time);

    body.append(prompt, time);

    const badge = document.createElement("span");
    badge.className = "badge";
    badge.textContent = entry.model;

    const del = document.createElement("button");
    del.className = "delete-btn";
    del.type = "button";
    del.title = "Delete entry";
    del.setAttribute("aria-label", "Delete entry");
    del.textContent = "×";
    del.addEventListener("click", async () => {
      entries = entries.filter((e) => e.id !== entry.id);
      await persist();
      render();
      toast("Conversation deleted", "success");
    });

    li.append(body, badge, del);
    els.list.append(li);
  });
}

async function persist() {
  await chrome.storage.local.set({ [KEY]: entries });
}

/* The sidebar writes new entries as conversations complete; keep the open
   history panel in sync without a manual refresh. */
async function reload() {
  const stored = await chrome.storage.local.get(KEY);
  entries = Array.isArray(stored[KEY]) ? stored[KEY] : [];
  render();
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "sync" && changes.appearance) {
    applyTheme(changes.appearance.newValue?.theme || "system");
    return;
  }
  if (area === "local" && KEY in changes) reload();
});

chrome.runtime.onMessage.addListener((message) => {
  if (message?.type === "CONVERSATION_UPDATED") reload();
  return false;
});

els.search.addEventListener("input", render);

els.clearAll.addEventListener("click", async () => {
  if (entries.length === 0) {
    toast("History is already empty", "info");
    return;
  }

  entries = [];
  await persist();
  render();
  toast("History cleared", "warning");
});

async function init() {
  const [synced, local] = await Promise.all([
    chrome.storage.sync.get(["appearance"]),
    chrome.storage.local.get(["theme"])
  ]);
  applyTheme(synced.appearance?.theme || local.theme || "system");

  const stored = await chrome.storage.local.get(KEY);
  entries = stored[KEY] || [];

  // Let the shimmer read as a real loading state before painting the list.
  await new Promise((resolve) => setTimeout(resolve, 320));
  if (els.skeleton) els.skeleton.hidden = true;
  render();
}

init();
