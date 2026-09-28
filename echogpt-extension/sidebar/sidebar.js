const MODELS = [
  { id: "gpt-4o", label: "GPT-4o", dot: "#10a37f", initial: "G" },
  { id: "gemini-pro", label: "Gemini Pro", dot: "#4285f4", initial: "G" },
  { id: "claude-3.5", label: "Claude 3.5", dot: "#d97757", initial: "C" },
  { id: "llama-3", label: "Llama 3", dot: "#7c3aed", initial: "L" },
  { id: "mistral", label: "Mistral", dot: "#f97316", initial: "M" }
];

const MAX_CHARS = 4000;
const MAX_ROWS = 4;
const NEAR_BOTTOM = 72;

const KEY = {
  conversations: "conversations",
  activeId: "activeConversationId",
  activeModel: "activeModel",
  theme: "theme",
  pageContext: "includePageContext"
};

const els = {
  chatTitle: document.getElementById("chatTitle"),
  modelTabs: document.getElementById("modelTabs"),
  indicator: document.getElementById("modelIndicator"),
  messages: document.getElementById("messages"),
  emptyState: document.getElementById("emptyState"),
  scrollFab: document.getElementById("scrollFab"),
  newChat: document.getElementById("newChat"),
  openHistory: document.getElementById("openHistory"),
  openSettings: document.getElementById("openSettings"),
  themeToggle: document.getElementById("themeToggle"),
  input: document.getElementById("input"),
  send: document.getElementById("send"),
  counter: document.getElementById("counter"),
  contextToggle: document.getElementById("contextToggle"),
  attach: document.getElementById("attach"),
  fileInput: document.getElementById("fileInput"),
  attachments: document.getElementById("attachments")
};

let conversations = {};
let activeId = null;
let activeModel = MODELS[0].id;
let includePageContext = false;
let attachments = [];
let status = "idle";
let abortRequested = false;
let stickToBottom = true;
let saveTimer = null;

const modelById = (id) => MODELS.find((m) => m.id === id) || MODELS[0];

/* ================= Storage ================= */

function newConversation() {
  return {
    id: crypto.randomUUID(),
    title: "New Chat",
    createdAt: Date.now(),
    updatedAt: Date.now(),
    messages: []
  };
}

function activeConversation() {
  if (!conversations[activeId]) {
    conversations[activeId] = newConversation();
  }
  return conversations[activeId];
}

function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    chrome.storage.local.set({
      [KEY.conversations]: conversations,
      [KEY.activeId]: activeId,
      [KEY.activeModel]: activeModel,
      [KEY.pageContext]: includePageContext
    });
  }, 250);
}

async function loadState() {
  const stored = await chrome.storage.local.get([
    KEY.conversations,
    KEY.activeId,
    KEY.activeModel,
    KEY.theme,
    KEY.pageContext
  ]);

  conversations = stored[KEY.conversations] || {};
  activeId = stored[KEY.activeId] || null;
  activeModel = MODELS.some((m) => m.id === stored[KEY.activeModel])
    ? stored[KEY.activeModel]
    : MODELS[0].id;
  includePageContext = Boolean(stored[KEY.pageContext]);

  if (!activeId || !conversations[activeId]) {
    const conversation = newConversation();
    conversations[conversation.id] = conversation;
    activeId = conversation.id;
  }

  applyTheme(stored[KEY.theme] || "system");
  els.contextToggle.setAttribute("aria-pressed", String(includePageContext));
  els.chatTitle.textContent = activeConversation().title;
}

/* ================= Theme ================= */

function resolveTheme(theme) {
  if (theme === "light" || theme === "dark") return theme;
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function applyTheme(theme) {
  document.documentElement.dataset.theme = resolveTheme(theme);
}

els.themeToggle.addEventListener("click", async () => {
  const next = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
  applyTheme(next);
  await chrome.storage.local.set({ [KEY.theme]: next });
});

/* ================= Markdown ================= */

const ESCAPES = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (ch) => ESCAPES[ch]);
}

