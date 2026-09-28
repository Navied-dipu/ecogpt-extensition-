const HISTORY_KEY = "chatHistory";
const SETTINGS_KEY = "settings";

const MODEL_LABEL = {
  "gpt-4o": "GPT-4o",
  "gemini-pro": "Gemini Pro",
  "claude-3.5": "Claude 3.5",
  "llama-3": "Llama 3",
  mistral: "Mistral"
};

const MODEL_KEY_SLOT = {
  "gpt-4o": "chatgpt",
  "gemini-pro": "gemini",
  "claude-3.5": "claude",
  "llama-3": "groq",
  mistral: "mistral"
};

/* ================= Active tab context ================= */

let activeTab = { windowId: null, tabId: null, url: null, title: null };

function trackActiveTab(tab) {
  if (!tab || tab.id === undefined || tab.windowId === undefined) return;
  activeTab = {
    windowId: tab.windowId,
    tabId: tab.id,
    url: tab.url || null,
    title: tab.title || null
  };
  chrome.storage.session?.set({ activeTab }).catch(() => {});
}

chrome.tabs.onActivated.addListener(async ({ tabId, windowId }) => {
  try {
    trackActiveTab(await chrome.tabs.get(tabId));
  } catch {
    activeTab = { ...activeTab, windowId, tabId };
  }
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (tab.active) trackActiveTab(tab);
});

chrome.windows.onFocusChanged.addListener(async (windowId) => {
  if (windowId === chrome.windows.WINDOW_ID_NONE) return;
  try {
    const [tab] = await chrome.tabs.query({ active: true, windowId });
    trackActiveTab(tab);
  } catch {
    /* window may have closed */
  }
});

/* ================= Side panel delivery queue ================= */

let pendingAction = null;
let deliverTimer = null;
let sidebarReady = false;
let delivering = false;

function queueAction(payload) {
  pendingAction = payload;
  clearTimeout(deliverTimer);
  deliverTimer = setTimeout(attemptDeliver, 200);
  if (sidebarReady) attemptDeliver();
}

async function attemptDeliver() {
  if (delivering || !pendingAction) return;

  delivering = true;
  const payload = pendingAction;

  try {
    await chrome.runtime.sendMessage({ type: "SIDEBAR_ACTION", payload });
    // Only clear if nothing newer was queued while this send was in flight.
    if (pendingAction === payload) pendingAction = null;
  } catch {
    // Sidebar is not open yet — keep it queued for SIDEBAR_READY.
  } finally {
    delivering = false;
  }
}

async function openSidePanel(windowId) {
  const target = windowId ?? activeTab.windowId;
  if (target === null || target === undefined) return false;

  try {
    await chrome.sidePanel.open({ windowId: target });
    return true;
  } catch {
    return false;
  }
}

chrome.runtime.onInstalled.addListener(async () => {
  await chrome.storage.local.set({
    settings: {
      theme: "system",
      temperature: 0.7,
      maxTokens: 2048,
      sendOnSelect: true
    }
  });
  await chrome.sidePanel.setPanelBehavior({ openPanelBehavior: "open" });
});

// Chrome only fires this while the manifest declares no default_popup.
// With a popup configured the toolbar icon opens popup.html instead.
chrome.action.onClicked.addListener((tab) => {
  trackActiveTab(tab);
  openSidePanel(tab?.windowId);
});

chrome.commands.onCommand.addListener(async (command) => {
  if (command !== "open-sidebar") return;
  await openSidePanel();
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  switch (message?.type) {
    case "CHAT_REQUEST":
      handleChatRequest(message.payload)
        .then(sendResponse)
        .catch((err) => sendResponse({ error: err.message }));
      return true;

    case "OPEN_SIDEBAR":
      if (sender?.tab) trackActiveTab({ ...sender.tab, windowId: sender.tab.windowId });
      openSidePanel(sender?.tab?.windowId)
        .then((ok) => sendResponse({ ok }))
        .catch(() => sendResponse({ ok: false }));
      return true;

    case "ACTION_PROMPT":
      if (sender?.tab) {
        activeTab = {
          windowId: sender.tab.windowId,
          tabId: sender.tab.id,
          url: sender.tab.url || message.payload?.url || null,
          title: message.payload?.pageTitle || null
        };
      }
      queueAction(message.payload);
      sendResponse({ ok: true });
      return true;

    case "SIDEBAR_READY":
      sidebarReady = true;
      attemptDeliver();
      sendResponse({ ok: true, pending: Boolean(pendingAction) });
      return true;

    case "GET_ACTIVE_TAB":
      sendResponse({ ok: true, activeTab });
      return true;

    case "NEW_CHAT":
      queueAction(message.payload);
      sendResponse({ ok: true });
      return true;

    case "PING":
      sendResponse({ ok: true, version: chrome.runtime.getManifest().version });
      return true;

    default:
      return false;
  }
});

async function handleChatRequest({ model, messages }) {
  const { settings } = await chrome.storage.local.get(SETTINGS_KEY);
  const label = MODEL_LABEL[model] || model;
  const apiKey = await getApiKey(model);

  if (!apiKey) {
    await appendHistory(label, messages);
    return { text: `No API key configured for **${label}**. Add one in Settings.`, error: true };
  }

  await appendHistory(label, messages);

  return {
    model,
    text: "Response placeholder — connect your model endpoint in background/background.js.",
    settings
  };
}

async function getApiKey(model) {
  const { apiKeys = {} } = await chrome.storage.local.get("apiKeys");
  const slot = MODEL_KEY_SLOT[model] || model;
  return apiKeys[model] || apiKeys[slot] || null;
}

async function appendHistory(model, messages) {
  const { [HISTORY_KEY]: history = [] } = await chrome.storage.local.get(HISTORY_KEY);
  const lastUser = [...messages].reverse().find((m) => m.role === "user");

  history.unshift({
    id: crypto.randomUUID(),
    model,
    prompt: lastUser?.text || "",
    time: Date.now()
  });

  await chrome.storage.local.set({ [HISTORY_KEY]: history.slice(0, 200) });
}
