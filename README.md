# EchoGPT Chrome Extension v2.0 — Redesign

A multi-model AI chat sidebar for Chrome, rebuilt from the ground up on Manifest V3 with a
streaming backend, real authentication, and a full animation/micro-interaction pass.

---

## Overview

### What the extension does

EchoGPT lives in the Chrome side panel and gives you a persistent AI chat that follows you across
every tab. Pick a model (GPT-4o, Gemini Pro, Claude 3.5, Llama 3, Mistral), type a message, and
watch the answer stream in token by token. It can also read whatever page you are on, so
Quick Actions like "Summarize Page" or "Explain Selection" work on real content instead of
requiring you to copy-paste.

| Surface | Purpose |
| --- | --- |
| **Side panel** | The chat: model tabs, streaming replies, history drawer, attachments, token counter |
| **Popup** | 320×480 launcher: user state, stats, quick actions, recent chats, one-click sidebar open |
| **Settings** | Six-tab control centre: Account, Models, Appearance, API, Shortcuts, Privacy |
| **History page** | Full-page searchable log of every conversation with delete and clear |
| **Content script** | Reads page text and selection, injects the floating EchoGPT trigger |

### Why this redesign improves on the original

The original was a single-page mock: hard-coded replies, no persistence, no auth, and no error
handling. Everything a real product needs was missing. v2.0 replaces that with an actual data
path and an actual design system.

| Area | v1 | v2.0 |
| --- | --- | --- |
| Chat responses | Canned text after a fake delay | Real `fetch` + SSE stream parsed off a `ReadableStream` |
| Models | Decorative labels | Model id sent in the request body, per-conversation model memory |
| Conversation state | In-memory only | `conversation_[id]` in `chrome.storage.local`, survives restart |
| Errors | Silent | Typed `ApiError` cards (401/404/429/500/network/timeout) with Retry and Sign in |
| Authentication | None | Google OAuth via `chrome.identity` + email/password against the auth API |
| Theme | Hard-coded light | `data-theme` tokens, Dark / Light / System, synced across devices |
| Motion | None | Shared `@keyframes` library, toasts, skeletons, drawer, ripples, hover lifts |
| Layout | Single viewport | 400px side panel, responsive drawer, reduced-motion support |

### Key improvements made

- **Real streaming** — SSE frames decoded chunk by chunk with a blinking cursor while the reply
  arrives, and a 30-second inactivity watchdog that surfaces a retryable timeout.
- **Auth that survives** — token verified against `GET /auth/verify` on load, silently refreshed,
  cleared on 401, and broadcast to every open surface so nothing goes stale.
- **Everything is stored** — conversations, the message mirror for the popup, the model choice,
  the theme, and the API configuration, all with sensible defaults when storage is empty.
- **Motion with intent** — skeletons that only appear while something is loading, a history drawer
  that slides rather than pops, toasts for every action, and a full `prefers-reduced-motion`
  escape hatch.
- **One design system** — tokens, buttons, toasts, skeletons, and the animation library live in
  `styles/common.css` and are shared by all four surfaces.

---

## Screenshots

> Placeholder — drop real captures into `docs/` and swap the markdown image syntax below.

| Surface | Placeholder | Suggested capture |
| --- | --- | --- |
| Popup UI | `![Popup UI](docs/screenshots/popup.png)` | 320×480 popup, signed-in state, dark mode |
| Sidebar Chat | `![Sidebar Chat](docs/screenshots/sidebar.png)` | 400px side panel mid-stream, cursor visible |
| Settings Page | `![Settings Page](docs/screenshots/settings.png)` | Appearance tab with theme cards |
| History Panel | `![History Panel](docs/screenshots/history.png)` | Full History page, or the drawer open |
| Quick Actions | `![Quick Actions](docs/screenshots/quick-actions.png)` | Popup quick-action grid + page trigger |

**Popup UI**

