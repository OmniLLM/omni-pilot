---
name: verify
summary: Exercise the built OmniPilot extension in headed Chromium.
---

# Verify OmniPilot

1. Build the extension with `npm run build`.
2. Launch a persistent headed Chromium context with Playwright using:
   - `--disable-extensions-except=<repo root>`
   - `--load-extension=<repo root>`
3. Wait for the extension service worker and use `chrome.runtime.getManifest()` to inspect the loaded version and permissions.
4. For Tabs API compatibility, call `chrome.tabs.create()` from the service worker, wait for the target page, then call `chrome.tabs.sendMessage()` to its content script.
5. Open `chrome-extension://<runtime id>/dist/options.html` and confirm the settings page renders.

Headless Chromium does not load the extension service worker in this environment; use `headless: false`.
