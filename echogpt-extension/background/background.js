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

  // Seed the synced theme once so every page resolves prefers-color-scheme the
  // same way from the very first launch.
  const { appearance = {} } = await chrome.storage.sync.get(["appearance"]);
  if (!appearance.theme) {
    await chrome.storage.sync.set({ appearance: { ...appearance, theme: "system" } });
  }

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

    case "AUTH_SESSION":
      getSession()
        .then(sendResponse)
        .catch((err) => sendResponse({ ok: false, code: err.code || "unknown" }));
      return true;

    case "AUTH_VERIFY":
      verifyToken(message.payload?.token)
        .then(sendResponse)
        .catch((err) => sendResponse({ ok: false, valid: false, code: err.code || "unknown" }));
      return true;

    case "AUTH_GOOGLE":
      signInWithGoogle()
        .then((user) => sendResponse({ ok: true, user }))
        .catch((err) => sendResponse({ ok: false, code: err.code || "unknown", message: err.message }));
      return true;

    case "AUTH_LOGIN":
      signInWithPassword(message.payload)
        .then((user) => sendResponse({ ok: true, user }))
        .catch((err) => sendResponse({ ok: false, code: err.code || "unknown", message: err.message }));
      return true;

    case "AUTH_PROFILE":
      refreshProfile()
        .then((user) => sendResponse({ ok: true, user }))
        .catch((err) => sendResponse({ ok: false, code: err.code || "unknown" }));
      return true;

    case "AUTH_SIGN_OUT":
      signOut(message.payload)
        .then(() => sendResponse({ ok: true }))
        .catch((err) => sendResponse({ ok: false, code: err.code || "unknown" }));
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

/* ================= Authentication ================= */

const AUTH_BASE = "https://api.echogpt.live";
const AUTH_TIMEOUT_MS = 20000;
const AUTH_CREDENTIAL_KEYS = ["authToken", "apiKey", "apiKeys", "user"];
const AUTH_HISTORY_KEYS = [HISTORY_KEY, "conversations", "activeConversationId"];
const USER_KEY = "user";

/** Auth failure with a machine-readable code the UI maps to copy. */
class AuthError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "AuthError";
    this.code = code;
  }
}

/**
 * Read the current auth state from storage without hitting the network.
 * @returns {Promise<{ok: boolean, signedIn: boolean, user: Object|null}>} Session snapshot
 */
async function getSession() {
  const stored = await chrome.storage.local.get(["authToken", USER_KEY]);
  const signedIn = Boolean(stored.authToken);
  return { ok: true, signedIn, user: signedIn ? stored[USER_KEY] || null : null };
}

/**
 * Perform an authenticated JSON request against the EchoGPT auth API.
 * @param {string} path - Path such as "/auth/login"
 * @param {Object} [options] - {method, body, token, timeout}
 * @returns {Promise<Response>} The raw response
 */
