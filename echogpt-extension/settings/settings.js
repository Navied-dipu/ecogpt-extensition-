const MODELS = [
  { id: "gpt-4o", name: "GPT-4o", provider: "OpenAI", color: "#10a37f", best: "Complex reasoning" },
  { id: "gemini-pro", name: "Gemini Pro", provider: "Google", color: "#4285f4", best: "Long context" },
  { id: "claude-3.5", name: "Claude 3.5", provider: "Anthropic", color: "#d97757", best: "Writing & code" },
  { id: "llama-3", name: "Llama 3", provider: "Meta", color: "#7c3aed", best: "Fast & open weights" },
  { id: "mistral", name: "Mistral", provider: "Mistral AI", color: "#f97316", best: "Speed" },
  { id: "grok", name: "Grok", provider: "xAI", color: "#64748b", best: "Realtime trends", comingSoon: true }
];

const SHORTCUTS = [
  { action: "Open Sidebar", keys: ["Ctrl", "Shift", "E"] },
  { action: "New Chat", keys: ["Ctrl", "N"] },
  { action: "Clear Chat", keys: ["Ctrl", "L"] },
  { action: "Focus Input", keys: ["/"] },
  { action: "Toggle Theme", keys: ["Ctrl", "Shift", "D"] }
];

const DEFAULT_ENDPOINT = "https://api.echogpt.app/v1/chat";
const FONT_SIZES = ["small", "medium", "large"];
const TEMPERATURE_LABELS = { "0.1": "Precise", "0.5": "Balanced", "1.0": "Creative" };
const AVATAR_COLORS = ["#7c3aed", "#2563eb", "#0ea5e9", "#10b981", "#f97316", "#ec4899", "#ef4444"];
const EXTERNAL = { privacy: "https://echogpt.app/privacy", upgrade: "https://echogpt.app/upgrade" };

const DEFAULTS = {
  account: { name: "", email: "", plan: "free", avatarColor: AVATAR_COLORS[0] },
  models: { enabled: ["gpt-4o", "gemini-pro", "claude-3.5", "llama-3", "mistral"], default: "gpt-4o" },
  appearance: { theme: "system", fontSize: "medium", bubbleStyle: "modern", sidebarWidth: "default", animations: true },
  api: { endpoint: DEFAULT_ENDPOINT, timeout: 30, maxTokens: 2048, temperature: 0.7, stream: true },
  privacy: { sendPageContent: true, saveHistory: true, analytics: false }
};

const SYNC_KEYS = ["account", "models", "appearance", "api", "privacy"];

const els = {
  backBtn: document.getElementById("backBtn"),
  saveBtn: document.getElementById("saveBtn"),
  dirtyDot: document.getElementById("dirtyDot"),
  nav: document.querySelector(".nav"),
  navMarker: document.getElementById("navMarker"),
  panels: document.getElementById("panels"),
  toast: document.getElementById("toast"),
  toastIcon: document.getElementById("toastIcon"),
  toastText: document.getElementById("toastText"),
  confirm: document.getElementById("confirm"),
  confirmTitle: document.getElementById("confirmTitle"),
  confirmBody: document.getElementById("confirmBody"),
  confirmOk: document.getElementById("confirmOk"),
  confirmCancel: document.getElementById("confirmCancel"),
  avatar: document.getElementById("avatar"),
  changeAvatar: document.getElementById("changeAvatar"),
  planBadge: document.getElementById("planBadge"),
  userName: document.getElementById("userName"),
  userEmail: document.getElementById("userEmail"),
  emailHint: document.getElementById("emailHint"),
  upgradeBlock: document.getElementById("upgradeBlock"),
  upgradeBtn: document.getElementById("upgradeBtn"),
  signOut: document.getElementById("signOut"),
  deleteAccount: document.getElementById("deleteAccount"),
  defaultModel: document.getElementById("defaultModel"),
  modelList: document.getElementById("modelList"),
  themeCards: document.getElementById("themeCards"),
  fontSize: document.getElementById("fontSize"),
  fontSizeLabel: document.getElementById("fontSizeLabel"),
  bubbleStyles: document.getElementById("bubbleStyles"),
  sidebarWidth: document.getElementById("sidebarWidth"),
  animations: document.getElementById("animations"),
  endpoint: document.getElementById("endpoint"),
  endpointHint: document.getElementById("endpointHint"),
  resetEndpoint: document.getElementById("resetEndpoint"),
  apiKey: document.getElementById("apiKey"),
  toggleKey: document.getElementById("toggleKey"),
  testConn: document.getElementById("testConn"),
  timeout: document.getElementById("timeout"),
  timeoutValue: document.getElementById("timeoutValue"),
  maxTokens: document.getElementById("maxTokens"),
  temperature: document.getElementById("temperature"),
  tempValue: document.getElementById("tempValue"),
  stream: document.getElementById("stream"),
  shortcutList: document.getElementById("shortcutList"),
  customizeShortcuts: document.getElementById("customizeShortcuts"),
  sendPageContent: document.getElementById("sendPageContent"),
  saveHistory: document.getElementById("saveHistory"),
  analytics: document.getElementById("analytics"),
  exportData: document.getElementById("exportData"),
  clearHistory: document.getElementById("clearHistory"),
  privacyLink: document.getElementById("privacyLink")
};

