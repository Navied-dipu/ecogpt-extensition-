/* EchoGPT Sidebar — chat UI + real streaming AI API integration (plain JS, no frameworks). */

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
const TOKENS_PER_WORD = 1.3;
const MAX_TOKENS = 8000;
const TOKEN_WARN_80 = 6400;
const TOKEN_WARN_95 = 7600;

/* ================= API constants ================= */

const DEFAULT_ENDPOINT = "https://api.echogpt.live/v1/chat";
const SYSTEM_PROMPT = "You are EchoGPT, a helpful AI assistant.";
const PAGE_CONTEXT_CHARS = 2000;
const MAX_OUTPUT_TOKENS = 2000;
const DEFAULT_TIMEOUT_MS = 30000;
const TITLE_MAX_CHARS = 50;
const SSE_DONE = "[DONE]";
const MAX_HISTORY_ENTRIES = 200;
const MAX_ATTACHMENT_BYTES = 262144;

const KEY = {
  conversations: "conversations",
  activeId: "activeConversationId",
  activeModel: "activeModel",
  theme: "theme",
  pageContext: "includePageContext",
  apiEndpoint: "apiEndpoint",
  authToken: "authToken",
  apiKeys: "apiKeys",
  chatHistory: "chatHistory"
};

/** Keys that may hold the bearer token written by the Settings page. */
const TOKEN_KEYS = [KEY.authToken, "apiKey", KEY.apiKeys];

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
  attachments: document.getElementById("attachments"),
  actionBadge: document.getElementById("actionBadge"),
  actionBadgeLabel: document.getElementById("actionBadgeLabel"),
  tokenCounter: document.getElementById("tokenCounter")
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
let apiEndpoint = DEFAULT_ENDPOINT;
let requestTimeoutMs = DEFAULT_TIMEOUT_MS;
let authToken = null;
let signedIn = false;
let activeController = null;
let currentUser = null;

const modelById = (id) => MODELS.find((m) => m.id === id) || MODELS[0];

/* ================= Errors ================= */

/**
 * Error type carrying a machine-readable `kind` so the UI can pick a card and actions.
 * @property {string} kind - network | unauthorized | rate-limit | server | timeout | bad-response | unknown
 */
class ApiError extends Error {
  constructor(kind, message, detail = "") {
    super(message);
    this.name = "ApiError";
    this.kind = kind;
    this.detail = detail;
  }
}

const ERROR_TITLE = {
  network: "Network error",
  unauthorized: "Session expired",
  "rate-limit": "Rate limited",
  server: "Server error",
  timeout: "Request timed out",
  "bad-response": "Unexpected response",
  unknown: "Something went wrong"
};

const ERROR_COPY = {
  network: "Could not reach the EchoGPT API. Check your connection and try again.",
  unauthorized: "Please sign in again.",
  "rate-limit": "Too many requests, wait a moment.",
  server: "Server error, try again.",
  timeout: "The model did not respond in time. Try again.",
  "bad-response": "The server returned a response EchoGPT could not read.",
  unknown: "The request failed unexpectedly. Try again."
};

/* ================= Storage ================= */

/**
 * Create a new empty conversation object.
 * @returns {Object} Conversation with id, title, timestamps, empty messages array
 */
function newConversation() {
  return {
    id: crypto.randomUUID(),
    title: "New Chat",
    model: activeModel,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    messages: []
  };
}

/**
 * Get the currently active conversation, creating one if missing.
 * @returns {Object} The active conversation
 */
function activeConversation() {
  if (!conversations[activeId]) {
    const conversation = newConversation();
    conversations[conversation.id] = conversation;
    activeId = conversation.id;
  }
  return conversations[activeId];
}

/**
 * Schedule a debounced save to chrome.storage.local (250ms delay).
 */
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

/**
 * Read the auth token from chrome.storage.local.
 * Prefers `authToken`, then the `apiKey` / `apiKeys.echogpt` values written by Settings.
 * @returns {Promise<string|null>} The token, or null when the user is signed out
 */
async function readAuthToken() {
  const stored = await chrome.storage.local.get(TOKEN_KEYS);
  const token = stored[KEY.authToken] || stored.apiKey || stored[KEY.apiKeys]?.echogpt || "";
  authToken = token.trim() || null;
  return authToken;
}

/**
 * Read the API endpoint from chrome.storage.sync (settings), with local fallbacks.
 * @returns {Promise<string>} The endpoint URL
 */
async function readApiEndpoint() {
  const [synced, local] = await Promise.all([
    chrome.storage.sync.get(["api"]),
    chrome.storage.local.get([KEY.apiEndpoint])
  ]);

  apiEndpoint = synced.api?.endpoint || local[KEY.apiEndpoint] || DEFAULT_ENDPOINT;
  requestTimeoutMs = Math.max(5, Number(synced.api?.timeout) || DEFAULT_TIMEOUT_MS / 1000) * 1000;
  return apiEndpoint;
}

/**
 * Store the auth token and refresh the sign-in overlay.
 * @param {string} token - The API auth token
 */
async function setAuthToken(token) {
  authToken = token.trim() || null;
  await chrome.storage.local.set({
    [KEY.authToken]: authToken || "",
    apiKey: authToken || "",
    [KEY.apiKeys]: { echogpt: authToken || "" }
  });
  updateSignInState();
}

/**
 * Drop the stored auth token (used on 401 and on sign out).
 */
async function clearAuthToken() {
  await setAuthToken("");
}

/**
 * Update the sign-in overlay and composer availability based on auth state.
 */
function updateSignInState() {
  signedIn = Boolean(authToken);
  setAuthOverlay(!signedIn);
  if (els.input) els.input.disabled = !signedIn;
  updateSendState();
}

/* ================= Authentication ================= */

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const MIN_PASSWORD_LENGTH = 6;
const AUTH_ERROR_CLEAR_MS = 4000;
const OVERLAY_FADE_MS = 220;
const GOOGLE_LOGIN_URL = "https://api.echogpt.live/signup";
const FORGOT_PASSWORD_URL = "https://api.echogpt.live/forgot-password";

