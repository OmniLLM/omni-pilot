# ✦ OmniPilot

> **AI-powered browser assistant** — Select text, get instant AI actions. Completely open source, works with any LLM.

[![Chrome](https://img.shields.io/badge/Chrome-gray?logo=google-chrome&logoColor=white)](https://chrome.google.com/)
[![Firefox](https://img.shields.io/badge/Firefox-gray?logo=firefox&logoColor=white)](https://mozilla.org/firefox/)
[![Edge](https://img.shields.io/badge/Edge-gray?logo=microsoft-edge&logoColor=white)](https://microsoft.com/edge)
[![MIT License](https://img.shields.io/badge/license-MIT-green)](LICENSE)
[![Tests Passing](https://img.shields.io/badge/tests-passing-brightgreen)]()

**Part of the [OmniLLM](https://github.com/OmniLLM) ecosystem** — Universal LLM orchestration for the browser.

---

## 🎯 What It Does

Select any text on any webpage, choose an action, get results in a floating panel:

| 🌍 Translate | 📝 Summarize | 💡 Explain | ✨ Improve |
|---|---|---|---|
| To English (or Chinese if English) | 2-3 sentence summary | Clear, simple explanation | Polished rewrite, same language |

**Works everywhere** — Gmail, Twitter, Reddit, Medium, PDFs, code editors, everywhere you read text.

---

## ✨ Key Features

✅ **Works on any website** — Gmail, Docs, Reddit, GitHub, Twitter, anywhere with text  
✅ **Choose your AI** — OpenAI, Claude, local models, custom endpoints  
✅ **No data collection** — Everything runs locally; we never store your text  
✅ **Offline ready** — Works with self-hosted LLMs  
✅ **Privacy first** — Open source, transparent, auditable  
✅ **Multi-language** — English, Chinese, Japanese, Indonesian, Turkish  
✅ **Lightweight** — Pure vanilla JavaScript; only esbuild is used at build time  

### 🔌 Advanced Features

- **Smart Provider Routing** — Switch between Claude, OpenAI, GitHub Copilot, or custom endpoints instantly
- **A2A Agent Delegation** — Delegate tasks to specialized AI agents automatically
- **Format Flexibility** — Works with OpenAI, Anthropic, or custom API formats
- **Provider Auto-Routing** — LLM chooses the best agent for each task

## Architecture

Background service-worker logic is split between two areas:

- **`src/background/index.mjs`** — Chrome runtime code: context menus, ports, message routing, `chrome.storage` schemas, provider abstraction (custom / GitHub Copilot / Azure Foundry), OAuth flows, and the streaming SSE parsers.
- **`src/background/agent/`** — Harness-style agent primitives (`Agent`, `Runner`, `Tool`, `ToolRegistry`, `Session`, `State`) plus the A2A tool provider. Files are concatenated into `dist/background.js` by `build.mjs` before the entry file, so declarations are top-level bindings at runtime.

### Memory

The Agent maintains cross-session memory via `src/background/agent/memory.mjs`:

- **Long-term memory** — a user-editable string (like a project's `MEMORY.md`), edited from the extension's options page. Prepended to the system prompt on every chat/action.
- **Daily activity logs** — a rolling 7-day window of one-line entries the Agent appends after each successful turn. Also injected into the system prompt so the model has recent context across restarts.

Both tiers live in `chrome.storage.local`. Users can disable memory or clear the daily logs from the options page.

The agent primitives are inspired by [Google's Agent Development Kit](https://adk.dev/get-started/) and the harness patterns from the [Harness Guide](https://harness-guide.com/guide/what-is-harness/) (agentic loop, tool registry, session/context/memory separation). Memory has since been added (see below); later phases add priority-based context assembly, guardrails, and observability on top of these primitives.

---

## 📦 Installation

### Chrome / Edge

1. Download the [latest release](https://github.com/OmniLLM/omni-pilot/releases)
2. Go to `chrome://extensions/`
3. Enable **Developer mode** (top right)
4. Click **Load unpacked** → select this folder

### Firefox

1. Download the [latest release](https://github.com/OmniLLM/omni-pilot/releases)
2. Go to `about:debugging#/runtime/this-firefox`
3. Click **Load Temporary Add-on** → select `manifest.json`

---

## ⚙️ Configuration

Click the **✦** toolbar icon → **Settings**, or go to the extension options page.

### Basic Settings

| Setting | Default | What it does |
|---------|---------|-------------|
| **Provider** | Custom Provider | Claude, OpenAI, GitHub Copilot, or custom endpoint |
| **Model** | `claude-sonnet-4-5` | Which model to use |
| **API Key** | — | Your API key (not needed for GitHub Copilot) |

### Advanced Settings

| Setting | Default | What it does |
|---------|---------|-------------|
| **API Endpoint** | `https://api.omnillm.com/v1` | Custom OpenAI-compatible server |
| **API Format** | OpenAI chat | Request format: OpenAI, Anthropic, or custom |
| **A2A Servers** | — | Comma/newline-separated local agent servers |
| **Auto-route to agents** | Enabled | Let the model pick the best agent automatically |

### 🤖 Provider Modes

**OpenAI-Compatible** — Works with OpenAI, Azure, Ollama, vLLM, any endpoint with OpenAI API format.

**Anthropic** — Direct support for Claude models. Uses the Messages API for better tool calling.

**GitHub Copilot** — Sign in through GitHub. OmniPilot handles token exchange automatically.

**A2A Agents** — Route requests to local AI agents. Perfect for specialized tasks (research, coding, analysis).

---

## 🚀 Usage

1. **Open any webpage**
2. **Select text** with your mouse
3. **Click the ✦ bubble** that appears
4. **Choose an action** from the menu
5. **View result** in the floating panel
6. **Press Esc** to dismiss

### Advanced: Agent Delegation

If you have A2A agents configured:

- **Auto-routing** — The model picks the best agent automatically
- **Manual selection** — Click the provider dropdown to pick a specific agent
- **Mentions** — Type `@AgentName` in your prompt to force routing to that agent

Example: `@Planner help me organize my schedule`

---

## 🔒 Privacy & Security

✅ **No data collection** — This extension does NOT collect, store, or send your text to us  
✅ **Open source** — Audit the code, verify the claims  
✅ **Local-first** — Everything stays in your browser until you submit to your LLM  
✅ **Your keys, your control** — API keys stay in your browser profile, not our servers

---

## 🛠️ Development

Sources live in `src/`; running `npm run build` bundles them into `dist/` via
esbuild. The `manifest.json` loads scripts and HTML from `dist/` — always
rebuild after editing sources.

```
omni-pilot/
├── manifest.json                   # Extension manifest (Manifest V3) — loads dist/*
├── build.mjs                       # esbuild bundler (src/ → dist/)
├── pack.mjs                        # ZIP packager (manifest + icons/ + dist/)
├── Makefile                        # `make package` → omni-pilot-<version>.zip
├── package.json                    # npm scripts (build, test:unit, test:playwright)
├── src/
│   ├── background/index.mjs        # Service worker: API calls, provider logic, A2A
│   ├── content-script/index.mjs    # Selection detection + floating panel UI
│   ├── content-script/styles.css   # All in-page styles
│   ├── popup/{index.html,index.mjs}       # Toolbar popup
│   ├── options/{index.html,index.mjs}     # Settings page
│   ├── sidepanel/{index.html,index.mjs}   # Chrome side panel
│   └── utils/i18n.mjs              # Internationalization (shared across pages)
├── dist/                           # Built output (gitignored) — loaded by the extension
├── icons/                          # Extension icons (16x16, 48x48, 128x128)
└── tests/
    ├── *.spec.js                   # Playwright E2E specs (browser-driven)
    ├── unit/*.test.js              # Node unit tests (vm-sandboxed dist/*.js)
    └── e2e/*.test.js               # Live-backend integration tests (skipped by default)
```

### Packaging a release

```bash
make package          # → omni-pilot-<version>.zip (ready for Load unpacked or Web Store upload)
make clean-package    # remove all omni-pilot-*.zip
make clean            # remove ZIPs and dist/
```

The ZIP contains `manifest.json`, `icons/`, and `dist/` — the same layout the
manifest references in development, so `Load unpacked` on either the extracted
ZIP or on the repo root (after `npm run build`) produces an identical
extension.

### Running Tests

```bash
npm test              # Unit tests + Playwright specs (build runs automatically)
npm run test:unit     # Node vm-sandbox unit tests only
npm run test:playwright # Playwright browser specs only
```

### Core Architecture

| Module | Role |
|--------|------|
| **src/content-script** | Detects text selection, renders floating bubble, handles UI interactions |
| **src/background** | Service worker: manages API calls, provider logic, A2A delegation, storage |
| **src/options** | Settings UI, provider configuration, A2A server management |
| **src/utils/i18n** | Multi-language support (strings, formatting) — shared across pages |

---

## 📝 Supported Languages

- 🇬🇧 English
- 🇨🇳 中文 (Chinese)
- 🇯🇵 日本語 (Japanese)
- 🇮🇩 Bahasa Indonesia
- 🇹🇷 Türkçe (Turkish)

Contributions welcome! Add a language by extending `i18n.js`.

---

## 🤝 Contributing

We welcome contributions! Areas we need help with:

- **New languages** — Add translations to `src/utils/i18n.mjs`
- **New providers** — Extend `src/background/index.mjs` with more AI services
- **Bug reports** — File issues with reproducible steps
- **Feature requests** — Discuss in issues first

### Development Setup

1. Clone this repo
2. Run `npm install` to fetch the esbuild bundler
3. Run `npm run build` to produce `dist/`
4. Load `omni-pilot/` unpacked in Chrome/Firefox (see Installation)
5. Edit files under `src/`, run `npm run build`, then reload the extension
6. Run tests: `npm test`

---

## 📚 Ecosystem

Part of **OmniLLM** — a unified platform for LLM integration:

- **[OmniPilot](https://github.com/OmniLLM/omni-pilot)** ← You are here
- **[OmniLLM Core](https://github.com/OmniLLM)** — Orchestration engine

---

## 📄 License

MIT © [OmniLLM](https://github.com/OmniLLM)

---

## 🙏 Acknowledgments

Inspired by [ChatGPT Box](https://github.com/ChatGPTBox-dev/chatGPTBox) and similar community projects. Thanks to all contributors and users.

**Questions?** [Open an issue](https://github.com/OmniLLM/omni-pilot/issues) or join the [OmniLLM community](https://github.com/OmniLLM).