async function authFetch(path, { method = "GET", body, token, timeout = AUTH_TIMEOUT_MS } = {}) {
  const headers = { "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);

  try {
    return await fetch(`${AUTH_BASE}${path}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal
    });
  } catch (err) {
    if (err?.name === "AbortError") throw new AuthError("timeout", "The request timed out.");
    throw new AuthError("network", "Could not reach the EchoGPT API.");
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Parse a JSON body, tolerating empty or non-JSON responses.
 * @param {Response} response - The response to read
 * @returns {Promise<Object>} Parsed body, or an empty object
 */
async function readJson(response) {
  try {
    const text = await response.text();
    return text ? JSON.parse(text) : {};
  } catch {
    return {};
  }
}

/**
 * Map an HTTP status to an AuthError code.
 * @param {Response} response - The failed response
 * @param {Object} payload - The already-parsed body
 * @returns {AuthError} The mapped error
 */
function toAuthError(response, payload) {
  const detail = payload?.error?.message || payload?.message || "";

  if (response.status === 401 || response.status === 403) {
    return new AuthError("invalid-credentials", detail || "Invalid email or password.");
  }
  if (response.status === 404) {
    return new AuthError("not-found", detail || "No account found.");
  }
  if (response.status === 429) {
    return new AuthError("rate-limit", detail || "Too many attempts. Wait a moment.");
  }
  if (response.status >= 500) {
    return new AuthError("server", detail || "The sign-in service is unavailable.");
  }
  return new AuthError("unknown", detail || `HTTP ${response.status}`);
}

/**
 * Normalize an API profile into the shape the UI consumes.
 * @param {Object} raw - The API user object
 * @returns {Object} {name, email, avatar, plan}
 */
function normalizeUser(raw) {
  const source = raw?.user || raw || {};
  const name = String(source.name || source.displayName || "").trim();
  const email = String(source.email || source.mail || "").trim();
  const plan = String(source.plan || source.tier || "free").toLowerCase();

  return {
    name: name || (email ? email.split("@")[0] : "EchoGPT User"),
    email,
    avatar: source.avatar || source.avatarUrl || source.picture || "",
    plan: plan === "pro" || plan === "premium" ? "pro" : "free"
  };
}

/**
 * Persist the session (token + user) and tell every surface about it.
 * @param {string} token - The bearer token
 * @param {Object} rawUser - The raw API profile
 * @param {{broadcast?: boolean}} [options] - Skip the AUTH_SUCCESS broadcast on refresh
 * @returns {Promise<Object>} The stored user record
 */
async function storeSession(token, rawUser, { broadcast = true } = {}) {
  const user = { ...normalizeUser(rawUser), token, updatedAt: Date.now() };

  await chrome.storage.local.set({
    authToken: token,
    apiKey: token,
    apiKeys: { echogpt: token },
    [USER_KEY]: user
  });

  if (broadcast) notify({ type: "AUTH_SUCCESS", payload: user });
  return user;
}

/**
 * Broadcast a message to the sidebar and the popup, ignoring closed receivers.
 * @param {Object} message - The runtime message
 */
function notify(message) {
  chrome.runtime.sendMessage(message).catch(() => {});
}

/**
 * Pull a token out of an OAuth redirect URL (query string or fragment).
 * @param {string} url - The redirect URL returned by launchWebAuthFlow
 * @returns {string|null} The token, or null
 */
function extractToken(url) {
  if (!url) return null;

  const read = (raw) => {
    const params = new URLSearchParams(raw);
    return (
      params.get("access_token") ||
      params.get("token") ||
      params.get("id_token") ||
      null
    );
  };

  try {
    const parsed = new URL(url);
    return read(parsed.search) || read(parsed.hash.replace(/^#/, ""));
  } catch {
    return null;
  }
}

/**
 * Fetch the profile behind a token.
 * @param {string} token - The bearer token
 * @returns {Promise<Object>} The normalized user record
 */
async function fetchProfile(token) {
  const response = await authFetch("/auth/verify", { token });
  const payload = await readJson(response);

  if (!response.ok) throw toAuthError(response, payload);
  return normalizeUser(payload);
}

/**
 * Check whether a token is still valid and refresh the stored profile.
 * @param {string} [token] - Token to check (defaults to the stored one)
 * @returns {Promise<{ok: boolean, valid: boolean, user: Object|null}>} Verification result
 */
async function verifyToken(token) {
  const stored = await chrome.storage.local.get(["authToken"]);
  const value = (token || stored.authToken || "").trim();
  if (!value) return { ok: true, valid: false, user: null };

  try {
    const user = await fetchProfile(value);
    // Silent refresh: the sidebar is already open, it should not re-toast on every load.
    await storeSession(value, user, { broadcast: false });
    return { ok: true, valid: true, user };
  } catch (err) {
    if (err?.code === "invalid-credentials") {
      await chrome.storage.local.remove(["authToken", "apiKey", "apiKeys"]);
      return { ok: true, valid: false, user: null };
    }
    // Offline or server hiccup: keep the session so the sidebar still works.
    return { ok: true, valid: Boolean(stored.authToken), user: null };
  }
}

/**
 * Re-fetch the profile for the signed-in user.
 * @returns {Promise<Object|null>} The refreshed user record
 */
async function refreshProfile() {
  const session = await getSession();
  if (!session.signedIn) return null;
  return verifyToken().then((result) => result.user || session.user);
}

/**
 * Run the Google OAuth flow and store the resulting session.
 * @returns {Promise<Object>} The stored user record
 */
async function signInWithGoogle() {
  const redirectUri = chrome.identity.getRedirectURL();
  const authUrl = new URL(`${AUTH_BASE}/auth/google`);
  authUrl.searchParams.set("client", "chrome-extension");
  authUrl.searchParams.set("response_type", "token");
  authUrl.searchParams.set("redirect_uri", redirectUri);

  let finalUrl;
  try {
    finalUrl = await chrome.identity.launchWebAuthFlow({
      url: authUrl.toString(),
      interactive: true
    });
  } catch (err) {
    // Chrome reports a closed consent window as "The user did not approve the request."
    if (/cancel|denied|closed|did not approve/i.test(err?.message || "")) {
      throw new AuthError("cancelled", "Google sign-in was cancelled.");
    }
    throw new AuthError("oauth", err?.message || "Google sign-in failed.");
  }

  const token = extractToken(finalUrl);
  if (!token) throw new AuthError("oauth", "Google sign-in did not return a token.");

  try {
    const user = await fetchProfile(token);
    return await storeSession(token, user);
  } catch (err) {
    if (err instanceof AuthError) throw err;
    throw new AuthError("oauth", "Could not complete Google sign-in.");
  }
}

/**
 * Sign in with email and password and store the resulting session.
 * @param {{email: string, password: string}} credentials - The submitted credentials
 * @returns {Promise<Object>} The stored user record
 */
async function signInWithPassword({ email, password } = {}) {
  const mail = String(email || "").trim();
  const secret = String(password || "");

  if (!mail || !secret) {
    throw new AuthError("invalid-credentials", "Email and password are required.");
  }

  const response = await authFetch("/auth/login", {
    method: "POST",
    body: { email: mail, password: secret }
  });
  const payload = await readJson(response);

  if (!response.ok) throw toAuthError(response, payload);

  const token = payload.token || payload.access_token || payload.accessToken;
  if (!token) throw new AuthError("unknown", "The server did not return a token.");

  return storeSession(token, payload.user || payload);
}

/**
 * Clear the session and broadcast the sign-out.
 * @param {{clearHistory?: boolean}} [options] - Whether to also drop conversations
 * @returns {Promise<void>} Resolves once storage is cleared
 */
async function signOut({ clearHistory = false } = {}) {
  await chrome.storage.local.remove(AUTH_CREDENTIAL_KEYS);
  if (clearHistory) {
    await chrome.storage.local.remove(AUTH_HISTORY_KEYS);
    const stored = await chrome.storage.local.get(null);
    const stale = Object.keys(stored).filter((key) => key.startsWith("conversation_"));
    if (stale.length) await chrome.storage.local.remove(stale);
  }

  notify({ type: "AUTH_SIGNED_OUT" });
}