let state = structuredClone(DEFAULTS);
let apiKeyValue = "";
let dirty = false;
let toastTimer = null;

/* ================= Theme ================= */

function resolveTheme(theme) {
  if (theme === "light" || theme === "dark") return theme;
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function applyTheme(theme) {
  document.documentElement.dataset.theme = resolveTheme(theme);
}

window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
  if (state.appearance.theme === "system") applyTheme("system");
});

/* ================= Toast ================= */

const ICONS = {
  ok: '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" aria-hidden="true"><path d="M12 2.5a9.5 9.5 0 1 1 0 19 9.5 9.5 0 0 1 0-19Z" fill="currentColor" opacity=".18"/><path d="m8 12.4 2.6 2.6L16 9.6" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  error:
    '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" aria-hidden="true"><path d="M12 2.5a9.5 9.5 0 1 1 0 19 9.5 9.5 0 0 1 0-19Z" fill="currentColor" opacity=".18"/><path d="M12 7.5v5.2M12 16.4v.1" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>'
};

function showToast(text, variant = "ok") {
  clearTimeout(toastTimer);
  els.toastText.textContent = text;
  els.toastIcon.innerHTML = ICONS[variant] || ICONS.ok;
  els.toast.className = `toast is-${variant}`;
  els.toast.hidden = false;

  // restart the CSS animation
  els.toast.style.animation = "none";
  void els.toast.offsetHeight;
  els.toast.style.animation = "";

  toastTimer = setTimeout(() => {
    els.toast.hidden = true;
  }, 2400);
}

/* ================= Confirm dialog ================= */

function confirmDialog({ title, body, okLabel = "Confirm" }) {
  return new Promise((resolve) => {
    els.confirmTitle.textContent = title;
    els.confirmBody.textContent = body;
    els.confirmOk.textContent = okLabel;
    els.confirm.hidden = false;
    els.confirmOk.focus();

    const done = (value) => {
      els.confirm.hidden = true;
      els.confirmOk.removeEventListener("click", onOk);
      els.confirmCancel.removeEventListener("click", onCancel);
      document.removeEventListener("keydown", onKey);
      resolve(value);
    };
    const onOk = () => done(true);
    const onCancel = () => done(false);
    const onKey = (event) => {
      if (event.key === "Escape") done(false);
      if (event.key === "Enter") done(true);
    };

    els.confirmOk.addEventListener("click", onOk);
    els.confirmCancel.addEventListener("click", onCancel);
    document.addEventListener("keydown", onKey);
  });
}

/* ================= Dirty tracking ================= */

function setDirty(value) {
  dirty = value;
  els.dirtyDot.hidden = !value;
}

function markDirty() {
  setDirty(true);
}

/* ================= Tabs ================= */

function moveMarker() {
  const active = els.nav.querySelector(".nav__item.is-active");
  if (!active) return;
  if (window.matchMedia("(max-width: 620px)").matches) return;

  els.navMarker.hidden = false;
  els.navMarker.style.height = `${active.offsetHeight}px`;
  els.navMarker.style.transform = `translateY(${active.offsetTop}px)`;
}

function activateTab(name) {
  const current = els.panels.querySelector(".panel.is-active");
  const next = document.getElementById(`panel-${name}`);
  if (!next || current === next) return;

  if (current) {
    current.classList.add("is-leaving");
    setTimeout(() => current.classList.remove("is-leaving"), 160);
    current.classList.remove("is-active");
  }

  next.classList.add("is-active");
  next.querySelectorAll(".block").forEach((block, i) => {
    block.style.setProperty("--i", String(i));
  });

  for (const item of els.nav.querySelectorAll(".nav__item")) {
    const on = item.dataset.tab === name;
    item.classList.toggle("is-active", on);
    item.setAttribute("aria-selected", String(on));
  }

  history.replaceState(null, "", `#${name}`);
  moveMarker();
}

