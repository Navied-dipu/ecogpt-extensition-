const KEY = "chatHistory";

const els = {
  list: document.getElementById("list"),
  empty: document.getElementById("empty"),
  search: document.getElementById("search"),
  clearAll: document.getElementById("clearAll")
};

let entries = [];

function formatTime(ts) {
  return new Date(ts).toLocaleString();
}

function render() {
  const query = els.search.value.trim().toLowerCase();
  const filtered = query
    ? entries.filter(
        (e) =>
          e.prompt.toLowerCase().includes(query) || e.model.toLowerCase().includes(query)
      )
    : entries;

  els.list.replaceChildren();
  els.empty.classList.toggle("hidden", filtered.length > 0);
  els.empty.textContent = entries.length
    ? "No matching conversations."
    : "No conversations yet.";

  for (const entry of filtered) {
    const li = document.createElement("li");
    li.className = "history-item";

    const body = document.createElement("div");
    body.className = "history-body-text";

    const prompt = document.createElement("p");
    prompt.className = "history-prompt";
    prompt.textContent = entry.prompt;

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
    });

    li.append(body, badge, del);
    els.list.append(li);
  }
}

async function persist() {
  await chrome.storage.local.set({ [KEY]: entries });
}

els.search.addEventListener("input", render);

els.clearAll.addEventListener("click", async () => {
  entries = [];
  await persist();
  render();
});

async function init() {
  const { theme = "system" } = await chrome.storage.local.get("theme");
  const resolved =
    theme === "system"
      ? window.matchMedia("(prefers-color-scheme: dark)").matches
        ? "dark"
        : "light"
      : theme;
  document.documentElement.dataset.theme = resolved;

  const stored = await chrome.storage.local.get(KEY);
  entries = stored[KEY] || [];
  render();
}

init();