```
┌────────────────────────────────┐
│ ◨ EchoGPT   v2.0        ☾  ⚙   │  gradient header
├────────────────────────────────┤
│ (AV) Ada Lovelace      [Pro]   │  user card / sign-in state
├────────────────────────────────┤
│   ◇ 5        ⚡ 12ms     ✓ OK   │  stats row
├────────────────────────────────┤
│      ⟩  Open Sidebar           │  gradient CTA
├────────────────────────────────┤
│ QUICK ACTIONS                  │
│ ┌────────────┐ ┌────────────┐  │
│ │ ✦ Summarize│ │ ? Explain  │  │  hover: scale + accent shift
│ └────────────┘ └────────────┘  │
│ ┌────────────┐ ┌────────────┐  │
│ │ ↻ Rewrite  │ │ ⌕ Search   │  │
│ └────────────┘ └────────────┘  │
├────────────────────────────────┤
│ RECENT                         │
│ 🗨  Summarize this page    2m   │
├────────────────────────────────┤
│ Ctrl+Shift+E  ·  Privacy · FAQ │
└────────────────────────────────┘
```

**Sidebar Chat**

```
┌────────────────────────────────┐
│ ◨ EchoGPT     ☰  ◱  ☾  ⚙  ➕   │  header gains a shadow on scroll
├────────────────────────────────┤
│ ● GPT-4o  ● Gemini  ● Claude …  │  sliding underline indicator
├────────────────────────────────┤
│                          ┌────┐│
│                     ┌────┘ AI ││  hover: lifts 1px
│                     │  reply ││  copy · retry on hover
│                     └────────┘│
│              ┌───────────┐    │
│              │  my question│   │
│              └───────────┘    │
│                        ▊      │  blinking streaming cursor
├────────────────────────────────┤
│ ⧉ 📎 ⏱ │ Ask anything…    │ ➤ │  focus glow + ripple on send
└────────────────────────────────┘
```

**Settings Page** — six tabs (Account, Models, Appearance, API, Shortcuts, Privacy), left nav,
live preview cards, dirty-state save bar.

**History Panel** — sticky header with search and Clear, staggered list rows with model badge and
delete, skeleton cards during load.

**Quick Actions** — popup grid plus the floating page trigger; refused actions (no selection,
restricted page) explain themselves with a toast instead of failing silently.

---

## Features Implemented

### Core chat

- [x] Multi-model AI chat (GPT-4o, Gemini Pro, Claude 3.5, Llama 3, Mistral) — enable/disable
      per model in Settings, default model honoured per conversation
- [x] Streaming responses with real-time text — SSE parsed off `reader.read()`, partial text
      persisted, `data: [DONE]` terminates the stream
- [x] Typing indicator animation — "<Model> is thinking…" with animated dots until the first token
- [x] Markdown rendering in messages — inline code, fenced blocks, bold, italic, headings, lists,
      links, sanitised before injection
- [x] Token usage counter — words × 1.3 estimate, live, amber at 80%, red at 95%
- [x] Auto-scroll + scroll-to-bottom button — sticks within 72px, FAB appears when you scroll up
- [x] Stop / regenerate / retry — Stop keeps the partial answer, Regenerate re-sends without
      duplicating the user turn
- [x] File attachments — text files up to 4 KB and 4 files per message, injected into context
- [x] Inline rename — click the chat title to rename a conversation

### Page intelligence

- [x] Quick Actions (Summarize, Explain, Rewrite, Search) — from the popup, the floating page
      trigger, or the content-script context menu
- [x] Page context injection — title, URL, and the first 2000 characters of the page prepended to
      the system message, toggled per conversation
- [x] Content script trigger — a floating EchoGPT button injected on every page, removable

### Data and history

- [x] Conversation history with search + filters — sliding drawer in the sidebar, plus a
      full-page History view with live search, delete, and clear-all
- [x] History saves after each conversation — `conversation_[id]` blobs plus a `chatHistory`
      mirror for the popup, with live cross-surface updates
- [x] Title auto-generation from the first user message (first 50 characters)

### Account and settings