els.nav.addEventListener("click", (event) => {
  const item = event.target.closest(".nav__item");
  if (item) activateTab(item.dataset.tab);
});

window.addEventListener("resize", moveMarker);

/* ================= Rendering ================= */

function renderAccount() {
  const { name, email, plan, avatarColor } = state.account;

  const initial = (name || email || "?").charAt(0).toUpperCase();
  els.avatar.textContent = initial;
  els.avatar.style.background = `linear-gradient(135deg, ${avatarColor}, #2563eb)`;

  els.userName.value = name;
  els.userEmail.value = email;
  els.emailHint.hidden = Boolean(email);

  els.planBadge.textContent = plan === "pro" ? "Pro" : "Free";
  els.planBadge.dataset.plan = plan === "pro" ? "Pro" : "Free";
  els.upgradeBlock.hidden = plan === "pro";
}

function renderModels() {
  const { enabled, default: defaultId } = state.models;
  const live = MODELS.filter((m) => !m.comingSoon);
  const usable = enabled.filter((id) => live.some((m) => m.id === id));

  els.defaultModel.replaceChildren();
  for (const model of live) {
    if (!enabled.includes(model.id)) continue;
    const option = document.createElement("option");
    option.value = model.id;
    option.textContent = model.name;
    els.defaultModel.append(option);
  }
  els.defaultModel.value = usable.includes(defaultId) ? defaultId : usable[0] || "";
  els.defaultModel.disabled = usable.length === 0;

  els.modelList.replaceChildren();
  for (const model of MODELS) {
    const on = enabled.includes(model.id);
    const isDefault = state.models.default === model.id;

    const li = document.createElement("li");
    li.className = `model${on ? "" : " is-off"}${isDefault ? " is-default" : ""}`;

    const avatar = document.createElement("span");
    avatar.className = "model__avatar";
    avatar.style.setProperty("--dot", model.color);
    avatar.textContent = model.name.charAt(0);

    const info = document.createElement("div");
    info.className = "model__info";

    const nameRow = document.createElement("div");
    nameRow.className = "model__name";
    const label = document.createElement("span");
    label.textContent = model.name;
    const provider = document.createElement("span");
    provider.className = "model__provider";
    provider.textContent = `· ${model.provider}`;
    nameRow.append(label, provider);

    if (model.comingSoon) {
      const soon = document.createElement("span");
      soon.className = "badge-soon";
      soon.textContent = "Coming Soon";
      nameRow.append(soon);
    }

    const tag = document.createElement("span");
    tag.className = "model__tag";
    tag.textContent = `Best for: ${model.best}`;

    info.append(nameRow, tag);

    const star = document.createElement("button");
    star.type = "button";
    star.className = "model__star";
    star.title = isDefault ? "Default model" : `Set ${model.name} as default`;
    star.setAttribute("aria-label", `Set ${model.name} as default`);
    star.setAttribute("aria-pressed", String(isDefault));
    star.disabled = model.comingSoon;
    star.innerHTML =
      '<svg viewBox="0 0 24 24" width="15" height="15" fill="none"><path d="m12 3.8 2.5 5.1 5.6.8-4 3.9 1 5.6-5.1-2.7-5 2.7 1-5.6-4.1-3.9 5.6-.8L12 3.8Z" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/></svg>';
    star.addEventListener("click", () => {
      state.models.default = model.id;
      markDirty();
      renderModels();
    });

    const toggle = document.createElement("label");
    toggle.className = "switch";
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = on;
    checkbox.disabled = Boolean(model.comingSoon);
    checkbox.addEventListener("change", () => {
      const current = new Set(state.models.enabled);
      if (checkbox.checked) current.add(model.id);
      else current.delete(model.id);

      // never leave the default model disabled
      if (!current.has(state.models.default)) {
        state.models.default = MODELS.find((m) => current.has(m.id) && !m.comingSoon)?.id || "";
      }

      state.models.enabled = MODELS.filter((m) => current.has(m.id)).map((m) => m.id);
      markDirty();
      renderModels();
    });

    const track = document.createElement("span");
    track.className = "switch__track";
    track.innerHTML = '<span class="switch__thumb"></span>';

    const label2 = document.createElement("span");
    label2.className = "switch__label";
    label2.textContent = on ? "Enabled" : "Disabled";

    toggle.append(checkbox, track, label2);

    li.append(avatar, info, star, toggle);
    els.modelList.append(li);
  }
}

