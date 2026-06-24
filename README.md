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
| Authentication | `API Key` | Choose API key auth or GitHub Copilot device-code sign-in |
| API Endpoint | `https://api.omnillm.com/v1` | OmniLLM/Anthropic-compatible API endpoint for API key mode |
| API Key | — | Your API key for API key mode |
| API Format | `OpenAI-compatible` | Request shape for API key mode: OpenAI chat completions, Anthropic Messages, or OpenAI Responses |
| Model | `claude-sonnet-4-5` | Any model available to your selected provider |

OmniPilot works with [OmniLLM](https://github.com/OmniLLM) by default. It also supports OpenAI-compatible providers when configured with an OpenAI-style endpoint. In GitHub Copilot mode, OmniPilot signs in through GitHub's device-code flow, exchanges the GitHub OAuth token for a Copilot API token, lists models from `https://api.githubcopilot.com/models`, and sends requests directly to GitHub Copilot.

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
