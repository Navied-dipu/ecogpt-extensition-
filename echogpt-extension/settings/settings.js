const DEFAULTS = {
  settings: { theme: "system", temperature: 0.7, maxTokens: 2048 },
  apiKeys: { chatgpt: "", claude: "", gemini: "" }
};

const KEY_FIELDS = {
  keyChatgpt: "chatgpt",
  keyClaude: "claude",
  keyGemini: "gemini"
};

const els = {
  themeSelect: document.getElementById("themeSelect"),
  temperature: document.getElementById("temperature"),
  maxTokens: document.getElementById("maxTokens"),
  save: document.getElementById("save"),
  reset: document.getElementById("reset"),
  status: document.getElementById("status"),
  themeToggle: document.getElementById("themeToggle")
};

function applyTheme(theme) {
  const resolved =
    theme === "system"
      ? window.matchMedia("(prefers-color-scheme: dark)").matches
        ? "dark"
        : "light"
      : theme;
  document.documentElement.dataset.theme = resolved;
}

function showStatus(text) {
  els.status.textContent = text;
  els.status.classList.remove("hidden");
  setTimeout(() => els.status.classList.add("hidden"), 1800);
}

async function load() {
  const { settings = DEFAULTS.settings, apiKeys = {} } = await chrome.storage.local.get([
    "settings",
    "apiKeys"
  ]);

  els.themeSelect.value = settings.theme;
  els.temperature.value = settings.temperature;
  els.maxTokens.value = settings.maxTokens;
  applyTheme(settings.theme);

  for (const [id, model] of Object.entries(KEY_FIELDS)) {
    document.getElementById(id).value = apiKeys[model] || "";
  }
}

async function save() {
  const apiKeys = {};
  for (const [id, model] of Object.entries(KEY_FIELDS)) {
    apiKeys[model] = document.getElementById(id).value.trim();
  }

  const settings = {
    theme: els.themeSelect.value,
    temperature: Number(els.temperature.value),
    maxTokens: Number(els.maxTokens.value)
  };

  await chrome.storage.local.set({ settings, apiKeys });
  applyTheme(settings.theme);
  showStatus("Saved");
}

async function reset() {
  await chrome.storage.local.set(DEFAULTS);
  await load();
  showStatus("Reset to defaults");
}

els.save.addEventListener("click", save);
els.reset.addEventListener("click", reset);
els.themeSelect.addEventListener("change", async () => {
  applyTheme(els.themeSelect.value);
  await chrome.storage.local.set({
    settings: { ...DEFAULTS.settings, theme: els.themeSelect.value }
  });
});
els.themeToggle.addEventListener("click", async () => {
  const next = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
  applyTheme(next);
  await chrome.storage.local.set({ settings: { ...DEFAULTS.settings, theme: next } });
  els.themeSelect.value = next;
});

load();
