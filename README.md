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
✅ **Lightweight** — Zero dependencies, pure vanilla JavaScript  

### 🔌 Advanced Features

- **Smart Provider Routing** — Switch between Claude, OpenAI, GitHub Copilot, or custom endpoints instantly
- **A2A Agent Delegation** — Delegate tasks to specialized AI agents automatically
- **Format Flexibility** — Works with OpenAI, Anthropic, or custom API formats
- **Provider Auto-Routing** — LLM chooses the best agent for each task

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

No build step required. Pure vanilla JavaScript, no dependencies.

```
omni-pilot/
├── manifest.json       # Extension manifest (Manifest V3)
├── content.js          # Selection detection + UI rendering
├── background.js       # API calls & provider orchestration (service worker)
├── i18n.js             # Internationalization support
├── styles.css          # All UI styles
├── popup.html/js       # Toolbar popup & provider selector
├── options.html/js     # Settings page & configuration
├── icons/              # Extension icons (16x16, 48x48, 128x128)
├── *.test.js           # Unit tests (Node)
└── tests/              # E2E tests (Playwright)
```

### Running Tests

```bash
npm test              # All tests (unit + E2E)
npm run test:unit     # Unit tests only
npm run test:playwright # E2E tests only
```

### Core Architecture

| Module | Role |
|--------|------|
| **content.js** | Detects text selection, renders floating bubble, handles UI interactions |
| **background.js** | Service worker; manages API calls, provider logic, A2A delegation, storage |
| **options.js** | Settings UI, provider configuration, A2A server management |
| **i18n.js** | Multi-language support (strings, formatting) |

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

- **New languages** — Add translations to `i18n.js`
- **New providers** — Extend `background.js` with more AI services
- **Bug reports** — File issues with reproducible steps
- **Feature requests** — Discuss in issues first

### Development Setup

1. Clone this repo
2. Load it unpacked in Chrome/Firefox (see Installation)
3. Edit files, save, reload extension
4. Run tests: `npm test`

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
