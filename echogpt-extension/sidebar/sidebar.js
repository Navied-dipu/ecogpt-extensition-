const MODELS = [
  { id: "chatgpt", label: "ChatGPT" },
  { id: "claude", label: "Claude" },
  { id: "gemini", label: "Gemini" },
  { id: "mistral", label: "Mistral" },
  { id: "local", label: "Local" }
];

const els = {
  tabs: document.getElementById("modelTabs"),
  chatArea: document.getElementById("chatArea"),
  emptyState: document.getElementById("emptyState"),
  input: document.getElementById("input"),
  send: document.getElementById("send"),
  newChat: document.getElementById("newChat"),
  themeToggle: document.getElementById("themeToggle"),
  activeModel: document.getElementById("activeModel")
};

let activeModel = MODELS[0].id;
let conversations = { [activeModel]: [] };

function applyTheme(theme) {
  document.documentElement.dataset.theme = theme === "dark" ? "dark" : "light";
}

function renderTabs() {
  els.tabs.replaceChildren();
  for (const model of MODELS) {
    const tab = document.createElement("button");
    tab.type = "button";
    tab.className = "model-tab";
    tab.textContent = model.label;
    tab.setAttribute("aria-selected", String(model.id === activeModel));
    tab.addEventListener("click", () => {
      activeModel = model.id;
      els.activeModel.value = activeModel;
      renderTabs();
      renderChat();
    });
    els.tabs.append(tab);
  }
}

function renderSelect() {
  els.activeModel.replaceChildren();
  for (const model of MODELS) {
    const option = document.createElement("option");
    option.value = model.id;
    option.textContent = model.label;
    els.activeModel.append(option);
  }
  els.activeModel.value = activeModel;
}

function addMessage(modelId, role, text, isError = false) {
  if (!conversations[modelId]) conversations[modelId] = [];

  const record = { role, text, time: Date.now() };
  conversations[modelId].push(record);

  els.emptyState.classList.add("hidden");

  const node = document.createElement("div");
  node.className = isError ? "message message-error" : `message message-${role}`;

  const textNode = document.createElement("span");
  textNode.textContent = text;
  node.append(textNode);

  const meta = document.createElement("span");
  meta.className = "message-meta";
  meta.textContent = new Date(record.time).toLocaleTimeString();
  node.append(meta);

  els.chatArea.append(node);
  els.chatArea.scrollTop = els.chatArea.scrollHeight;

  return record;
}

function renderChat() {
  els.chatArea.replaceChildren();
  const messages = conversations[activeModel] || [];

  if (messages.length === 0) {
    els.emptyState.classList.remove("hidden");
    els.chatArea.append(els.emptyState);
    return;
  }

  els.emptyState.classList.add("hidden");
  for (const msg of messages) {
    const node = document.createElement("div");
    node.className = `message message-${msg.role}`;
    node.textContent = msg.text;
    const meta = document.createElement("span");
    meta.className = "message-meta";
    meta.textContent = new Date(msg.time).toLocaleTimeString();
    node.append(meta);
    els.chatArea.append(node);
  }
  els.chatArea.scrollTop = els.chatArea.scrollHeight;
}

async function send() {
  const text = els.input.value.trim();
  if (!text) return;

  els.input.value = "";
  addMessage(activeModel, "user", text);
  addMessage(activeModel, "assistant", "…");

  try {
    const reply = await chrome.runtime.sendMessage({
      type: "CHAT_REQUEST",
      payload: { model: activeModel, messages: conversations[activeModel] }
    });

    const last = conversations[activeModel][conversations[activeModel].length - 1];
    last.text = reply?.text || "No response received.";
    renderChat();
  } catch (err) {
    const last = conversations[activeModel][conversations[activeModel].length - 1];
    last.text = err?.message || "Request failed.";
    last.isError = true;
    renderChat();
  }
}

els.send.addEventListener("click", send);

els.input.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    send();
  }
});

els.newChat.addEventListener("click", () => {
  conversations[activeModel] = [];
  renderChat();
});

els.themeToggle.addEventListener("click", async () => {
  const next = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
  applyTheme(next);
  await chrome.storage.local.set({ theme: next });
});

els.activeModel.addEventListener("change", () => {
  activeModel = els.activeModel.value;
  renderTabs();
  renderChat();
});

chrome.runtime.onMessage.addListener((message) => {
  if (message?.type === "SIDEBAR_PROMPT" && message.payload?.prompt) {
    els.input.value = message.payload.prompt;
    send();
  }
});

async function init() {
  const { theme = "system" } = await chrome.storage.local.get("theme");
  const resolved =
    theme === "system"
      ? window.matchMedia("(prefers-color-scheme: dark)").matches
        ? "dark"
        : "light"
      : theme;
  applyTheme(resolved);

  renderTabs();
  renderSelect();
  renderChat();
}

init();
