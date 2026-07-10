# Chrome Web Store Policy Remediation Design

**Date:** 2026-07-10
**Status:** Approved

## Objective

Resolve the Chrome Web Store rejection for OmniPilot 1.0.1 by:

1. Removing the unnecessary `tabs` permission.
2. Publishing an accurate privacy policy at a stable, publicly accessible URL.
3. Making the privacy policy easy to find from the repository README.

The public policy URL will be:

`https://github.com/OmniLLM/omni-pilot/blob/main/PRIVACY.md`

## Scope

### Manifest permission

Remove only `tabs` from `manifest.json`. Keep `storage`, `clipboardWrite`, `contextMenus`, `sidePanel`, and `<all_urls>` because they support implemented extension behavior.

The existing uses of `chrome.tabs.sendMessage` and `chrome.tabs.create` do not require the `tabs` permission. OmniPilot does not read privileged tab properties such as URLs, titles, or favicons through the Tabs API.

### Privacy policy

Add `PRIVACY.md` at the repository root. The policy will accurately describe:

- Data processed when the user invokes OmniPilot, including selected text, submitted prompts, page content requested for summarization, conversation context, and A2A requests.
- Provider credentials and configuration stored in browser sync storage, which may synchronize through the user's browser account.
- A2A tokens and server definitions stored in browser local storage when available, with sync fallback and legacy migration behavior documented.
- Memory, activity logs, traces, and guardrail audit data stored in browser local storage.
- Transmission to services selected or configured by the user, including GitHub Copilot, Azure Foundry, custom compatible model endpoints, and A2A servers.
- The default Custom Provider endpoint, `https://api.omnillm.com/v1`, and the fact that submitted content goes there unless the user changes it.
- User control over submission, local retention, deletion, and extension removal.
- Third-party service terms, limited security guarantees, policy updates, and GitHub Issues as the privacy contact channel.

The policy must not claim that data never leaves the device because AI requests necessarily transmit content to the user's chosen provider or A2A server.

### README discoverability

Add a direct link to `PRIVACY.md` in the README's Privacy and Security section. The Chrome Web Store dashboard still requires the public URL in its designated Privacy tab; a README link alone does not satisfy that dashboard requirement.

## Data flow

1. The user selects text, submits a chat message, requests page summarization, or delegates to an A2A agent.
2. OmniPilot assembles the requested content and locally stored context needed for that action.
3. OmniPilot sends the request to the provider or A2A server selected or configured by the user.
4. The response is displayed in the extension.
5. Provider configuration and credentials remain in browser sync storage and may synchronize through the user's browser account. A2A records use local storage when available with sync fallback, while memory, activity logs, traces, and guardrail audit records remain in browser local storage until cleared, overwritten by retention behavior, or removed with extension data.

OmniPilot does not introduce a new backend, tracking service, or policy-hosting service as part of this remediation.

## Error handling and compatibility

Removing `tabs` must not change context-menu messaging or opening the GitHub Copilot verification page. Existing browser API behavior will be retained without fallback permission requests.

The public policy depends on the repository remaining public and the `main` branch retaining `PRIVACY.md`. If the repository or default branch changes, the Chrome Web Store privacy URL must be updated.

## Verification

- Confirm `tabs` is absent from the source and packaged manifests.
- Search for Tabs API usage and confirm no call reads privileged tab metadata.
- Run the full existing test suite.
- Build and package the extension.
- Confirm the package remains loadable and the affected context-menu and Copilot verification flows work.
- Confirm the privacy URL is publicly reachable after the changes are pushed to `main`.

## Release and resubmission

A new extension package should use a version greater than 1.0.1. In the Chrome Web Store Developer Dashboard:

1. Upload the new package.
2. Open the item's **Privacy** tab.
3. Enter `https://github.com/OmniLLM/omni-pilot/blob/main/PRIVACY.md` in the designated privacy-policy field.
4. Review the data-use disclosures so they match the policy and extension behavior.
5. Resubmit the draft, referencing removal of the unnecessary `tabs` permission and addition of the public privacy policy.