const AUTH_ERRORS = {
  "invalid-credentials": "Invalid email or password",
  network: "Connection failed. Check your internet.",
  "not-found": "No account found. Sign Up?",
  "rate-limit": "Too many attempts. Wait a moment.",
  server: "Sign-in service is unavailable. Try again.",
  timeout: "The request timed out. Try again.",
  cancelled: "Sign in was cancelled.",
  oauth: "Google sign-in failed. Try again.",
  unknown: "Sign in failed. Try again."
};

const VALIDATION_ERRORS = {
  email: "Enter a valid email address",
  password: `Password must be at least ${MIN_PASSWORD_LENGTH} characters`
};

const GOOGLE_ICON =
  '<svg viewBox="0 0 48 48" width="16" height="16" aria-hidden="true">' +
  '<path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/>' +
  '<path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/>' +
  '<path fill="#FBBC05" d="M10.53 28.59A13 13 0 0 1 9.77 24c0-1.6.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/>' +
  '<path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/>' +
  "</svg>";

const LOGO_ICON =
  '<svg viewBox="0 0 24 24" width="30" height="30" fill="none" aria-hidden="true">' +
  '<path d="M4 5.5A2.5 2.5 0 0 1 6.5 3h11A2.5 2.5 0 0 1 20 5.5v7a2.5 2.5 0 0 1-2.5 2.5H9l-5 4v-13.5Z" fill="#ffffff"/>' +
  '<path d="M8.5 7.5h7M8.5 10.5h4.5" stroke="#7c3aed" stroke-width="1.6" stroke-linecap="round"/>' +
  "</svg>";

/** Cached references into the injected sign-in overlay. */
const auth = {
  root: null,
  card: null,
  form: null,
  email: null,
  password: null,
  submit: null,
  google: null,
  loading: null,
  toast: null,
  busy: false,
  errorTimer: null
};

/**
 * Build and attach the sign-in overlay and toast to the sidebar document.
 * Called once at startup; every element is cached on the `auth` object.
 */
function injectAuthUi() {
  const overlay = document.createElement("div");
  overlay.className = "auth-overlay";
  overlay.id = "authOverlay";
  overlay.hidden = true;
  overlay.innerHTML = `
    <div class="auth-card" role="dialog" aria-modal="true" aria-labelledby="authTitle">
      <div class="auth-card__logo">${LOGO_ICON}</div>
      <h2 class="auth-card__title" id="authTitle">Welcome to EchoGPT</h2>
      <p class="auth-card__sub">Sign in to start chatting with AI</p>

      <button class="auth-google" id="authGoogle" type="button">${GOOGLE_ICON}<span>Sign in with Google</span></button>

      <div class="auth-divider"><span>or</span></div>

      <form class="auth-form" id="authForm" novalidate>
        <label class="auth-field" for="authEmail">
          <span class="auth-field__label">Email</span>
          <input class="auth-input" id="authEmail" name="email" type="email" inputmode="email"
            autocomplete="email" placeholder="you@example.com" spellcheck="false" />
        </label>
        <p class="auth-error auth-error--field" id="authEmailError" role="alert" hidden></p>

        <label class="auth-field" for="authPassword">
          <span class="auth-field__label">Password</span>
          <input class="auth-input" id="authPassword" name="password" type="password"
            autocomplete="current-password" placeholder="At least ${MIN_PASSWORD_LENGTH} characters" />
        </label>
        <p class="auth-error auth-error--field" id="authPasswordError" role="alert" hidden></p>

        <p class="auth-error auth-error--form" id="authFormError" role="alert" hidden></p>

        <button class="auth-submit" id="authSubmit" type="submit" disabled>Sign In</button>
        <button class="auth-link" id="authForgot" type="button">Forgot password?</button>

        <div class="auth-rule"></div>

        <button class="auth-link" id="authSignUp" type="button">
          Don&rsquo;t have an account? <span>Sign Up</span>
        </button>
      </form>

      <div class="auth-loading" id="authLoading" hidden>
        <span class="auth-loading__spinner" aria-hidden="true"></span>
        <span>Signing you in&hellip;</span>
      </div>
    </div>`;

  const toast = document.createElement("div");
  toast.className = "auth-toast";
  toast.id = "authToast";
  toast.setAttribute("role", "status");
  toast.hidden = true;

  document.body.append(overlay, toast);

  auth.root = overlay;
  auth.card = overlay.querySelector(".auth-card");
  auth.form = overlay.querySelector("#authForm");
  auth.email = overlay.querySelector("#authEmail");
  auth.password = overlay.querySelector("#authPassword");
  auth.submit = overlay.querySelector("#authSubmit");
  auth.google = overlay.querySelector("#authGoogle");
  auth.loading = overlay.querySelector("#authLoading");
  auth.toast = toast;

  auth.google.addEventListener("click", signInWithGoogle);
  auth.form.addEventListener("submit", (event) => {
    event.preventDefault();
    submitPasswordSignIn();
  });

  for (const input of [auth.email, auth.password]) {
    input.addEventListener("input", () => {
      clearFieldError(input);
      clearAuthError();
      validateAuthForm();
    });
  }

  overlay.querySelector("#authForgot").addEventListener("click", () => openExternal(FORGOT_PASSWORD_URL));
  overlay.querySelector("#authSignUp").addEventListener("click", () => openExternal(GOOGLE_LOGIN_URL));
}

/**
 * Open an external URL in a new tab.
 * @param {string} url - The target URL
 */
function openExternal(url) {
  chrome.tabs.create({ url }).catch(() => {});
}

/**
 * Show or hide the sign-in overlay.
 * @param {boolean} visible - Whether the overlay should be shown
 * @param {boolean} [animate] - Fade the overlay out when hiding
 */