- [x] Google OAuth + Email authentication — `chrome.identity.launchWebAuthFlow` for Google,
      `POST /auth/login` for email, with field validation and typed error messages
- [x] Sign-in overlay — gradient card, blurred chat behind, "Signing you in…" state, welcome toast
- [x] Sign out — from the popup or Settings, optionally clearing history, broadcast to every surface
- [x] Settings page with 6 tabs — Account, Models, Appearance, API, Shortcuts, Privacy, with
      validation, dirty state, and sync persistence
- [x] Export and clear data from the Privacy tab

### Interface

- [x] Dark / Light / System theme — `[data-theme]` on `<html>`, CSS custom properties, 0.2s colour
      transitions, stored in `chrome.storage.sync`, system preference detected on first install
- [x] Toast notification system — success / error / info / warning, icon + message + close button,
      3s auto-dismiss, stacked bottom-right
- [x] Loading skeletons — three shimmer cards for history, left/right shimmer bubbles for messages
- [x] Animation library — `fadeIn`, `slideUp`, `slideInRight`, `slideInLeft`, `bounceIn`, `pulse`,
      `shimmer`, `spin`, `blink`, `dotBounce`, plus ripple and micro-interactions
- [x] Keyboard shortcut support — `Ctrl+Shift+E` opens the sidebar, plus in-panel shortcuts
- [x] Responsive 400px sidebar layout — fixed 400px panel, drawer capped at 92% width, and
      `prefers-reduced-motion` respected everywhere

---

## Tech Stack

- **Manifest V3** — service worker, side panel, content scripts, host permissions
- **Chrome Side Panel API** — persistent side panel as the primary chat surface
- **Chrome Storage API** — `local` for conversations, session, and API keys; `sync` for
  preferences, theme, and enabled models
- **Chrome Identity API** — `getRedirectURL()` + `launchWebAuthFlow()` for Google OAuth
- **Vanilla JavaScript (ES6+)** — no build step, `async/await` throughout, JSDoc on every function
- **CSS3 with custom properties** — themed via `[data-theme]` tokens, no preprocessor
- **Fetch API with `ReadableStream`** — server-sent events streamed and parsed incrementally
- **No external frameworks or libraries** — including a hand-written Markdown renderer; the only
  external request is the Inter webfont (gracefully degrades to system fonts)

---

## Installation (Development)

1. **Clone the repository**

   ```bash
   git clone https://github.com/Navied-dipu/ecogpt-extensition-.git
   cd ecogpt-extensition
   ```

2. **Open `chrome://extensions/`** in Chrome
3. **Enable Developer Mode** (top-right toggle)
4. **Click "Load unpacked"**
5. **Select the `echogpt-extension/` folder** — the one containing `manifest.json`
6. **Pin the extension** — use the puzzle-piece icon in the toolbar and pin EchoGPT
7. **Press `Ctrl+Shift+E`** (`Cmd+Shift+E` on macOS) to open the side panel

Requires Chrome 114 or newer (Side Panel API). Edits to any file appear after hitting reload on
the `chrome://extensions/` card.

---

## Folder Structure