function renderMarkdown(source) {
  const blocks = [];

  let html = escapeHtml(source ?? "").replace(
    /```([\w+#.-]*)\r?\n?([\s\S]*?)```/g,
    (match, lang, code) => {
      const index = blocks.push(
        `<div class="codeblock"><div class="codeblock__bar">` +
          `<span class="codeblock__lang">${escapeHtml(lang || "code")}</span>` +
          `<button class="codeblock__copy" type="button">Copy</button></div>` +
          `<pre><code>${code.replace(/\n+$/, "")}</code></pre></div>`
      );
      return `\u0000CB${index - 1}\u0000`;
    }
  );

  html = html
    .replace(/`([^`\n]+)`/g, '<code class="ic">$1</code>')
    .replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[^*])\*([^*\n]+)\*/g, "$1<em>$2</em>")
    .replace(/\n/g, "<br>")
    .replace(/\u0000CB(\d+)\u0000/g, (match, index) => blocks[Number(index)]);

  return html;
}

/* ================= Helpers ================= */

function formatTime(ts) {
  return new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function timeAgo(ts) {
  const mins = Math.floor((Date.now() - ts) / 60000);
  if (mins < 1) return "now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const area = document.createElement("textarea");
    area.value = text;
    area.style.position = "fixed";
    area.style.opacity = "0";
    document.body.append(area);
    area.select();
    const ok = document.execCommand("copy");
    area.remove();
    return ok;
  }
}

function scrollToBottom(behavior = "smooth") {
  els.messages.scrollTo({ top: els.messages.scrollHeight, behavior });
  stickToBottom = true;
  els.scrollFab.hidden = true;
}

function updateFab() {
  const distance =
    els.messages.scrollHeight - els.messages.scrollTop - els.messages.clientHeight;
  stickToBottom = distance <= NEAR_BOTTOM;
  els.scrollFab.hidden = stickToBottom;
}

els.messages.addEventListener("scroll", updateFab, { passive: true });
els.scrollFab.addEventListener("click", () => scrollToBottom());

/* ================= Model bar ================= */

function renderModelBar() {
  els.modelTabs.replaceChildren();

  for (const model of MODELS) {
    const tab = document.createElement("button");
    tab.type = "button";
    tab.className = "mtab";
    tab.setAttribute("role", "tab");
    tab.dataset.id = model.id;
    tab.setAttribute("aria-selected", String(model.id === activeModel));
    tab.style.setProperty("--dot", model.dot);

    const dot = document.createElement("span");
    dot.className = "mtab__dot";

    const label = document.createElement("span");
    label.textContent = model.label;

    tab.append(dot, label);
    tab.addEventListener("click", () => setModel(model.id));
    els.modelTabs.append(tab);
  }

  requestAnimationFrame(moveIndicator);
}

function moveIndicator() {
  const active = els.modelTabs.querySelector('[aria-selected="true"]');
  if (!active) {
    els.indicator.classList.remove("is-ready");
    return;
  }

  els.indicator.style.width = `${active.offsetWidth}px`;
  els.indicator.style.transform = `translateX(${active.offsetLeft}px)`;
  els.indicator.classList.add("is-ready");
}

function setModel(id) {
  activeModel = id;
  renderModelBar();
  scheduleSave();
}

window.addEventListener("resize", moveIndicator);

/* ================= Messages ================= */

function createMessageNode(msg) {
  const node = document.createElement("article");
  node.dataset.id = msg.id;
  node.className = msg.role === "user" ? "msg msg--user" : "msg msg--ai";
  if (msg.error) node.classList.add("msg--error");

  const time = document.createElement("time");
  time.className = "msg__time";
  time.dateTime = new Date(msg.time).toISOString();
  time.textContent = formatTime(msg.time);

  if (msg.role === "user") {
    const bubble = document.createElement("div");
    bubble.className = "msg__bubble--user";
    bubble.textContent = msg.text;
    node.append(bubble, time);
    return node;
  }

  const model = modelById(msg.model);
  const head = document.createElement("div");
  head.className = "msg__head";

  const avatar = document.createElement("span");
  avatar.className = "msg__avatar";
  avatar.style.setProperty("--dot", model.dot);
  avatar.textContent = model.initial;

  const name = document.createElement("span");
  name.className = "msg__name";
  name.textContent = model.label;

  head.append(avatar, name, time);

  const bubble = document.createElement("div");
  bubble.className = "msg__bubble--ai";
  bubble.innerHTML = renderMarkdown(msg.text);

  const actions = document.createElement("div");
  actions.className = "msg__actions";

  const buttons = [
    { icon: "👍", label: "Helpful", field: "up" },
    { icon: "👎", label: "Not helpful", field: "down", extra: "act--down" },
    { icon: "📋", label: "Copy" },
    { icon: "🔄", label: "Regenerate", id: "regen" }
  ];

  for (const spec of buttons) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `act${spec.extra ? ` ${spec.extra}` : ""}`;
    button.textContent = spec.icon;
    button.title = spec.label;
    button.setAttribute("aria-label", spec.label);

    if (spec.field) {
      button.setAttribute("aria-pressed", String(msg.feedback === spec.field));
      button.addEventListener("click", () => {
        const next = msg.feedback === spec.field ? null : spec.field;
        msg.feedback = next;
        button.setAttribute("aria-pressed", String(next === spec.field));
        for (const sibling of actions.querySelectorAll(".act[aria-pressed]")) {
          if (sibling !== button) sibling.setAttribute("aria-pressed", "false");
        }
        scheduleSave();
      });
    }

    if (spec.id === "regen") {
      button.addEventListener("click", () => regenerate(msg));
    }

    actions.append(button);
  }

  const copy = actions.querySelector('button[aria-label="Copy"]');
  copy.addEventListener("click", async () => {
    await copyText(msg.text);
    copy.textContent = "✅";
    setTimeout(() => (copy.textContent = "📋"), 1200);
  });

  node.append(head, bubble, actions);
  return node;
}

function renderMessages() {
  const conversation = activeConversation();
  els.messages.replaceChildren();

  if (conversation.messages.length === 0) {
    els.emptyState.classList.remove("hidden");
    els.messages.append(els.emptyState);
    els.scrollFab.hidden = true;
    return;
  }

  els.emptyState.classList.add("hidden");
  for (const msg of conversation.messages) {
    els.messages.append(createMessageNode(msg));
  }
  requestAnimationFrame(() => scrollToBottom("auto"));
}

function pushMessage(msg) {
  const conversation = activeConversation();
  const record = {
    id: msg.id || crypto.randomUUID(),
    role: msg.role,
    model: msg.model || activeModel,
    text: msg.text || "",
    time: msg.time || Date.now(),
    feedback: null,
    error: Boolean(msg.error)
  };

  conversation.messages.push(record);
  conversation.updatedAt = record.time;

  if (record.role === "user" && conversation.messages.filter((m) => m.role === "user").length === 1) {
    conversation.title = record.text.slice(0, 42).trim() || "New Chat";
    els.chatTitle.textContent = conversation.title;
  }

  els.emptyState.classList.add("hidden");
  els.messages.append(createMessageNode(record));
  if (stickToBottom) scrollToBottom();
  scheduleSave();

  return record;
}

/* Typing indicator */
function showTyping() {
  hideTyping();
  const node = document.createElement("div");
  node.className = "typing";
  node.id = "typingIndicator";
  node.innerHTML =
    '<span class="typing__dots"><i></i><i></i><i></i></span>' +
    `<span>${modelById(activeModel).label} is thinking...</span>`;
  els.messages.append(node);
  if (stickToBottom) scrollToBottom();
}

function hideTyping() {
  document.getElementById("typingIndicator")?.remove();
}

/* ================= Send / stream ================= */

function buildPrompt(text) {
  const parts = [text];

  if (includePageContext) {
    parts.push("(Context toggle was on for this message.)");
  }

  if (attachments.length) {
    const dump = attachments
      .map((file) => `\n--- ${file.name} ---\n${file.text ?? "(binary file, no text)"}`)
      .join("\n");
    parts.push(`Attached files:\n${dump}`);
  }

  return parts.join("\n\n");
}

async function readPageContext() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) return "";
    const res = await chrome.tabs.sendMessage(tab.id, { type: "GET_PAGE_TEXT" });
    return res?.text || "";
  } catch {
    return "";
  }
}

function setStatus(next) {
  status = next;
  els.send.classList.toggle("is-loading", next === "loading");
  els.send.classList.toggle("is-streaming", next === "streaming");
  els.send.disabled = next === "idle" ? els.input.value.trim().length === 0 : false;
  els.send.setAttribute(
    "aria-label",
    next === "loading" ? "Stop generating" : next === "streaming" ? "Stop generating" : "Send message"
  );
}

async function send(rawText) {
  if (status !== "idle") return;

  const text = (rawText ?? els.input.value).trim();
  if (!text) return;

  abortRequested = false;
  setStatus("loading");

  const context = includePageContext ? await readPageContext() : "";
  const fullPrompt = context ? `${text}\n\nPage context:\n${context}` : text;

  pushMessage({ role: "user", text: fullPrompt });
  els.input.value = "";
  autoResize();
  updateCounter();
  setStatus("loading");

  showTyping();

  let reply = null;
  let failed = false;

  try {
    reply = await chrome.runtime.sendMessage({
      type: "CHAT_REQUEST",
      payload: {
        model: activeModel,
        title: activeConversation().title,
        messages: activeConversation().messages.map((m) => ({
          role: m.role,
          text: m.text
        }))
      }
    });
  } catch (err) {
    failed = true;
    reply = { text: err?.message || "Could not reach the model." };
  }

  hideTyping();

  if (abortRequested && !failed) {
    setStatus("idle");
    return;
  }

  const record = pushMessage({
    role: "assistant",
    model: activeModel,
    text: "",
    error: failed || reply?.error
  });

  if (!record.text) {
    record.text = reply?.text || "No response received.";
  }

  setStatus("streaming");
  await streamInto(record);

  setStatus("idle");
  scheduleSave();
}

async function streamInto(record) {
  const node = els.messages.querySelector(`[data-id="${record.id}"]`);
  const bubble = node?.querySelector(".msg__bubble--ai");
  if (!bubble) return;

  const full = record.text;
  const step = Math.max(2, Math.ceil(full.length / 220));
  let shown = 0;

  record.text = "";

  while (shown < full.length) {
    if (abortRequested) {
      record.text = full.slice(0, shown);
      bubble.innerHTML = renderMarkdown(record.text);
      scheduleSave();
      return;
    }

    shown = Math.min(full.length, shown + step);
    record.text = full.slice(0, shown);
    bubble.innerHTML = renderMarkdown(record.text);

    if (stickToBottom) {
      els.messages.scrollTop = els.messages.scrollHeight;
    }

    await new Promise((resolve) => setTimeout(resolve, 12));
  }

  record.text = full;
  bubble.innerHTML = renderMarkdown(full);
  scheduleSave();
}

function stopGeneration() {
  if (status === "idle") return;
  abortRequested = true;
  hideTyping();
  setStatus("idle");
  scheduleSave();
}

async function regenerate(message) {
  if (status !== "idle") return;

  const conversation = activeConversation();
  const index = conversation.messages.findIndex((m) => m.id === message.id);
  if (index === -1) return;

  conversation.messages.splice(index, 1);
  renderMessages();

  abortRequested = false;
  setStatus("loading");
  showTyping();

  let reply = null;
  let failed = false;

  try {
    reply = await chrome.runtime.sendMessage({
      type: "CHAT_REQUEST",
      payload: {
        model: activeModel,
        title: conversation.title,
        messages: conversation.messages.map((m) => ({ role: m.role, text: m.text }))
      }
    });
  } catch (err) {
    failed = true;
    reply = { text: err?.message || "Could not reach the model." };
  }

  hideTyping();

  if (abortRequested) {
    setStatus("idle");
    return;
  }

  const record = pushMessage({
    role: "assistant",
    model: activeModel,
    text: reply?.text || "No response received.",
    error: failed || reply?.error
  });

  setStatus("streaming");
  await streamInto(record);
  setStatus("idle");
}

els.send.addEventListener("click", () => {
  if (status === "idle") send();
  else stopGeneration();
});

/* Code block copy (delegated) */
els.messages.addEventListener("click", (event) => {
  const button = event.target.closest(".codeblock__copy");
  if (!button) return;

  const code = button.closest(".codeblock")?.querySelector("pre code")?.textContent || "";
  copyText(code).then((ok) => {
    button.textContent = ok ? "Copied" : "Failed";
    button.classList.add("is-copied");
    setTimeout(() => {
      button.textContent = "Copy";
      button.classList.remove("is-copied");
    }, 1400);
  });
});

/* ================= Composer ================= */

function autoResize() {
  const style = window.getComputedStyle(els.input);
  const lineHeight = parseFloat(style.lineHeight) || 20;
  const chrome = ["paddingTop", "paddingBottom", "borderTopWidth", "borderBottomWidth"].reduce(
    (sum, prop) => sum + (parseFloat(style[prop]) || 0),
    0
  );
  const max = lineHeight * MAX_ROWS + chrome;

  els.input.style.height = "auto";
  const next = Math.min(els.input.scrollHeight, max);
  els.input.style.height = `${next}px`;
  els.input.style.overflowY = els.input.scrollHeight > max ? "auto" : "hidden";
}

function updateCounter() {
  const length = els.input.value.length;
  els.counter.textContent = `${length}/${MAX_CHARS}`;
  els.counter.classList.toggle("is-over", length >= MAX_CHARS);
}

function updateComposerState() {
  if (status === "idle") {
    els.send.disabled = els.input.value.trim().length === 0;
  }
  updateCounter();
  autoResize();
}

els.input.addEventListener("input", updateComposerState);

els.input.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
    event.preventDefault();
    send();
  }
});

els.contextToggle.addEventListener("click", () => {
  includePageContext = !includePageContext;
  els.contextToggle.setAttribute("aria-pressed", String(includePageContext));
  scheduleSave();
});

/* ================= Attachments ================= */

function renderAttachments() {
  els.attachments.replaceChildren();

  for (const [index, file] of attachments.entries()) {
    const chip = document.createElement("span");
    chip.className = "attach";

    const name = document.createElement("span");
    name.textContent = file.name;

    const remove = document.createElement("button");
    remove.type = "button";
    remove.textContent = "×";
    remove.title = `Remove ${file.name}`;
    remove.addEventListener("click", () => {
      attachments.splice(index, 1);
      renderAttachments();
    });

    chip.append(name, remove);
    els.attachments.append(chip);
  }
}

els.attach.addEventListener("click", () => els.fileInput.click());

els.fileInput.addEventListener("change", async () => {
  for (const file of els.fileInput.files) {
    let text = null;
    if (file.size < 262144 && /^(text|application)\//.test(file.type + "text/")) {
      try {
        text = await file.text();
      } catch {
        text = null;
      }
    }
    attachments.push({ name: file.name, size: file.size, text });
  }

  els.fileInput.value = "";
  renderAttachments();
});

/* ================= Empty state ================= */

els.emptyState.addEventListener("click", (event) => {
  const chip = event.target.closest("[data-suggest]");
  if (!chip) return;
  els.input.value = chip.dataset.suggest;
  updateComposerState();
  els.input.focus();
});

/* ================= Title ================= */

els.chatTitle.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    event.preventDefault();
    els.chatTitle.blur();
  }
  if (event.key === "Escape") {
    els.chatTitle.textContent = activeConversation().title;
    els.chatTitle.blur();
  }
});

els.chatTitle.addEventListener("blur", () => {
  const title = els.chatTitle.textContent.trim().slice(0, 60) || "New Chat";
  els.chatTitle.textContent = title;
  activeConversation().title = title;
  scheduleSave();
});

/* ================= Navigation ================= */

async function openPage(path) {
  await chrome.tabs.create({ url: chrome.runtime.getURL(path) });
  window.close();
}

els.openHistory.addEventListener("click", () => openPage("history/history.html"));
els.openSettings.addEventListener("click", () => openPage("settings/settings.html"));

els.newChat.addEventListener("click", () => {
  const conversation = newConversation();
  conversations[conversation.id] = conversation;
  activeId = conversation.id;
  attachments = [];
  renderAttachments();
  els.chatTitle.textContent = conversation.title;
  renderMessages();
  els.input.focus();
  scheduleSave();
});

/* ================= Messages from popup ================= */

chrome.runtime.onMessage.addListener((message) => {
  if (message?.type !== "SIDEBAR_PROMPT") return;
  if (status !== "idle") return;

  const prompt = message.payload?.prompt;
  if (!prompt) return;

  if (message.payload?.command === "SUMMARIZE" || message.payload?.command === "SEARCH") {
    includePageContext = true;
    els.contextToggle.setAttribute("aria-pressed", "true");
  }

  send(prompt);
  scheduleSave();
});

/* ================= Init ================= */

async function init() {
  await loadState();
  renderModelBar();
  renderMessages();
  updateComposerState();
  scrollToBottom("auto");
}

init();