function setAuthOverlay(visible, animate = true) {
  if (!auth.root) return;

  if (visible) {
    auth.root.hidden = false;
    auth.root.classList.remove("is-leaving");
    return;
  }

  if (!animate) {
    auth.root.hidden = true;
    return;
  }

  auth.root.classList.add("is-leaving");
  setTimeout(() => {
    auth.root.hidden = true;
    auth.root.classList.remove("is-leaving");
  }, OVERLAY_FADE_MS);
}

/**
 * Show a transient toast in the sidebar.
 * @param {string} text - The message to show
 */
function showAuthToast(text) {
  if (!auth.toast) return;

  clearTimeout(auth.toastTimer);
  auth.toast.textContent = text;
  auth.toast.hidden = false;
  auth.toast.classList.add("is-visible");

  auth.toastTimer = setTimeout(() => {
    auth.toast.classList.remove("is-visible");
    auth.toast.hidden = true;
  }, 3200);
}

/**
 * Show a validation error under a single field.
 * @param {HTMLElement} input - The field input
 * @param {string} message - The error message
 */
function showFieldError(input, message) {
  const node = input.closest(".auth-field")?.nextElementSibling;
  if (!node?.classList.contains("auth-error")) return;

  input.classList.add("is-invalid");
  node.textContent = message;
  node.hidden = false;
}

/**
 * Clear the validation error under a single field.
 * @param {HTMLElement} input - The field input
 */
function clearFieldError(input) {
  const node = input.closest(".auth-field")?.nextElementSibling;
  input.classList.remove("is-invalid");
  if (node?.classList.contains("auth-error")) node.hidden = true;
}

/**
 * Show a form-level auth error; it clears itself after 4 seconds.
 * @param {string} message - The error message
 */
function setAuthError(message) {
  const node = auth.form?.querySelector("#authFormError");
  if (!node) return;

  clearTimeout(auth.errorTimer);
  if (!message) {
    node.hidden = true;
    node.textContent = "";
    return;
  }

  node.textContent = message;
  node.hidden = false;
  auth.errorTimer = setTimeout(() => {
    node.hidden = true;
    node.textContent = "";
  }, AUTH_ERROR_CLEAR_MS);
}

/**
 * Clear the form-level auth error immediately.
 */
function clearAuthError() {
  clearTimeout(auth.errorTimer);
  const node = auth.form?.querySelector("#authFormError");
  if (!node) return;
  node.hidden = true;
  node.textContent = "";
}

/**
 * Validate the email field.
 * @param {string} value - The current value
 * @returns {boolean} True when the value looks like an email address
 */
function isValidEmail(value) {
  return EMAIL_PATTERN.test(String(value || "").trim());
}

/**
 * Validate the password field.
 * @param {string} value - The current value
 * @returns {boolean} True when the password is long enough
 */
function isValidPassword(value) {
  return String(value || "").length >= MIN_PASSWORD_LENGTH;
}

/**
 * Validate the sign-in form and toggle the submit button.
 * @param {boolean} [showErrors] - Also surface field errors
 * @returns {boolean} True when both fields are valid
 */
function validateAuthForm(showErrors = false) {
  const emailOk = isValidEmail(auth.email?.value);
  const passwordOk = isValidPassword(auth.password?.value);

  if (showErrors) {
    if (emailOk) clearFieldError(auth.email);
    else showFieldError(auth.email, VALIDATION_ERRORS.email);

    if (passwordOk) clearFieldError(auth.password);
    else showFieldError(auth.password, VALIDATION_ERRORS.password);
  }

  if (auth.submit) auth.submit.disabled = auth.busy || !emailOk || !passwordOk;
  return emailOk && passwordOk;
}

/**
 * Enable or disable every control in the overlay while a request is running.
 * @param {boolean} busy - True while authenticating
 */
function setAuthBusy(busy) {
  auth.busy = busy;
  if (auth.loading) auth.loading.hidden = !busy;
  if (auth.card) auth.card.classList.toggle("is-busy", busy);

  for (const control of auth.form?.querySelectorAll("input, button") || []) {
    control.disabled = busy;
  }
  if (auth.google) auth.google.disabled = busy;

  validateAuthForm();
}

/**
 * Handle the result of a background auth call.
 * @param {Object} response - The runtime message response
 * @returns {Promise<boolean>} True when sign-in succeeded
 */
async function consumeAuthResponse(response) {
  if (response?.ok) {
    await handleAuthSuccess(response.user);
    return true;
  }

  setAuthError(AUTH_ERRORS[response?.code] || AUTH_ERRORS.unknown);
  return false;
}

/**
 * Sign in with the email and password currently in the form.
 * @returns {Promise<boolean>} True when sign-in succeeded
 */
async function submitPasswordSignIn() {
  if (auth.busy) return false;
  if (!validateAuthForm(true)) return false;

  setAuthError("");
  setAuthBusy(true);

  try {
    return await consumeAuthResponse(
      await chrome.runtime.sendMessage({
        type: "AUTH_LOGIN",
        payload: { email: auth.email.value.trim(), password: auth.password.value }
      })
    );
  } catch {
    setAuthError(AUTH_ERRORS.network);
    return false;
  } finally {
    setAuthBusy(false);
    auth.password.value = "";
  }
}

/**
 * Sign in with Google through the background OAuth flow.
 * @returns {Promise<boolean>} True when sign-in succeeded
 */
async function signInWithGoogle() {
  if (auth.busy) return false;

  setAuthError("");
  setAuthBusy(true);

  try {
    return await consumeAuthResponse(
      await chrome.runtime.sendMessage({ type: "AUTH_GOOGLE" })
    );
  } catch {
    setAuthError(AUTH_ERRORS.network);
    return false;
  } finally {
    setAuthBusy(false);
  }
}

/**
 * Apply a freshly authenticated session: store the profile, reveal the chat, toast.
 * @param {Object} user - The user record {name, email, avatar, plan, token}
 * @returns {Promise<void>} Resolves once the UI is updated
 */