function renderAppearance() {
  const a = state.appearance;

  for (const card of els.themeCards.querySelectorAll(".theme")) {
    const on = card.dataset.themeValue === a.theme;
    card.setAttribute("aria-checked", String(on));
    if (on && !card.querySelector(".theme__check")) {
      const check = document.createElement("span");
      check.className = "theme__check";
      check.innerHTML =
        '<svg viewBox="0 0 24 24" width="10" height="10" fill="none"><path d="m5 12.5 4.5 4.5L19 7.5" stroke="#fff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg>';
      card.querySelector(".theme__preview").append(check);
    }
  }

  els.fontSize.value = String(FONT_SIZES.indexOf(a.fontSize));
  els.fontSizeLabel.textContent = a.fontSize.charAt(0).toUpperCase() + a.fontSize.slice(1);
  document.documentElement.dataset.fontSize = a.fontSize;

  for (const card of els.bubbleStyles.querySelectorAll(".bubble-card")) {
    card.setAttribute("aria-checked", String(card.dataset.bubble === a.bubbleStyle));
  }

  const width = els.sidebarWidth.querySelector(`input[value="${a.sidebarWidth}"]`);
  if (width) width.checked = true;

  els.animations.checked = a.animations;
  document.documentElement.dataset.animations = a.animations ? "on" : "off";
}

function renderApi() {
  const api = state.api;

  els.endpoint.value = api.endpoint;
  els.endpointHint.textContent = `Default: ${DEFAULT_ENDPOINT}`;

  els.timeout.value = String(api.timeout);
  els.timeoutValue.textContent = `${api.timeout}s`;

  els.maxTokens.value = String(api.maxTokens);

  els.temperature.value = String(api.temperature);
  els.tempValue.textContent =
    TEMPERATURE_LABELS[String(Number(api.temperature).toFixed(1))] ||
    `Value ${Number(api.temperature).toFixed(1)}`;

  els.stream.checked = api.stream;
}

function renderShortcuts() {
  els.shortcutList.replaceChildren();
  for (const shortcut of SHORTCUTS) {
    const li = document.createElement("li");
    li.className = "shortcut";

    const label = document.createElement("span");
    label.className = "shortcut__action";
    label.textContent = shortcut.action;

    const keys = document.createElement("span");
    keys.className = "shortcut__keys";
    for (const key of shortcut.keys) {
      const kbd = document.createElement("kbd");
      kbd.textContent = key;
      keys.append(kbd);
    }

    li.append(label, keys);
    els.shortcutList.append(li);
  }
}

function renderPrivacy() {
  els.sendPageContent.checked = state.privacy.sendPageContent;
  els.saveHistory.checked = state.privacy.saveHistory;
  els.analytics.checked = state.privacy.analytics;
}

function renderAll() {
  renderAccount();
  renderModels();
  renderAppearance();
  renderApi();
  renderShortcuts();
  renderPrivacy();
  applyTheme(state.appearance.theme);
}

/* ================= Persistence ================= */

async function load() {
  const stored = await chrome.storage.sync.get(SYNC_KEYS);
  for (const key of SYNC_KEYS) {
    if (stored[key]) state[key] = { ...structuredClone(DEFAULTS[key]), ...stored[key] };
  }

  const local = await chrome.storage.local.get(["apiKey"]);
  apiKeyValue = local.apiKey || "";
  els.apiKey.value = apiKeyValue;

  renderAll();
  setDirty(false);
}

async function save() {
  const payload = {};
  for (const key of SYNC_KEYS) payload[key] = state[key];

  await chrome.storage.sync.set(payload);
  // Keys never sync; preferences are mirrored locally so the popup and
  // side panel (which read chrome.storage.local) stay in sync.
  await chrome.storage.local.set({
    theme: state.appearance.theme,
    settings: {
      theme: state.appearance.theme,
      temperature: state.api.temperature,
      maxTokens: state.api.maxTokens,
      stream: state.api.stream,
      timeout: state.api.timeout
    },
    apiKey: apiKeyValue,
    apiKeys: { echogpt: apiKeyValue },
    enabled: state.models.enabled,
    activeModel: state.models.default,
    defaultModel: state.models.default,
    includePageContext: state.privacy.sendPageContent
  });

  applyTheme(state.appearance.theme);

  setDirty(false);
  els.saveBtn.classList.add("is-saved");
  showToast("Settings saved!", "ok");
  setTimeout(() => els.saveBtn.classList.remove("is-saved"), 1600);
}

