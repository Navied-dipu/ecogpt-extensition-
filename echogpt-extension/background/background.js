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

chrome.runtime.onInstalled.addListener(async () => {
  await chrome.storage.local.set({
    settings: {
      theme: "system",
      temperature: 0.7,
      maxTokens: 2048,
      sendOnSelect: true
    }
  });
  await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: false });
});

chrome.commands.onCommand.addListener(async (command) => {
  if (command !== "open-sidebar") return;

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab?.windowId !== undefined) {
    await chrome.sidePanel.open({ windowId: tab.windowId });
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  switch (message?.type) {
    case "CHAT_REQUEST":
      handleChatRequest(message.payload)
        .then(sendResponse)
        .catch((err) => sendResponse({ error: err.message }));
      return true;

    case "NEW_CHAT":
      broadcastToSidebar(message.payload);
      sendResponse({ ok: true });
      return true;

    case "PING":
      sendResponse({ ok: true, version: chrome.runtime.getManifest().version });
      return true;

    default:
      return false;
  }
});

async function broadcastToSidebar(payload) {
  const windows = await chrome.windows.getAll({ populate: true });
  await Promise.all(
    windows.flatMap((win) =>
      (win.tabs || [])
        .filter((tab) => tab.url?.startsWith(chrome.runtime.getURL("")))
        .map((tab) =>
          chrome.tabs.sendMessage(tab.id, { type: "SIDEBAR_PROMPT", payload }).catch(() => {})
        )
    )
  );
}

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