async function handleAuthSuccess(user) {
  currentUser = user || null;
  authToken = user?.token || (await readAuthToken());

  if (user) {
    await chrome.storage.local.set({ user: { ...user, token: authToken } });
  }

  setAuthOverlay(false);
  updateSignInState();
  showAuthToast(`Welcome back, ${displayName(user)}! 👋`);
}

/**
 * Resolve a friendly display name from a user record.
 * @param {Object} user - The user record
 * @returns {string} The display name
 */
function displayName(user) {
  const name = String(user?.name || "").trim();
  if (name) return name;
  const email = String(user?.email || "").trim();
  return email ? email.split("@")[0] : "there";
}

/**
 * Verify the stored token on startup and show the overlay when it is missing or stale.
 * @returns {Promise<boolean>} True when the user is signed in
 */
async function checkAuthState() {
  const token = await readAuthToken();
  if (!token) {
    updateSignInState();
    return false;
  }

  try {
    const result = await chrome.runtime.sendMessage({
      type: "AUTH_VERIFY",
      payload: { token }
    });

    if (result?.valid && result.user) {
      currentUser = result.user;
      authToken = result.user.token || token;
    } else if (result?.valid === false) {
      authToken = null;
    }
  } catch {
    // Background unreachable (or offline): trust the stored token.
  }

  if (!authToken) {
    await chrome.storage.local.remove(TOKEN_KEYS);
  }

  updateSignInState();
  return Boolean(authToken);
}

/**
 * Reset the local session after a sign-out broadcast.
 */
function applySignedOut() {
  authToken = null;
  currentUser = null;
  setAuthOverlay(true, false);
  updateSignInState();
}

/**
 * Load all persisted state from chrome.storage.local and chrome.storage.sync.
 * Restores conversations, active model, theme, page context, endpoint and auth token.
 */
async function loadState() {
  const stored = await chrome.storage.local.get([
    KEY.conversations,
    KEY.activeId,
    KEY.activeModel,
    KEY.theme,
    KEY.pageContext,
    KEY.apiEndpoint,
    KEY.authToken
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

  await readApiEndpoint();
}

/**
 * Persist a conversation under `conversation_[id]` and refresh the history list.
 * @param {Object} conversation - The conversation to store
 */
async function persistConversation(conversation) {
  conversation.updatedAt = Date.now();
  const lastMessage = conversation.messages[conversation.messages.length - 1];

  await chrome.storage.local.set({
    [`conversation_${conversation.id}`]: {
      id: conversation.id,
      title: conversation.title,
      model: lastMessage?.model || conversation.model || activeModel,
      messages: conversation.messages,
      updatedAt: conversation.updatedAt
    }
  });

  await syncHistoryEntry(conversation);
}

/**
 * Mirror a conversation into the shared `chatHistory` list used by the history panel.
 * @param {Object} conversation - The conversation to mirror
 */
async function syncHistoryEntry(conversation) {
  const firstUser = conversation.messages.find((m) => m.role === "user");
  const { [KEY.chatHistory]: history } = await chrome.storage.local.get(KEY.chatHistory);
  const list = Array.isArray(history) ? history : [];

  const entry = {
    id: conversation.id,
    conversationId: conversation.id,
    title: conversation.title,
    model: modelById(conversation.model || activeModel).label,
    prompt: conversation.title || firstUser?.text || "",
    time: conversation.updatedAt
  };

  const index = list.findIndex((item) => item.id === conversation.id);
  if (index === -1) list.unshift(entry);
  else list[index] = { ...list[index], ...entry };

  await chrome.storage.local.set({ [KEY.chatHistory]: list.slice(0, MAX_HISTORY_ENTRIES) });
  chrome.runtime.sendMessage({ type: "CONVERSATION_UPDATED", payload: entry }).catch(() => {});
}

/* ================= Theme ================= */

/**
 * Resolve a theme string to "light" or "dark".
 * @param {string} theme - "light", "dark", or "system"
 * @returns {string} "light" or "dark"
 */
function resolveTheme(theme) {
  if (theme === "light" || theme === "dark") return theme;
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

/**
 * Apply the given theme to the document root.
 * @param {string} theme - "light", "dark", or "system"
 */
function applyTheme(theme) {
  document.documentElement.dataset.theme = resolveTheme(theme);
}

els.themeToggle.addEventListener("click", async () => {
  const next = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
  applyTheme(next);
  await chrome.storage.local.set({ [KEY.theme]: next });
});

window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
  applyTheme(document.documentElement.dataset.theme);
});

/* ================= Markdown ================= */

const ESCAPES = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

/**
 * Escape HTML special characters.
 * @param {string} value - The raw string to escape
 * @returns {string} HTML-escaped string
 */
function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (ch) => ESCAPES[ch]);
}

/**
 * Render basic Markdown to HTML (code blocks, inline code, bold, italic, line breaks).
 * @param {string} source - The raw Markdown text
 * @returns {string} Rendered HTML
 */
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

/**
 * Format a Unix timestamp to a short time string (e.g. "3:42 PM").
 * @param {number} ts - Timestamp in milliseconds
 * @returns {string} Formatted time
 */