/* ================= Events ================= */

els.saveBtn.addEventListener("click", save);

els.backBtn.addEventListener("click", () => {
  if (history.length > 1) history.back();
  else window.close();
});

/* Account */
els.userName.addEventListener("input", () => {
  state.account.name = els.userName.value;
  renderAccount();
  markDirty();
});

els.changeAvatar.addEventListener("click", () => {
  const index = AVATAR_COLORS.indexOf(state.account.avatarColor);
  state.account.avatarColor = AVATAR_COLORS[(index + 1) % AVATAR_COLORS.length];
  renderAccount();
  markDirty();
  els.avatar.classList.add("is-spin");
  setTimeout(() => els.avatar.classList.remove("is-spin"), 520);
});

els.upgradeBtn.addEventListener("click", () => chrome.tabs.create({ url: EXTERNAL.upgrade }));

els.signOut.addEventListener("click", async () => {
  const ok = await confirmDialog({
    title: "Sign out?",
    body: "Your synced settings stay on this device. You can sign back in at any time.",
    okLabel: "Sign out"
  });
  if (!ok) return;

  // Clear the account session so the sidebar and popup show the sign-in overlay again.
  try {
    await chrome.runtime.sendMessage({ type: "AUTH_SIGN_OUT" });
  } catch {
    await chrome.storage.local.remove(["authToken", "apiKey", "apiKeys", "user"]);
  }

  state.account = { ...DEFAULTS.account, name: "", email: "", plan: "free" };
  // save() mirrors the API key locally; clear it too so the sign-out sticks.
  apiKeyValue = "";
  els.apiKey.value = "";
  renderAccount();
  await save();
  showToast("Signed out", "ok");
});

els.deleteAccount.addEventListener("click", async () => {
  const ok = await confirmDialog({
    title: "Delete account?",
    body: "This permanently removes your synced settings and conversation history. This cannot be undone.",
    okLabel: "Delete account"
  });
  if (!ok) return;

  await chrome.storage.sync.clear();
  await chrome.storage.local.remove(["chatHistory", "conversations", "apiKey", "apiKeys", "user"]);
  state = structuredClone(DEFAULTS);
  apiKeyValue = "";
  els.apiKey.value = "";
  renderAll();
  setDirty(false);
  showToast("Account deleted", "ok");
});

/* Models */
els.defaultModel.addEventListener("change", () => {
  state.models.default = els.defaultModel.value;
  markDirty();
  renderModels();
});

/* Appearance */
els.themeCards.addEventListener("click", (event) => {
  const card = event.target.closest(".theme");
  if (!card) return;
  state.appearance.theme = card.dataset.themeValue;
  applyTheme(state.appearance.theme);
  markDirty();
  renderAppearance();
});

els.fontSize.addEventListener("input", () => {
  const value = FONT_SIZES[Number(els.fontSize.value)];
  state.appearance.fontSize = value;
  els.fontSizeLabel.textContent = value.charAt(0).toUpperCase() + value.slice(1);
  document.documentElement.dataset.fontSize = value;
  markDirty();
});

els.bubbleStyles.addEventListener("click", (event) => {
  const card = event.target.closest(".bubble-card");
  if (!card) return;
  state.appearance.bubbleStyle = card.dataset.bubble;
  markDirty();
  renderAppearance();
});

els.sidebarWidth.addEventListener("change", (event) => {
  if (event.target.name !== "width") return;
  state.appearance.sidebarWidth = event.target.value;
  markDirty();
});

els.animations.addEventListener("change", () => {
  state.appearance.animations = els.animations.checked;
  document.documentElement.dataset.animations = els.animations.checked ? "on" : "off";
  markDirty();
});

/* API */
els.endpoint.addEventListener("input", () => {
  state.api.endpoint = els.endpoint.value.trim();
  markDirty();
});

els.resetEndpoint.addEventListener("click", () => {
  state.api.endpoint = DEFAULT_ENDPOINT;
  els.endpoint.value = DEFAULT_ENDPOINT;
  markDirty();
  showToast("Endpoint reset", "ok");
});

els.apiKey.addEventListener("input", () => {
  apiKeyValue = els.apiKey.value.trim();
  markDirty();
});

els.toggleKey.addEventListener("click", () => {
  const shown = els.apiKey.type === "text";
  els.apiKey.type = shown ? "password" : "text";
  els.toggleKey.classList.toggle("is-on", !shown);
  els.toggleKey.setAttribute("aria-label", shown ? "Show API key" : "Hide API key");
});

