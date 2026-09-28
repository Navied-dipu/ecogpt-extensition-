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
  statModels: document.getElementById("statModels"),
  statDelay: document.getElementById("statDelay"),
  chats: document.getElementById("chats"),
  chatsEmpty: document.getElementById("chatsEmpty"),
  viewAll: document.getElementById("viewAll"),
  quickGrid: document.querySelector(".quick-grid"),
  privacyLink: document.getElementById("privacyLink"),
  supportLink: document.getElementById("supportLink"),
  rateLink: document.getElementById("rateLink")
};

const EXTERNAL_LINKS = {
  privacy: "https://echogpt.app/privacy",
  support: "https://echogpt.app/support",
  rate:
    "https://chromewebstore.google.com/detail/echogpt-multi-ai-chat-sidebar/reviews"
};

const QUICK_ACTIONS = {
  summarize: {
    label: "Summarize Page",
    build: (context) => `Summarize this page in 5 bullet points:\n\n${context.pageText}`
  },
  explain: {
    label: "Explain Selection",
    build: (context) =>
      context.selection
        ? `Explain this clearly and simply:\n\n"${context.selection}"`
        : "Explain the key idea of the current page in two short sentences."
  },
  rewrite: {
    label: "Rewrite Text",
    build: (context) =>
      context.selection
        ? `Rewrite this text to be clearer and more concise:\n\n"${context.selection}"`
        : "Rewrite the main text of this page so it reads more clearly."
  },
  search: {
    label: "Search with AI",
    build: (context) =>
      `Answer this using the current page as context:\n\n${context.pageText}`
  }
};

let activeTabId = null;
let lastSelection = "";

/* ---------- Theme ---------- */

function resolveTheme(theme) {
  if (theme === "dark" || theme === "light") return theme;
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function applyTheme(theme) {
  document.documentElement.dataset.theme = resolveTheme(theme);
}

els.themeToggle.addEventListener("click", async () => {
  const next = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
  applyTheme(next);
  await chrome.storage.local.set({ theme: next });
});

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
  await openExternal("https://echogpt.app/login?source=extension");
});

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
  await openSidePanel();
  window.close();
});

/* ---------- Page context ---------- */

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab ?? null;
}

async function getPageText() {
  if (activeTabId === null) return "";
  try {
    const res = await chrome.tabs.sendMessage(activeTabId, { type: "GET_PAGE_TEXT" });
    return res?.text || "";
  } catch {
    return "";
  }
}

document.addEventListener("echogpt:selection", (event) => {
  lastSelection = event.detail?.text || "";
});

/* ---------- Quick actions ---------- */

async function runQuickAction(action) {
  if (!(action in QUICK_ACTIONS)) return;

  const config = QUICK_ACTIONS[action];
  const button = els.quickGrid.querySelector(`[data-action="${action}"]`);

  if (button) {
    button.disabled = true;
    button.dataset.label = config.label;
  }

  try {
    const pageText = await getPageText();
    const prompt = config.build({ pageText, selection: lastSelection });

    const opened = await openSidePanel();
    if (!opened) return;

    await chrome.runtime.sendMessage({
      type: "SIDEBAR_PROMPT",
      payload: { prompt, command: action.toUpperCase() }
    });

    window.close();
  } finally {
    if (button) {
      button.disabled = false;
    }
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
      const opened = await openSidePanel();
      if (!opened) return;
      await chrome.runtime.sendMessage({
        type: "SIDEBAR_PROMPT",
        payload: { prompt: entry.prompt || "", entryId: entry.id }
      });
      window.close();
    });

    li.append(button);
    els.chats.append(li);
  }
}

/* ---------- User ---------- */

function renderUser(user) {
  const signedIn = Boolean(user?.email || user?.name);

  els.userBlock.hidden = !signedIn;
  els.signIn.style.display = signedIn ? "none" : "flex";
  els.signIn.hidden = signedIn;

  if (!signedIn) return;

  const name = user.name || user.email.split("@")[0];
  const plan = user.plan === "pro" || user.plan === "Pro" ? "Pro" : "Free";

  els.userAvatar.textContent = name.charAt(0).toUpperCase();
  els.userName.textContent = name;
  els.userEmail.textContent = user.email || "";
  els.userPlan.textContent = plan;
  els.userPlan.dataset.plan = plan;
}

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
  const stored = await chrome.storage.local.get([
    "theme",
    "user",
    "enabled",
    HISTORY_KEY
  ]);

  applyTheme(stored.theme || "system");

  const models = Array.isArray(stored.enabled) && stored.enabled.length
    ? stored.enabled
    : DEFAULT_MODELS;
  els.statModels.textContent = String(models.length);

  renderUser(stored.user);
  renderChats(stored[HISTORY_KEY]);

  els.statDelay.textContent = `${await measureDelay()}ms`;

  const tab = await getActiveTab();
  activeTabId = tab?.id ?? null;
}

init();