function formatTime(ts) {
  return new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

/**
 * Copy text to clipboard with fallback.
 * @param {string} text - The text to copy
 * @returns {Promise<boolean>} True if copy succeeded
 */
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

/**
 * Scroll the messages container to the bottom.
 * @param {string} behavior - "smooth" or "auto"
 */
function scrollToBottom(behavior = "smooth") {
  els.messages.scrollTo({ top: els.messages.scrollHeight, behavior });
  stickToBottom = true;
  els.scrollFab.hidden = true;
}

/**
 * Update the scroll-to-bottom FAB visibility based on scroll position.
 */
function updateFab() {
  const distance =
    els.messages.scrollHeight - els.messages.scrollTop - els.messages.clientHeight;
  stickToBottom = distance <= NEAR_BOTTOM;
  els.scrollFab.hidden = stickToBottom;
}

els.messages.addEventListener("scroll", updateFab, { passive: true });
els.scrollFab.addEventListener("click", () => scrollToBottom());

/* ================= Token counting ================= */

/**
 * Estimate token count from text (words * 1.3).
 * @param {string} text - The text to count
 * @returns {number} Estimated token count
 */
function estimateTokens(text) {
  if (!text) return 0;
  const words = text.trim().split(/\s+/).length;
  return Math.round(words * TOKENS_PER_WORD);
}

/**
 * Update the token counter in real time.
 * Counts the current draft plus the conversation so far, and turns yellow at
 * 80% and red at 95% of MAX_TOKENS.
 */
function updateTokenCounter() {
  if (!els.tokenCounter) return;

  const history = activeConversation()
    .messages.map((msg) => msg.text || "")
    .join(" ");
  const tokens = estimateTokens(`${els.input.value} ${history}`);

  els.tokenCounter.textContent = `~${tokens} tokens`;
  els.tokenCounter.title = `Estimated ${tokens} of ${MAX_TOKENS} tokens`;
  els.tokenCounter.classList.toggle("is-warn", tokens >= TOKEN_WARN_80);
  els.tokenCounter.classList.toggle("is-danger", tokens >= TOKEN_WARN_95);
}

/* ================= Model bar ================= */

/**
 * Render the model selection tabs in the header.
 */
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

/**
 * Move the model indicator bar under the active tab.
 */
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

/**
 * Set the active AI model and persist.
 * @param {string} id - Model ID
 */
function setModel(id) {
  activeModel = id;
  activeConversation().model = id;
  renderModelBar();
  scheduleSave();
}

window.addEventListener("resize", moveIndicator);

/* ================= API integration ================= */

/**
 * Ask the active tab's content script for the current page content.
 * @returns {Promise<{title: string, url: string, content: string}|null>} Page data or null
 */
async function readPageContext() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) return null;

    const response = await chrome.tabs.sendMessage(tab.id, { type: "GET_PAGE_TEXT" });
    if (!response?.text) return null;

    return {
      title: response.title || tab.title || "",
      url: response.url || tab.url || "",
      content: String(response.text).slice(0, PAGE_CONTEXT_CHARS)
    };
  } catch {
    // No content script on this page (chrome:// pages, PDF viewer, store pages).
    return null;
  }
}

/**
 * Format page data for the system message.
 * @param {{title: string, url: string, content: string}} page - Page data
 * @returns {string} The page context block
 */
function formatPageContext(page) {
  return `Current page: ${page.title}\nURL: ${page.url}\nContent: ${page.content}`;
}

/**
 * Build the chat completion request body.
 * @param {string} userMessage - The latest user message
 * @param {string} model - The selected model id
 * @param {Array<{role: string, content: string}>} conversationHistory - Prior turns
 * @param {string|null} pageContext - Formatted page context, or null
 * @returns {Object} The JSON body for the API
 */
function buildRequestBody(userMessage, model, conversationHistory, pageContext) {
  const system = pageContext ? `${SYSTEM_PROMPT}\n\n${pageContext}` : SYSTEM_PROMPT;

  return {
    model,
    messages: [
      { role: "system", content: system },
      ...conversationHistory,
      { role: "user", content: userMessage }
    ],
    stream: true,
    max_tokens: MAX_OUTPUT_TOKENS
  };
}

/**
 * Read a short error detail out of a failed response body.
 * @param {Response} response - The failed fetch response
 * @returns {Promise<string>} Trimmed detail text, or an empty string
 */
async function readErrorDetail(response) {
  try {
    const text = await response.text();
    if (!text) return "";

    try {
      const data = JSON.parse(text);
      return String(data?.error?.message || data?.message || text).slice(0, 200);
    } catch {
      return text.trim().slice(0, 200);
    }
  } catch {
    return "";
  }
}

/**
 * Map a non-OK HTTP response to a typed ApiError.
 * @param {Response} response - The failed fetch response
 * @returns {Promise<ApiError>} The mapped error
 */
async function toHttpError(response) {
  const detail = await readErrorDetail(response);

  if (response.status === 401 || response.status === 403) {
    return new ApiError("unauthorized", ERROR_COPY.unauthorized, detail);
  }
  if (response.status === 429) {
    return new ApiError("rate-limit", ERROR_COPY["rate-limit"], detail);
  }
  if (response.status >= 500) {
    return new ApiError("server", ERROR_COPY.server, detail);
  }
  return new ApiError("bad-response", ERROR_COPY["bad-response"], detail || `HTTP ${response.status}`);
}

/**
 * Extract the SSE payload from one raw line.
 * @param {string} line - A single line of the response stream
 * @returns {string|null} The JSON payload, the DONE sentinel, or null
 */
function readSseLine(line) {
  const trimmed = line.trim();
  if (!trimmed.startsWith("data:")) return null;
  return trimmed.slice(5).trim() || null;
}

/**
 * Pull the incremental text out of one parsed SSE chunk.
 * Supports OpenAI-style `choices[0].delta.content` and plain `choices[0].text`.
 * @param {Object} chunk - The parsed JSON chunk
 * @returns {string} The delta text (may be empty)
 */
function extractDelta(chunk) {
  if (chunk.error) {
    throw new ApiError("server", chunk.error.message || ERROR_COPY.server, "");
  }

  const choice = chunk.choices?.[0];
  return (
    choice?.delta?.content ??
    choice?.text ??
    chunk.delta?.text ??
    chunk.content ??
    ""
  );
}

/**
 * Stream a chat completion from the EchoGPT API and yield text deltas as they arrive.
 *
 * Sends a POST to the configured endpoint with the system prompt, prior turns and the
 * new user message, then parses the `text/event-stream` body chunk by chunk. The
 * request is aborted when the user stops generation or when the stream stalls for
 * longer than the configured timeout.
 *
 * @param {string} userMessage - The message to send
 * @param {string} model - The selected model id
 * @param {Array<{role: string, content: string}>} conversationHistory - Prior turns
 * @yields {string} Incremental assistant text
 * @returns {Promise<string>} The full assistant text (available on the last iteration)
 * @throws {ApiError} network | unauthorized | rate-limit | server | timeout | bad-response
 */
