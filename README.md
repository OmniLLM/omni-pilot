# ✦ OmniPilot

> AI-powered browser assistant — select text, get instant AI actions.

Part of the [OmniLLM](https://github.com/OmniLLM) ecosystem.

## Features

- **Select any text** on any webpage → floating bubble appears
- **Choose an action** from the dropdown:
  - 🌍 **Translate** — to English (or Chinese if already English)
  - 📝 **Summarize** — 2-3 sentence summary
  - 💡 **Explain** — clear, simple explanation
  - ✨ **Improve** — polished rewrite, same language
- Results shown in a clean dark floating panel
- Works on Chrome and Firefox (Manifest V3)

## Installation

### Chrome / Edge
1. Go to `chrome://extensions/`
2. Enable **Developer mode** (top right)
3. Click **Load unpacked** → select this folder

### Firefox
1. Go to `about:debugging#/runtime/this-firefox`
2. Click **Load Temporary Add-on** → select `manifest.json`

## Configuration

Click the OmniPilot toolbar icon → **Settings**, or go to the extension options page:

| Field | Default | Description |
|-------|---------|-------------|
| Provider | `Custom Provider` | Select `GitHub Copilot`, `Custom Provider`, or `Azure Foundry` from Settings or the in-panel provider selector |
| API Endpoint | `https://api.omnillm.com/v1` | Base URL for the selected endpoint-based provider; OmniPilot normalizes host-only URLs to include `/v1` |
| API Key | — | API key for the active endpoint-based provider; hidden when `GitHub Copilot` is selected |
| API Format | `OpenAI-compatible` | Request shape for the active endpoint-based provider: OpenAI chat completions, Anthropic Messages, or OpenAI Responses |
| Model | `claude-sonnet-4-5` | Active model for the selected provider |
| A2A Servers | — | Comma- or newline-separated manual model/server list used for A2A-capable providers that rely on local server definitions |

OmniPilot works with [OmniLLM](https://github.com/OmniLLM) by default. It also supports OpenAI-compatible providers when configured with an OpenAI-style endpoint. In GitHub Copilot mode, OmniPilot signs in through GitHub's device-code flow, exchanges the GitHub OAuth token for a Copilot API token, lists models from `https://api.githubcopilot.com/models`, and sends requests directly to GitHub Copilot.

### A2A Delegation

A2A client support is configured through the same provider settings. Use **Provider** to switch between the built-in providers and any A2A-capable server-backed option exposed by the extension. A2A metadata is synchronized through extension settings, while any short-lived token material remains local to the current browser profile rather than being synced.

When A2A servers are configured, they appear in the in-panel provider selector alongside the built-in providers. Select the desired A2A server, then use the normal chat or action flow to delegate through that A2A target. In practice, the flow is: open OmniPilot, choose the A2A server from the provider selector, and then run your prompt/action so OmniPilot delegates the request to that A2A server.

#### Auto-routing to A2A agents

When the **Auto-route to A2A agents** setting is enabled (the default), OmniPilot exposes each discovered, enabled A2A server to the active model as a tool. The model decides per prompt whether to delegate to one of those agents based on each agent card's name, description, and skills. The tool call is intercepted by the background script, dispatched to the matching A2A endpoint via `delegateA2aTask`, and the agent's response is fed back to the model to produce the final reply.

Auto-routing is supported across all three API formats (OpenAI chat completions, Anthropic Messages, and OpenAI Responses). If a provider rejects tools for the active model, OmniPilot transparently retries the request without tools so chat keeps working.

You can always override auto-routing by **@-mentioning** a server in your prompt (for example, `@Planner draft a weekly plan`). Mentions are matched in the content script before the request reaches the model, so they bypass auto-routing entirely. Turn the toggle off if you prefer mention-only routing.

## Usage

1. Visit any webpage
2. Select text with your mouse
3. Click the **✦ OmniPilot** bubble that appears
4. Choose an action
5. View result in the panel — press `Esc` to dismiss

## Development

No build step required. Pure vanilla JS, no dependencies.

```
omni-pilot/
├── manifest.json     # Extension manifest (MV3)
├── content.js        # Selection detection + UI
├── background.js     # API calls (service worker)
├── styles.css        # All UI styles
├── popup.html/js     # Toolbar popup
├── options.html/js   # Settings page
└── icons/            # Extension icons
```

## License

MIT © [OmniLLM](https://github.com/OmniLLM)
