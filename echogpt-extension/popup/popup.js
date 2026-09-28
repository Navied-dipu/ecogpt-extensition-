const DEFAULT_MODELS = ["ChatGPT", "Claude", "Gemini", "Mistral", "Local"];

const els = {
  themeToggle: document.getElementById("themeToggle"),
  openSidebar: document.getElementById("openSidebar"),
  prompt: document.getElementById("prompt"),
  modelRow: document.getElementById("modelRow"),
  send: document.getElementById("send"),
  openHistory: document.getElementById("openHistory"),
  openSettings: document.getElementById("openSettings")
};

let enabledModels = new Set(DEFAULT_MODELS);

function applyTheme(theme) {
  document.documentElement.dataset.theme = theme === "dark" ? "dark" : "light";
}

async function loadSettings() {
  const { theme = "system", enabled = DEFAULT_MODELS, lastModels = [] } = await chrome.storage.local.get([
    "theme",
    "enabled",
    "lastModels"
  ]);

  const resolved =
    theme === "system"
      ? window.matchMedia("(prefers-color-scheme: dark)").matches
        ? "dark"
        : "light"
      : theme;

  applyTheme(resolved);
  enabledModels = new Set(Array.isArray(enabled) && enabled.length ? enabled : DEFAULT_MODELS);
  await chrome.storage.local.set({ lastModels: Array.from(enabledModels) });
  renderModels();
}

function renderModels() {
  els.modelRow.replaceChildren();
  for (const model of enabledModels) {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "model-chip";
    chip.textContent = model;
    chip.setAttribute("aria-pressed", "true");
    chip.addEventListener("click", () => {
      const on = chip.getAttribute("aria-pressed") === "true";
      chip.setAttribute("aria-pressed", String(!on));
    });
    els.modelRow.append(chip);
  }
}

async function openPage(path) {
  await chrome.tabs.create({ url: chrome.runtime.getURL(path) });
  window.close();
}

els.themeToggle.addEventListener("click", async () => {
  const next = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
  applyTheme(next);
  await chrome.storage.local.set({ theme: next });
});

els.openSidebar.addEventListener("click", async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab?.windowId !== undefined) {
    await chrome.sidePanel.open({ windowId: tab.windowId });
  }
  window.close();
});

els.send.addEventListener("click", async () => {
  const prompt = els.prompt.value.trim();
  if (!prompt) return;

  const selected = Array.from(
    els.modelRow.querySelectorAll('.model-chip[aria-pressed="true"]')
  ).map((el) => el.textContent);

  await chrome.runtime.sendMessage({
    type: "NEW_CHAT",
    payload: { prompt, models: selected, tabId: null }
  });

  els.prompt.value = "";
});

els.openHistory.addEventListener("click", (event) => {
  event.preventDefault();
  openPage("history/history.html");
});

els.openSettings.addEventListener("click", (event) => {
  event.preventDefault();
  openPage("settings/settings.html");
});

loadSettings();
