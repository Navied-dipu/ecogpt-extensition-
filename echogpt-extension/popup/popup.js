const DEFAULT_MODELS = ["ChatGPT", "Claude", "Gemini", "Mistral", "Local"];
const HISTORY_KEY = "chatHistory";
const MAX_RECENT = 3;

const els = {
  themeToggle: document.getElementById("themeToggle"),
  openSettings: document.getElementById("openSettings"),
  openSidebar: document.getElementById("openSidebar"),
  signIn: document.getElementById("signIn"),
  userBlock: document.getElementById("userBlock"),
  userAvatar: document.getElementById("userAvatar"),
  userName: document.getElementById("userName"),
  userEmail: document.getElementById("userEmail"),
  userPlan: document.getElementById("userPlan"),
  signOut: document.getElementById("signOut"),
  statModels: document.getElementById("statModels"),
  statDelay: document.getElementById("statDelay"),
  chats: document.getElementById("chats"),
  chatsEmpty: document.getElementById("chatsEmpty"),
  viewAll: document.getElementById("viewAll"),
  quickGrid: document.querySelector(".quick-grid"),
  privacyLink: document.getElementById("privacyLink"),
  supportLink: document.getElementById("supportLink"),
  rateLink: document.getElementById("rateLink"),
  toastHost: document.getElementById("toastHost")
};

const EXTERNAL_LINKS = {
  privacy: "https://echogpt.app/privacy",
  support: "https://echogpt.app/support",
  rate:
    "https://chromewebstore.google.com/detail/echogpt-multi-ai-chat-sidebar/reviews"
};

const QUICK_ACTIONS = {
  summarize: { type: "SUMMARIZE_PAGE", label: "Summarize Page" },
  explain: { type: "EXPLAIN_SELECTION", label: "Explain Selection" },
  rewrite: { type: "REWRITE_TEXT", label: "Rewrite Text" },
  search: { type: "SEARCH_WITH_AI", label: "Search with AI" }
};

let activeTabId = null;

/* ---------- Theme ---------- */

function resolveTheme(theme) {
  if (theme === "dark" || theme === "light") return theme;
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function applyTheme(theme) {
  document.documentElement.dataset.theme = resolveTheme(theme);
}

/**
 * Read the theme from chrome.storage.sync, falling back to the local mirror.
 * Seeds "system" on first run so the OS preference is detected once.
 * @returns {Promise<string>} "light", "dark" or "system"
 */
async function readTheme() {
  const [synced, local] = await Promise.all([
    chrome.storage.sync.get(["appearance"]),
    chrome.storage.local.get(["theme"])
  ]);

  const theme = synced.appearance?.theme || local.theme;
  if (!theme) {
    await chrome.storage.sync.set({ appearance: { theme: "system" } });
    return "system";
  }
  return theme;
}

els.themeToggle.addEventListener("click", async () => {
  const next = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
  applyTheme(next);

  // Merge so the other synced appearance preferences are preserved.
  const { appearance = {} } = await chrome.storage.sync.get(["appearance"]);
  await Promise.all([
    chrome.storage.sync.set({ appearance: { ...appearance, theme: next } }),
    chrome.storage.local.set({ theme: next })
  ]);

  toast(`Switched to ${next} mode`, "info");
});

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

/* ---------- Navigation ---------- */

async function openPage(path) {
  await chrome.tabs.create({ url: chrome.runtime.getURL(path) });
  window.close();
}

async function openExternal(url) {
  await chrome.tabs.create({ url });
  window.close();
}

els.openSettings.addEventListener("click", () => openPage("settings/settings.html"));
els.viewAll.addEventListener("click", (event) => {
  event.preventDefault();
  openPage("history/history.html");
});
els.privacyLink.addEventListener("click", (e) => {
  e.preventDefault();
  openExternal(EXTERNAL_LINKS.privacy);
});
els.supportLink.addEventListener("click", (e) => {
  e.preventDefault();
  openExternal(EXTERNAL_LINKS.support);
});
els.rateLink.addEventListener("click", (e) => {
  e.preventDefault();
  openExternal(EXTERNAL_LINKS.rate);
});

els.signIn.addEventListener("click", async () => {
  // The sidebar owns the sign-in flow (overlay, OAuth, email form).
  const opened = await openSidePanel();
  if (!opened) await openExternal("https://echogpt.app/login?source=extension");
  window.close();
});

/**
 * Clear the session and return to the signed-out state.
 * @returns {Promise<void>} Resolves once storage is cleared and the UI updated
 */
async function signOut() {
  els.signOut.disabled = true;

  try {
    await chrome.runtime.sendMessage({ type: "AUTH_SIGN_OUT" });
  } catch {
    await chrome.storage.local.remove(["authToken", "apiKey", "apiKeys", "user"]);
  }

  els.signOut.disabled = false;
  await renderAuth();
  toast("Signed out", "warning");
}

/* ---------- Sidebar ---------- */

async function openSidePanel() {
  if (activeTabId === null) {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    activeTabId = tab?.id ?? null;
  }

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab?.windowId === undefined) return false;

  await chrome.sidePanel.open({ windowId: tab.windowId });
  return true;
}

els.openSidebar.addEventListener("click", async () => {
  const opened = await openSidePanel();
  if (opened) toast("Opening sidebar...", "primary", { timeout: 2000 });
  window.close();
});