```
echogpt-extension/
├── manifest.json              # MV3: side panel, service worker, content script, commands, permissions
│
├── assets/
│   └── icons/
│       ├── icon16.png         # Toolbar icon (16px)
│       ├── icon48.png         # Extension manager icon (48px)
│       └── icon128.png        # Chrome Web Store icon (128px)
│
├── styles/
│   └── common.css             # Design system: theme tokens, @keyframes library, buttons,
│                              #   skeletons, toasts, spinner, scrollbars, reduced motion
│
├── sidebar/                   # ★ Primary chat surface (Chrome side panel)
│   ├── sidebar.html           # Shell markup: header, model bar, messages, composer, drawer
│   ├── sidebar.js             # Largest file: streaming API client, persistence, markdown
│   │                          #   renderer, history drawer, sign-in overlay, toasts, theme
│   └── sidebar.css            # Layout, message bubbles, composer, auth overlay, drawer,
│                              #   micro-interactions, skeletons
│
├── popup/                     # Toolbar popup (320×480)
│   ├── popup.html             # Header, user card, stats, CTA, quick actions, recent, footer
│   ├── popup.js               # Auth state, recent chats, quick-action relay, side panel open
│   └── popup.css              # Staggered entrance animations, hover lift, card styles
│
├── settings/                  # Full settings page
│   ├── settings.html          # Six tab panels: Account, Models, Appearance, API, Shortcuts, Privacy
│   ├── settings.js            # Load/save, validation, dirty tracking, theme sync, sign out
│   └── settings.css           # Tab nav, blocks, cards, toggles, range inputs, toast
│
├── history/                   # Full-page conversation history
│   ├── history.html           # Sticky header, search, list, skeleton list
│   ├── history.js             # Load, search, filter, delete, clear, live refresh
│   └── history.css            # Row layout, hover lift, staggered entrance, skeletons
│
├── content/                   # Injected into every page
│   └── content.js             # Floating trigger, page text/selection extraction, Quick Actions,
│                              #   relays actions to the sidebar, its own isolated toasts
│
└── background/
    └── background.js          # Service worker: side panel behaviour, Ctrl+Shift+E command,
                               #   action queue for Quick Actions, and the whole auth module
                               #   (Google OAuth, email login, verify, profile, sign out)
```

---

## API Configuration

### Default endpoint

| Purpose | Value |
| --- | --- |
| Chat completions | `https://api.echogpt.live/v1/chat` |
| Email login | `https://api.echogpt.live/auth/login` |
| Session verify | `https://api.echogpt.live/auth/verify` |
| Google OAuth entry | `https://api.echogpt.live/auth/google` |

`https://api.echogpt.live/*` is listed in `host_permissions` so the side panel can reach it
cross-origin under Manifest V3.

### Setting a custom endpoint

1. Open **Settings → API**
2. Paste the full URL into **Endpoint** (must be a `POST`-compatible chat-completions route)
3. Adjust **Timeout** (seconds, minimum 5), **Max tokens**, **Temperature**, and **Streaming**
4. Press **Save** — the value is written to `chrome.storage.sync` under `api.endpoint` and picked
   up by the sidebar immediately, no reload required
5. **Reset to Default** restores the value above

### Configuring the API key

The token usually comes from signing in, and the sidebar mirrors it into `apiKey` /
`apiKeys.echogpt` so chat requests keep working. To use a raw key instead:

1. **Settings → API → API key**
2. Paste the key and press **Save** (the field is masked with a show/hide toggle)
3. It is stored in `chrome.storage.local` only — never synced, never sent anywhere except your
   configured endpoint

The sidebar resolves the token in this order: `authToken` → `apiKey` → `apiKeys.echogpt`, and sends
it as `Authorization: Bearer <token>`.

### Request shape

```jsonc
// POST <endpoint>
{
  "model": "gpt-4o",
  "messages": [
    { "role": "system",    "content": "You are a helpful assistant…" },  // + optional page context
    { "role": "user",      "content": "…" },
    { "role": "assistant", "content": "…" }
  ],
  "stream": true,
  "max_tokens": 2000
}
```

The response must be SSE: `data: {"choices":[{"delta":{"content":"…"}}]}` frames terminated by
`data: [DONE]`.

---

## Keyboard Shortcuts

| Shortcut | Action | Where |
| --- | --- | --- |
| `Ctrl+Shift+E` / `Cmd+Shift+E` | Open the EchoGPT side panel | Anywhere (browser command) |
| `Enter` | Send the message | Sidebar composer |
| `Shift+Enter` | Insert a new line | Sidebar composer |
| `Esc` | Stop generating | Sidebar, while streaming |
| `Esc` | Close the history drawer | Sidebar, drawer open |
| `/` | Focus the composer | Sidebar |
| `Ctrl+K` / `Cmd+K` | Toggle the history drawer | Sidebar |
| `Ctrl+Shift+D` / `Cmd+Shift+D` | Toggle dark / light mode | Sidebar |
| `Enter` | Commit a title rename | Sidebar chat title |