async function* sendMessage(userMessage, model, conversationHistory) {
  const token = await readAuthToken();
  if (!token) {
    updateSignInState();
    throw new ApiError("unauthorized", ERROR_COPY.unauthorized);
  }

  const endpoint = await readApiEndpoint();
  const page = includePageContext ? await readPageContext() : null;
  const body = buildRequestBody(userMessage, model, conversationHistory, page && formatPageContext(page));

  const controller = new AbortController();
  activeController = controller;
  abortRequested = false;

  let timedOut = false;
  let timer = null;

  /** Re-arm the inactivity watchdog every time bytes arrive. */
  const armTimeout = () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, requestTimeoutMs);
  };

  /** Translate an abort/network failure into a typed ApiError. */
  const toNetworkError = (err) => {
    if (timedOut) return new ApiError("timeout", ERROR_COPY.timeout);
    if (abortRequested) return new ApiError("aborted", "Stopped");
    if (err instanceof ApiError) return err;
    return new ApiError("network", ERROR_COPY.network, err?.message || "");
  };

  armTimeout();

  let response;
  try {
    response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`
      },
      body: JSON.stringify(body),
      signal: controller.signal
    });
  } catch (err) {
    clearTimeout(timer);
    activeController = null;
    throw toNetworkError(err);
  }

  if (!response.ok) {
    clearTimeout(timer);
    activeController = null;

    const error = await toHttpError(response);
    if (error.kind === "unauthorized") await clearAuthToken();
    throw error;
  }

  if (!response.body?.getReader) {
    clearTimeout(timer);
    activeController = null;

    const text = (await response.text().catch(() => "")).trim();
    if (!text) throw new ApiError("bad-response", ERROR_COPY["bad-response"]);
    yield text;
    return text;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let full = "";

  /**
   * Process a batch of complete SSE lines, yielding the text deltas they carry.
   * @param {string[]} lines - Complete lines from the stream
   * @yields {string} Text deltas
   * @returns {boolean} True once the `[DONE]` sentinel is seen
   */
  function* consume(lines) {
    for (const line of lines) {
      const data = readSseLine(line);
      if (data === null) continue;
      if (data === SSE_DONE) return true;

      let chunk;
      try {
        chunk = JSON.parse(data);
      } catch {
        continue;
      }

      const delta = extractDelta(chunk);
      if (!delta) continue;

      full += delta;
      yield delta;
    }

    return false;
  }

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;

      armTimeout();
      buffer += decoder.decode(value, { stream: true });

      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      if (yield* consume(lines)) return full;
    }

    buffer += decoder.decode();
    if (buffer.trim()) yield* consume([buffer]);

    return full;
  } catch (err) {
    throw toNetworkError(err);
  } finally {
    clearTimeout(timer);
    activeController = null;
    reader.cancel().catch(() => {});
  }
}

/* ================= Messages ================= */

/**
 * Build the red error card shown inside an assistant bubble.
 * @param {Object} msg - The failed message record
 * @returns {DocumentFragment} Card contents
 */
function buildErrorCard(msg) {
  const fragment = document.createDocumentFragment();
  const kind = msg.errorKind || "unknown";

  const title = document.createElement("p");
  title.className = "msg__error-title";
  title.textContent = ERROR_TITLE[kind] || ERROR_TITLE.unknown;

  const text = document.createElement("p");
  text.className = "msg__error-text";
  text.textContent = msg.text || ERROR_COPY[kind] || ERROR_COPY.unknown;

  const actions = document.createElement("div");
  actions.className = "msg__error-actions";

  const retry = document.createElement("button");
  retry.type = "button";
  retry.className = "msg__error-btn";
  retry.textContent = "Retry";
  retry.addEventListener("click", () => discardAndResend(msg));

  if (kind === "unauthorized") {
    const signIn = document.createElement("button");
    signIn.type = "button";
    signIn.className = "msg__error-btn";
    signIn.textContent = "Sign in";
    signIn.addEventListener("click", () => {
      if (authToken) {
        openPage("settings/settings.html");
        return;
      }
      setAuthOverlay(true);
      auth.email?.focus();
    });
    actions.append(signIn);
  } else {
    actions.append(retry);
  }

  fragment.append(title, text, actions);
  return fragment;
}

/**
 * Create a DOM node for a single chat message.
 * @param {Object} msg - Message object {id, role, model, text, time, feedback, error}
 * @returns {HTMLElement} The message article element
 */
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

  if (msg.error) {
    bubble.append(buildErrorCard(msg));
    node.append(head, bubble);
    return node;
  }

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
        msg.feedback = msg.feedback === spec.field ? null : spec.field;
        button.setAttribute("aria-pressed", String(msg.feedback === spec.field));
        for (const sibling of actions.querySelectorAll(".act[aria-pressed]")) {
          if (sibling !== button) sibling.setAttribute("aria-pressed", "false");
        }
        scheduleSave();
        persistConversation(activeConversation());
      });
    }

    if (spec.id === "regen") {
      button.addEventListener("click", () => discardAndResend(msg));
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

/**
 * Re-render all messages for the active conversation.
 */
function renderMessages() {
  const conversation = activeConversation();
  els.messages.replaceChildren();

  if (conversation.messages.length === 0) {
    els.emptyState.classList.remove("hidden");
    els.messages.append(els.emptyState);
    els.scrollFab.hidden = true;
    updateTokenCounter();
    return;
  }

  els.emptyState.classList.add("hidden");
  for (const msg of conversation.messages) {
    els.messages.append(createMessageNode(msg));
  }
  requestAnimationFrame(() => scrollToBottom("auto"));
  updateTokenCounter();
}

/**
 * Push a new message to the active conversation and render it.
 * Auto-titles the conversation from the first user message (first 50 characters).
 * @param {Object} msg - Message to push
 * @returns {Object} The created message record
 */
function pushMessage(msg) {
  const conversation = activeConversation();
  const record = {
    id: msg.id || crypto.randomUUID(),
    role: msg.role,
    model: msg.model || activeModel,
    text: msg.text || "",
    time: msg.time || Date.now(),
    feedback: null,
    error: Boolean(msg.error),
    errorKind: msg.errorKind || "",
    errorDetail: msg.errorDetail || ""
  };

  conversation.messages.push(record);
  conversation.updatedAt = record.time;

  const userCount = conversation.messages.filter((m) => m.role === "user").length;
  if (record.role === "user" && userCount === 1) {
    conversation.title = record.text.slice(0, TITLE_MAX_CHARS).trim() || "New Chat";
    els.chatTitle.textContent = conversation.title;
  }

  els.emptyState.classList.add("hidden");
  els.messages.append(createMessageNode(record));
  if (stickToBottom) scrollToBottom();
  scheduleSave();
  updateTokenCounter();

  return record;
}

/**
 * Show the typing indicator while waiting for the first token.
 */
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

/**
 * Remove the typing indicator.
 */
function hideTyping() {
  document.getElementById("typingIndicator")?.remove();
}

/* ================= Send / stream ================= */

/**
 * Append attachment contents to the outgoing prompt.
 * @param {string} text - The user's message
 * @returns {string} The prompt including any attached text
 */
function buildPrompt(text) {
  if (!attachments.length) return text;

  const dump = attachments
    .map((file) => `\n--- ${file.name} ---\n${file.text ?? "(binary file, no text)"}`)
    .join("\n");

  return `${text}\n\nAttached files:${dump}`;
}

/**
 * Collect prior turns in API format, skipping failed and empty messages.
 * @param {string} [excludeId] - Message id to leave out (it is sent separately)
 * @returns {Array<{role: string, content: string}>} Conversation history
 */
function buildHistory(excludeId) {
  return activeConversation()
    .messages.filter((msg) => !msg.error && msg.text && msg.id !== excludeId)
    .map((msg) => ({ role: msg.role === "user" ? "user" : "assistant", content: msg.text }));
}

/**
 * Paint the streaming text plus a blinking cursor into an assistant bubble.
 * @param {HTMLElement} bubble - The assistant bubble element
 * @param {string} text - Text received so far
 * @param {boolean} streaming - Whether the cursor should be shown
 */
function paintStream(bubble, text, streaming) {
  bubble.replaceChildren();

  const body = document.createElement("div");
  body.innerHTML = renderMarkdown(text);
  bubble.append(...body.childNodes);

  if (streaming) {
    const cursor = document.createElement("span");
    cursor.className = "msg__cursor";
    bubble.append(cursor);
  }

  if (stickToBottom) els.messages.scrollTop = els.messages.scrollHeight;
}

/**
 * Replace a message node with the red error card for the given failure.
 * @param {Object} record - The failed assistant message record
 * @param {ApiError} error - The failure
 */
function showErrorCard(record, error) {
  record.error = true;
  record.errorKind = error.kind;
  record.errorDetail = error.detail || "";
  record.text = "";

  const node = els.messages.querySelector(`[data-id="${record.id}"]`);
  const next = createMessageNode(record);
  if (node) node.replaceWith(next);
  else els.messages.append(next);

  if (stickToBottom) els.messages.scrollTop = els.messages.scrollHeight;
}

/**
 * Request a completion for the current conversation and stream it into a new bubble.
 * The user message is expected to already be in the conversation.
 * @returns {Promise<void>} Resolves when the stream ends or fails
 */
async function runCompletion() {
  if (status !== "idle") return;

  const conversation = activeConversation();
  const lastUser = [...conversation.messages].reverse().find((msg) => msg.role === "user");
  if (!lastUser) return;

  const model = conversation.model || activeModel;
  // sendMessage appends the latest user turn itself, so it must not be in the history.
  const history = buildHistory(lastUser.id);

  abortRequested = false;
  setStatus("loading");
  showTyping();

  let record = null;
  let bubble = null;

  /** Create the assistant bubble on the first token (or on failure). */
  const ensureBubble = () => {
    if (record) return;
    hideTyping();
    record = pushMessage({ role: "assistant", model, text: "" });
    bubble = els.messages.querySelector(`[data-id="${record.id}"]`)?.querySelector(".msg__bubble--ai");
    setStatus("streaming");
  };

  try {
    for await (const delta of sendMessage(lastUser.text, model, history)) {
      ensureBubble();
      record.text += delta;
      paintStream(bubble, record.text, true);
    }
    ensureBubble();
  } catch (err) {
    const error = err instanceof ApiError ? err : new ApiError("unknown", err?.message || "");

    hideTyping();
    setStatus("idle");

    if (error.kind === "aborted") {
      // User pressed stop: keep whatever streamed in and drop the cursor.
      ensureBubble();
      if (bubble) paintStream(bubble, record.text, false);
      if (!record.text) record.text = "Generation stopped.";
      scheduleSave();
      await persistConversation(conversation);
      return;
    }

    ensureBubble();
    showErrorCard(record, error);
    scheduleSave();
    await persistConversation(conversation);
    return;
  }

  hideTyping();
  paintStream(bubble, record.text, false);

  if (!record.text) {
    record.text = "The model returned an empty response.";
  }

  setStatus("idle");
  scheduleSave();
  await persistConversation(conversation);
}

/**
 * Drop an assistant message (error card or old reply) and request a fresh completion.
 * @param {Object} message - The assistant message to discard
 */
async function discardAndResend(message) {
  if (status !== "idle") return;

  const conversation = activeConversation();
  const index = conversation.messages.findIndex((msg) => msg.id === message.id);
  if (index === -1) return;

  conversation.messages.splice(index, 1);
  renderMessages();
  await runCompletion();
}

/**
 * Stop an in-flight stream by aborting the active request.
 */
function stopGeneration() {
  if (status === "idle") return;
  abortRequested = true;
  hideTyping();
  activeController?.abort();
  setStatus("idle");
  scheduleSave();
  updateSendState();
}

/**
 * Send the composer (or a relayed quick action) to the model.
 * @param {string} [rawText] - Text to send instead of the composer value
 */
async function send(rawText) {
  if (status !== "idle") return;

  const text = (rawText ?? els.input.value).trim();
  if (!text) return;

  if (!signedIn) {
    // The sign-in overlay is already covering the composer.
    return;
  }

  pushMessage({ role: "user", text: buildPrompt(text) });

  els.input.value = "";
  attachments = [];
  renderAttachments();
  updateComposerState();

  await runCompletion();
}

/**
 * Update the send button for the current status and auth state.
 */
function updateSendState() {
  const hasText = els.input.value.trim().length > 0;
  els.send.disabled = status === "idle" ? !hasText || !signedIn : false;
  els.send.classList.toggle("is-loading", status === "loading");
  els.send.classList.toggle("is-streaming", status === "streaming");
  els.send.setAttribute("aria-label", status === "idle" ? "Send message" : "Stop generating");
}

/**
 * Set the composer status (idle | loading | streaming).
 * @param {string} next - The next status
 */
function setStatus(next) {
  status = next;
  updateSendState();
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

/**
 * Grow the textarea with its content, up to MAX_ROWS lines.
 */
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

/**
 * Update the character counter and textarea size.
 */
function updateCounter() {
  const length = els.input.value.length;
  els.counter.textContent = `${length}/${MAX_CHARS}`;
  els.counter.classList.toggle("is-over", length >= MAX_CHARS);
}

/**
 * Refresh every composer-dependent UI piece.
 */
function updateComposerState() {
  updateSendState();
  updateCounter();
  updateTokenCounter();
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

/**
 * Render the attachment chips above the composer.
 */
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
    if (file.size < MAX_ATTACHMENT_BYTES) {
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
  const title = els.chatTitle.textContent.trim().slice(0, TITLE_MAX_CHARS) || "New Chat";
  els.chatTitle.textContent = title;
  activeConversation().title = title;
  scheduleSave();
  persistConversation(activeConversation());
});

/* ================= Navigation ================= */

/**
 * Open an extension page in a new tab.
 * @param {string} path - Path relative to the extension root
 */
async function openPage(path) {
  await chrome.tabs.create({ url: chrome.runtime.getURL(path) });
  window.close();
}

els.openHistory.addEventListener("click", () => openPage("history/history.html"));
els.openSettings.addEventListener("click", () => openPage("settings/settings.html"));

els.newChat.addEventListener("click", () => {
  stopGeneration();

  const conversation = newConversation();
  conversations[conversation.id] = conversation;
  activeId = conversation.id;
  attachments = [];
  renderAttachments();
  els.chatTitle.textContent = conversation.title;
  renderMessages();
  updateComposerState();
  els.input.focus();
  scheduleSave();
});

/* ================= Incoming quick actions ================= */

let actionTimer = null;

/**
 * Show the quick action badge above the composer.
 * @param {string} label - The action label
 */
function showActionBadge(label) {
  clearTimeout(actionTimer);
  els.actionBadgeLabel.textContent = label;
  els.actionBadge.classList.remove("is-leaving");
  els.actionBadge.hidden = false;
}

/**
 * Hide the quick action badge.
 */
function clearActionBadge() {
  els.actionBadge.classList.add("is-leaving");
  setTimeout(() => {
    els.actionBadge.hidden = true;
    els.actionBadge.classList.remove("is-leaving");
  }, 180);
}

/**
 * Accept a prompt relayed from the popup or a content-script quick action.
 * @param {Object} payload - {prompt, label, action}
 * @returns {boolean} True when the prompt was accepted
 */
function applyIncomingAction(payload) {
  const prompt = (payload?.prompt || "").trim();
  if (!prompt) return false;

  if (status !== "idle") {
    showActionBadge("Busy — try again");
    clearActionBadge();
    return false;
  }

  showActionBadge(payload.label || payload.action || "Quick Action");
  els.input.value = prompt;
  updateComposerState();

  clearTimeout(actionTimer);
  actionTimer = setTimeout(() => {
    clearActionBadge();
    send(prompt);
  }, 300);

  return true;
}

chrome.runtime.onMessage.addListener((message) => {
  if (message?.type === "SIDEBAR_ACTION" || message?.type === "SIDEBAR_PROMPT") {
    applyIncomingAction(message.payload);
    return false;
  }

  if (message?.type === "AUTH_SUCCESS") {
    handleAuthSuccess(message.payload);
    return false;
  }

  if (message?.type === "AUTH_SIGNED_OUT") {
    applySignedOut();
    return false;
  }

  return false;
});

/* Settings and the popup write the token; keep the overlay in sync without a reload. */
chrome.storage.onChanged.addListener(async (changes, area) => {
  if (area !== "local") return;

  if (TOKEN_KEYS.some((key) => key in changes)) {
    const wasSignedIn = signedIn;
    await readAuthToken();
    updateSignInState();

    // A sign-out that happened in the settings page or the popup.
    if (wasSignedIn && !signedIn) {
      showAuthToast("You have been signed out.");
    }
  }

  if ("user" in changes) {
    currentUser = changes.user.newValue || null;
  }

  if (KEY.apiEndpoint in changes) {
    await readApiEndpoint();
  }
});

/* ================= Init ================= */

/**
 * Boot the sidebar: inject the auth UI, restore state, verify the session, render.
 */
async function init() {
  injectAuthUi();

  await loadState();
  renderModelBar();
  renderMessages();
  renderAttachments();
  updateComposerState();
  scrollToBottom("auto");

  try {
    await chrome.runtime.sendMessage({ type: "SIDEBAR_READY" });
  } catch {
    /* background not ready */
  }

  await checkAuthState();
  validateAuthForm();
}

init();