/* ---------- Page context ---------- */

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab ?? null;
}

/* ---------- Quick actions ---------- */

async function runQuickAction(action) {
  const config = QUICK_ACTIONS[action];
  if (!config) return;

  const button = els.quickGrid.querySelector(`[data-action="${action}"]`);
  if (button) button.disabled = true;

  try {
    const tab = await getActiveTab();
    if (tab?.id === undefined) {
      toast("No active tab found", "error");
      return;
    }

    let response = null;
    try {
      response = await chrome.tabs.sendMessage(tab.id, { type: config.type });
    } catch {
      response = { ok: false, error: "no-content-script" };
    }

    // Content script refused (no selection, no permission on this page):
    // it already explained why with a toast, so leave the popup open.
    if (!response?.ok) {
      if (response?.error === "no-content-script") {
        toast("EchoGPT can't run on this page", "warning");
      }
      return;
    }

    toast(`${config.label} sent`, "success", { timeout: 2000 });
    await openSidePanel();
    window.close();
  } finally {
    if (button) button.disabled = false;
  }
}

els.quickGrid.addEventListener("click", (event) => {
  const button = event.target.closest("[data-action]");
  if (!button) return;
  runQuickAction(button.dataset.action);
});

/* ---------- Recent chats ---------- */

function timeAgo(ts) {
  const seconds = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (seconds < 60) return "now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d`;
  return new Date(ts).toLocaleDateString();
}

function renderChats(history) {
  els.chats.replaceChildren();

  const recent = (Array.isArray(history) ? history : []).slice(0, MAX_RECENT);
  els.chatsEmpty.classList.toggle("hidden", recent.length > 0);

  for (const entry of recent) {
    const li = document.createElement("li");

    const button = document.createElement("button");
    button.type = "button";
    button.className = "chat";

    const icon = document.createElement("span");
    icon.className = "chat__icon";
    icon.setAttribute("aria-hidden", "true");
    icon.innerHTML =
      '<svg viewBox="0 0 24 24" width="13" height="13" fill="none"><path d="M20 11.5a7.5 7.5 0 1 1-3.2-6.1M20 4.5v4.2h-4.2" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';

    const title = document.createElement("span");
    title.className = "chat__title";
    title.textContent = entry.prompt?.trim() || "Untitled chat";

    const time = document.createElement("span");
    time.className = "chat__time";
    time.textContent = timeAgo(entry.time || Date.now());

    button.append(icon, title, time);
    button.addEventListener("click", async () => {
      await chrome.runtime.sendMessage({
        type: "NEW_CHAT",
        payload: { prompt: entry.prompt || "", entryId: entry.id, label: "Recent Chat" }
      });
      const opened = await openSidePanel();
      if (opened) window.close();
    });

    li.append(button);
    els.chats.append(li);
  }
}

/* ---------- User ---------- */

/**
 * Render the account block from the stored session.
 * @returns {Promise<boolean>} True when a user is signed in
 */
async function renderAuth() {
  const { user } = await chrome.storage.local.get("user");
  const signedIn = Boolean(user);

  els.userBlock.hidden = !signedIn;
  els.signIn.style.display = signedIn ? "none" : "flex";
  els.signIn.hidden = signedIn;
  if (!signedIn) return false;

  const name = String(user.name || user.email?.split("@")[0] || "EchoGPT User");
  const plan = String(user.plan || "free").toLowerCase() === "pro" ? "Pro" : "Free";

  els.userAvatar.textContent = user.avatar ? "" : name.charAt(0).toUpperCase();
  els.userAvatar.style.backgroundImage = user.avatar ? `url(${JSON.stringify(user.avatar)})` : "";
  els.userAvatar.style.backgroundSize = user.avatar ? "cover" : "";
  els.userName.textContent = name;
  els.userEmail.textContent = user.email || "";
  els.userPlan.textContent = plan;
  els.userPlan.dataset.plan = plan;

  return true;
}

els.signOut.addEventListener("click", signOut);

/* Keep the popup in sync while it is open. */
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "sync" && changes.appearance) {
    applyTheme(changes.appearance.newValue?.theme || "system");
    return;
  }

  if (area === "local" && ("user" in changes || "authToken" in changes)) renderAuth();
});

chrome.runtime.onMessage.addListener((message) => {
  if (message?.type === "AUTH_SUCCESS" || message?.type === "AUTH_SIGNED_OUT") renderAuth();
  return false;
});

/* ---------- Latency stat ---------- */

async function measureDelay() {
  const started = performance.now();
  try {
    await chrome.runtime.sendMessage({ type: "PING" });
  } catch {
    /* ignore */
  }
  return Math.max(0, Math.round(performance.now() - started));
}

/* ---------- Init ---------- */

async function init() {
  const stored = await chrome.storage.local.get(["enabled", HISTORY_KEY]);

  applyTheme(await readTheme());

  const models = Array.isArray(stored.enabled) && stored.enabled.length
    ? stored.enabled
    : DEFAULT_MODELS;
  els.statModels.textContent = String(models.length);

  await renderAuth();
  renderChats(stored[HISTORY_KEY]);

  els.statDelay.textContent = `${await measureDelay()}ms`;

  const tab = await getActiveTab();
  activeTabId = tab?.id ?? null;
}

init();