`Ctrl+Shift+E` can be remapped at `chrome://extensions/shortcuts`, which the **Customize** button
in **Settings → Shortcuts** opens for you.

---

## Assumptions Made

### API assumptions

- The backend speaks an OpenAI-compatible chat-completions dialect at `POST <endpoint>` with
  `{ model, messages, stream, max_tokens }`.
- Streaming is server-sent events with `data:` frames and a terminating `data: [DONE]`.
- Delta text lives at `choices[0].delta.content`.
- A `30s` **inactivity** watchdog (not a total-request cap) is the timeout, so a long but healthy
  response is never killed.
- HTTP status is enough to classify failures: `401` → re-authenticate, `404` → unknown model,
  `429` → rate limited, `5xx` → server error, plus a distinct network failure state.

### Auth flow assumptions

- Google uses the OAuth 2.0 implicit flow via `chrome.identity.launchWebAuthFlow` with
  `response_type=token` and `client=chrome-extension`; the token may arrive in the **query string
  or the fragment** of the redirect, and both are parsed.
- `POST /auth/login` with `{ email, password }` returns a token plus a user object, normalised to
  `{ name, email, avatar, plan, token }`.
- `GET /auth/verify` with the bearer token confirms an unexpired session. Offline, the stored
  session is kept rather than thrown away.
- Signing out clears `authToken`, `apiKey`, `apiKeys`, and `user`, and optionally all history
  including stale `conversation_*` keys.
- Silent re-verification on load never re-broadcasts `AUTH_SUCCESS`, so the welcome toast only
  appears for a real sign-in.

### Design decisions

- `sendMessage` is an **async generator** yielding text deltas — it keeps the streaming path
  native while still being easy to unit test.
- The sign-in overlay is **injected from JavaScript** rather than sitting in the HTML, so the chat
  markup stays clean and the overlay can be created exactly when it is needed.
- Auth is **verified on load** but never gated: the chat renders immediately, and the overlay
  appears if the session turns out to be invalid.
- Toasts live in a **fixed bottom-right container** — raised above the composer in the sidebar so
  they never cover the input.
- Skeletons are only ever shown for **real pending work** (a storage read), never as theatre.
- Page context strips the extension's own injected trigger before the text reaches the model.
- The sidebar's toast host is positioned `bottom: 128px` — still bottom-right, but clear of the
  composer toolbar.
- `chrome.storage.sync` owns preferences; the theme write is **merged**, never a whole-object
  overwrite, so unrelated appearance settings survive a theme toggle.
- The system preference is only read on the client: a service worker cannot access
  `prefers-color-scheme`, so first install seeds `"system"` and each page resolves it with
  `matchMedia`.

---

## What I Would Add With More Time

- **Real OAuth integration** — swap the implicit flow for PKCE with a background token exchange so
  refresh tokens and proper revocation work instead of the current "verify on every launch" model.
- **Cross-device sync** — push conversations (not just preferences) through `chrome.storage.sync`
  with a conflict-free merge, so a chat started on your laptop is waiting on your desktop.
- **Voice input** — hold-to-talk via the Web Speech API, with transcripts filling the composer and
  an inline waveform while recording.
- **Multi-language support** — extract every string into `_locales` message catalogues, add
  RTL layout support, and translate the system prompt and error copy too.
- **Extension onboarding tour** — a three-step spotlight over the popup, side panel, and Quick
  Actions the first time the extension is opened, skippable and re-openable from Settings.
- Branching, shareable conversations and Markdown export; a model-routing rule ("use the cheap
  model for summaries"); image and PDF attachments; and an offline queue that retries failed sends
  when connectivity returns.

---

## License

MIT

---

<div align="center">

**EchoGPT v2.0** — Multi-AI chat sidebar for Chrome
Built with Manifest V3, vanilla JavaScript, and CSS custom properties.

</div>