els.testConn.addEventListener("click", async () => {
  const endpoint = state.api.endpoint || DEFAULT_ENDPOINT;
  let parsed;

  try {
    parsed = new URL(endpoint);
  } catch {
    showToast("Invalid endpoint URL", "error");
    return;
  }

  if (parsed.protocol !== "https:" && parsed.hostname !== "localhost") {
    showToast("Endpoint must use HTTPS", "error");
    return;
  }

  if (!apiKeyValue) {
    showToast("Add an API key first", "error");
    return;
  }

  els.testConn.disabled = true;
  const label = els.testConn.textContent;
  els.testConn.textContent = "Testing…";

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.min(state.api.timeout, 15) * 1000);

  try {
    const res = await fetch(parsed.href, {
      method: "OPTIONS",
      signal: controller.signal,
      headers: { Authorization: `Bearer ${apiKeyValue}` }
    });
    showToast(res.ok ? "Connection successful" : `Server replied ${res.status}`, res.ok ? "ok" : "error");
  } catch (err) {
    const message =
      err?.name === "AbortError" ? "Connection timed out" : "Could not reach endpoint";
    showToast(message, "error");
  } finally {
    clearTimeout(timer);
    els.testConn.disabled = false;
    els.testConn.textContent = label;
  }
});

els.timeout.addEventListener("input", () => {
  state.api.timeout = Number(els.timeout.value);
  els.timeoutValue.textContent = `${state.api.timeout}s`;
  markDirty();
});

els.maxTokens.addEventListener("input", () => {
  const value = Math.min(8000, Math.max(100, Number(els.maxTokens.value) || 100));
  state.api.maxTokens = value;
  markDirty();
});

els.maxTokens.addEventListener("blur", () => {
  els.maxTokens.value = String(state.api.maxTokens);
});

els.temperature.addEventListener("input", () => {
  const value = Number(els.temperature.value);
  state.api.temperature = value;
  const key = value.toFixed(1);
  els.tempValue.textContent = TEMPERATURE_LABELS[key] || `Value ${key}`;
  markDirty();
});

els.stream.addEventListener("change", () => {
  state.api.stream = els.stream.checked;
  markDirty();
});

/* Shortcuts */
els.customizeShortcuts.addEventListener("click", async () => {
  await chrome.tabs.create({ url: "chrome://extensions/shortcuts" });
  showToast("Edit shortcuts in chrome://extensions/shortcuts", "ok");
});

/* Privacy */
els.sendPageContent.addEventListener("change", () => {
  state.privacy.sendPageContent = els.sendPageContent.checked;
  markDirty();
});

els.saveHistory.addEventListener("change", () => {
  state.privacy.saveHistory = els.saveHistory.checked;
  markDirty();
});

els.analytics.addEventListener("change", () => {
  state.privacy.analytics = els.analytics.checked;
  markDirty();
});

els.privacyLink.addEventListener("click", (event) => {
  event.preventDefault();
  chrome.tabs.create({ url: EXTERNAL.privacy });
});

els.clearHistory.addEventListener("click", async () => {
  const ok = await confirmDialog({
    title: "Clear all history?",
    body: "Every saved conversation will be permanently deleted from this device.",
    okLabel: "Clear history"
  });
  if (!ok) return;

  await chrome.storage.local.remove(["chatHistory", "conversations"]);
  showToast("History cleared", "ok");
});

els.exportData.addEventListener("click", async () => {
  const { chatHistory = [], conversations = {} } = await chrome.storage.local.get([
    "chatHistory",
    "conversations"
  ]);

  const bundle = {
    exportedAt: new Date().toISOString(),
    version: chrome.runtime.getManifest().version,
    settings: state,
    history: chatHistory,
    conversations
  };

  const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);

  const link = document.createElement("a");
  link.href = url;
  link.download = `echogpt-export-${new Date().toISOString().slice(0, 10)}.json`;
  link.click();

  setTimeout(() => URL.revokeObjectURL(url), 4000);
  showToast("Data exported", "ok");
});

/* ================= Init ================= */

window.addEventListener("beforeunload", (event) => {
  if (!dirty) return;
  event.preventDefault();
  event.returnValue = "";
});

load().then(() => {
  const hash = location.hash.replace("#", "");
  if (hash && document.getElementById(`panel-${hash}`)) activateTab(hash);
  requestAnimationFrame(moveMarker);
});
