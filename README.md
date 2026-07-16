# ✦ OmniPilot

> **Open-source browser AI assistant** — select text, summarize pages, chat in context, and route work to your chosen LLM provider or A2A agents.

[![Chrome](https://img.shields.io/badge/Chrome-gray?logo=google-chrome&logoColor=white)](https://chrome.google.com/)
[![Firefox](https://img.shields.io/badge/Firefox-gray?logo=firefox&logoColor=white)](https://mozilla.org/firefox/)
[![Edge](https://img.shields.io/badge/Edge-gray?logo=microsoft-edge&logoColor=white)](https://microsoft.com/edge)

**Part of the [OmniLLM](https://github.com/OmniLLM) ecosystem** — universal LLM orchestration for the browser.

---

## What It Does

OmniPilot adds AI workflows directly to the browser:

- Select text on a webpage and open a floating OmniPilot action menu.
- Run actions such as **Translate**, **Summarize**, **Explain**, **Improve**, **Sentiment**, **Code Explain**, **Divide Paragraphs**, and **Ask**.
- Continue the result as a multi-turn chat in a draggable, resizable in-page panel.
- Summarize full pages or GitHub issues/pull requests from the context menu.
- Use the Chrome/Edge side panel for persistent chat.
- Connect to GitHub Copilot, Azure Foundry, or a custom OpenAI/Anthropic-compatible endpoint.
- Delegate work to configured A2A agents through auto-routing or `@AgentName` mentions.

---

## Key Features

- **In-page assistant UI** — selection bubble, action dropdown, streaming output, follow-up chat, copy controls, code-block copy, read-aloud, context chips, and runtime provider/model/action selectors.
- **Multiple provider modes** — GitHub Copilot device-flow sign-in, Custom Provider, and Azure Foundry.
- **Three API wire formats** — OpenAI Chat Completions, Anthropic Messages, and OpenAI Responses.
- **A2A agent orchestration** — discover agent cards, enable/disable servers and individual skills, run health checks, store local tokens, and let the model call enabled A2A skills as tools while preserving each skill's structured input schema.
- **Memory** — optional cross-session long-term notes plus rolling daily activity logs in browser local storage.
- **Guardrails** — deny-list mode for A2A tool dispatch by server domain and destructive/admin/payment-style skill tags.
- **Observability** — a Debug view with recent agent traces, tool dispatches, guardrail decisions, memory appends, and context-budget drops.
- **Browser-stored settings** — provider settings use browser sync storage; A2A metadata, memory, and traces use browser local storage when available. Prompts are sent to the selected provider or A2A server, with `https://api.omnillm.com/v1` as the default Custom Provider endpoint.

---

## Architecture

OmniPilot is a Manifest V3 extension. The manifest loads generated files from `dist/`, while source lives under `src/`.

### Browser surfaces

- **Background service worker** — `src/background/index.mjs` handles context menus, runtime messaging, streaming ports, provider requests, GitHub Copilot auth, A2A discovery/delegation, shared response deadlines, storage defaults, and API-shape conversion.
- **Content script** — `src/content-script/index.mjs` and `src/content-script/styles.css` render the selection bubble, dropdown, floating panel, follow-up chat, streaming responses, page extraction, GitHub issue/PR extraction, and extension-reload resilience.
- **Options page** — `src/options/` manages provider setup, model lists, A2A servers, memory, popup size, language/theme, and debug traces.
- **Popup** — `src/popup/` shows readiness status and shortcuts to settings, theme, and language.
- **Side panel** — `src/sidepanel/` provides persistent chat with streaming and timeout handling.

### Agent runtime

The agent runtime lives in `src/background/agent/`:

- `agent.mjs` assembles context, loads memory, starts observability runs, and chooses plain-provider or A2A-routed execution.
- `runner.mjs` runs the think/act/observe loop for provider tool calls.
- `session.mjs` tracks conversation history and duplicate tool dispatches.
- `tool-registry.mjs` is the execution choke point for tools.
- `a2a-tool-provider.mjs` maps discovered A2A servers and skills into callable tools.
- `memory.mjs`, `context-assembler.mjs`, `deadline.mjs`, `guardrails.mjs`, and `observability.mjs` provide persistent context, token-budget packing, request cancellation, dispatch checks, and trace storage.

### Context, memory, deadlines, guardrails, traces

- **Memory** uses `chrome.storage.local` for a user-editable long-term note and daily logs retained for a rolling window.
- **Context assembly** priority-packs system prompt, memory, recent activity, tool schemas, and chat history under `contextMaxTokens` while pinning the latest user message.
- **Response deadlines** apply one configurable total time budget across provider requests, streaming, A2A tool rounds, and A2A task polling. Expired requests abort in-flight fetches instead of leaving the UI waiting indefinitely.
- **Guardrails** currently support `off` and `deny-list` modes. Denied A2A tool calls are returned to the model as tool errors and written to an audit log.
- **Observability** stores a ring buffer of recent runs and events in local storage; the options page Debug card can refresh or clear traces.

---

## Installation

### Chrome / Edge

1. Download the [latest release](https://github.com/OmniLLM/omni-pilot/releases).
2. Extract the `omni-pilot-<version>.zip` archive.
3. Open `chrome://extensions/` or `edge://extensions/`.
4. Enable **Developer mode**.
5. Click **Load unpacked** and select the extracted folder.

### Firefox temporary install

1. Download and extract the [latest release](https://github.com/OmniLLM/omni-pilot/releases).
2. Open `about:debugging#/runtime/this-firefox`.
3. Click **Load Temporary Add-on**.
4. Select the extracted `manifest.json`.

---

## Configuration

Open the toolbar popup and click **Settings**, or open the extension options page directly.

### Providers

| Provider | Setup | Notes |
|---|---|---|
| **GitHub Copilot** | Use the built-in GitHub device-code sign-in flow. | The extension exchanges the GitHub token for a Copilot token and fetches Copilot models through the background worker. |
| **Custom Provider** | Enter endpoint, API key, API format, and model. | Works with OpenAI-compatible servers, Anthropic Messages-compatible endpoints, OmniLLM, Ollama/vLLM-style gateways, or other compatible APIs. |
| **Azure Foundry** | Enter endpoint, API key, API format, and manual model list. | Uses configured model IDs instead of fetching `/models`. |

Supported API formats:

- **OpenAI-compatible / Chat Completions**
- **Anthropic Messages**
- **OpenAI Responses**

### A2A servers

The options page includes a structured A2A server manager:

- Add server name, endpoint, and an optional local-only token.
- Discover agent cards/capabilities from `.well-known/agent-card.json` or `.well-known/agent.json`.
- Run health checks.
- Enable or disable whole servers.
- Enable or disable individual discovered skills.
- Enable auto-routing so the active model can choose enabled A2A tools.
- Preserve discovered JSON input schemas so structured skill arguments reach standalone agents and Omni Agent Hub tools intact.

Manual delegation is available by starting a prompt with an agent mention, for example:

```text
@Planner help me organize this task list
```

### Memory and debug controls

- **Enable cross-session memory** toggles long-term notes and recent activity injection.
- **Long-term notes** are editable from the Memory card.
- **Clear recent activity** removes daily logs, which otherwise retain the seven most recent logged dates.
- **Recent runs** in the Debug card show observability traces and can be refreshed or cleared.

### UI preferences

- Theme and language can be changed from popup/options.
- Current shared i18n strings support **English** and **Chinese**.
- Initial floating-panel width and height are configurable from settings.
- **Response timeout** defaults to 5 minutes and can be set from 0.5 to 30 minutes under Advanced Settings. It is a hard total limit for each AI request; streaming activity keeps the interface active but does not extend the request deadline.

---

## Usage

### Text actions

1. Open a webpage.
2. Select text.
3. Click the OmniPilot bubble.
4. Choose an action.
5. Read the streamed result in the floating panel.
6. Continue with follow-up chat, switch provider/model/action, copy content, or close the panel.

### Page and GitHub summaries

Use the browser context menu for:

- **Summarize Page** on general webpages.
- **Summarize Issue/PR** on GitHub issue and pull request pages.

### Side panel chat

Open the extension side panel for persistent chat that stays available while browsing.

---

## Privacy and Security

Read the full [Privacy Policy](PRIVACY.md).

- By default, the Custom Provider points to `https://api.omnillm.com/v1`; submitted content goes there unless you change the endpoint.
- Text and requested page content are sent to the provider endpoint or A2A server you configure when you submit an action or chat turn.
- API keys and provider settings are stored in browser sync storage and may synchronize through your browser account.
- A2A server definitions and tokens are stored separately in browser local storage when available.
- Memory, observability traces, and guardrail audit logs are stored in browser local storage.
- The manifest requests `storage`, `clipboardWrite`, `contextMenus`, and `sidePanel`, plus host access needed to inject the assistant and contact configured endpoints. It does not request the broad `tabs` permission.
- The code is open source and can be audited before loading the extension.

---

## Development

The project intentionally uses a small custom Node build script instead of a real bundler/IIFE. Unit tests load built artifacts in a VM and rely on top-level declarations remaining visible.

```text
omni-pilot/
├── manifest.json                         # MV3 manifest; loads dist/* files
├── build.mjs                             # custom concat/copy build script
├── pack.mjs                              # ZIP packager
├── Makefile                              # make package / clean-package / clean
├── package.json                          # npm scripts and dev dependencies
├── src/
│   ├── background/index.mjs              # service worker host layer
│   ├── background/agent/*.mjs            # agent runtime primitives and services
│   ├── background/copilot-model-shapes.mjs
│   ├── content-script/index.mjs          # selection UI and floating panel
│   ├── content-script/styles.css
│   ├── options/{index.html,index.mjs}
│   ├── popup/{index.html,index.mjs}
│   ├── sidepanel/{index.html,index.mjs}
│   └── utils/{i18n,timeout}.mjs
├── dist/                                 # generated; gitignored
├── icons/                                # extension icons
└── tests/
    ├── *.spec.js                         # Playwright browser specs
    ├── unit/*.test.js                    # Node VM unit tests against dist/*
    └── e2e/*.test.js                     # manual/live backend integration tests
```

### Setup

```bash
npm ci
npm run build
npx playwright install chromium  # one-time prerequisite for browser tests
```

Then load the repo root unpacked in Chrome/Edge after each build, or load an extracted release ZIP.

### Build

```bash
npm run build
```

The build script recreates `dist/`, inlines timeout helpers into every JavaScript bundle, adds shared i18n and agent/provider runtime code where needed, and copies the HTML/CSS assets.

### Tests

```bash
npm test                 # unit tests + Playwright browser specs
npm run test:unit        # Node VM unit tests only
npm run test:playwright  # Playwright specs only
```

`npm test` does not run `tests/e2e/*.test.js`. Those integration tests are manual/live-backend checks and may require local OmniLLM/Omni Agent Hub configuration such as `~/.config/omnilauncher/settings.json` and `~/.config/omnillm/api-key`.

### Packaging a release

```bash
make package          # builds dist/ and writes omni-pilot-<version>.zip
make clean-package    # removes omni-pilot-*.zip
make clean            # removes ZIPs and dist/
```

The ZIP contains exactly the extension loadout: `manifest.json`, `PRIVACY.md`, `icons/`, and `dist/`. The manifest references the same `dist/` paths in development and in packaged releases.

---

## Contributing

Useful contribution areas:

- New provider integrations in `src/background/index.mjs`.
- New or improved translations in `src/utils/i18n.mjs`.
- A2A agent compatibility and delegation improvements.
- Tests for content-script UI behavior, provider request shaping, extension reload resilience, and settings workflows.
- Bug reports with browser, provider mode, model, and reproducible steps.

---

## Ecosystem

Part of **OmniLLM** — a unified platform for LLM integration:

- **[OmniPilot](https://github.com/OmniLLM/omni-pilot)** ← You are here
- **[OmniLLM Core](https://github.com/OmniLLM)** — orchestration engine

---

## Acknowledgments

Inspired by [ChatGPT Box](https://github.com/ChatGPTBox-dev/chatGPTBox) and similar community projects. Thanks to all contributors and users.

**Questions?** [Open an issue](https://github.com/OmniLLM/omni-pilot/issues) or join the [OmniLLM community](https://github.com/OmniLLM).
