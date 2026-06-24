# Modular Provider Picker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the current authentication selector with a modular provider picker supporting GitHub Copilot, Custom Provider, and Azure Foundry.

**Architecture:** Add a `providerType` config field and provider registries in `options.js` and `background.js`. GitHub Copilot keeps its current OAuth/model-list behavior, while Custom Provider and Azure Foundry share endpoint/API key/API format controls and `/models` discovery with manual model fallback.

**Tech Stack:** Chrome MV3 extension, vanilla JavaScript, Node `assert`/`vm` tests, Chrome storage/runtime APIs.

---

## File Structure

- Modify `background.js`: define provider constants/registry, migrate legacy `authMethod` to `providerType`, route Copilot vs endpoint providers through registry helpers, keep request-building API-shape logic intact.
- Modify `options.html`: rename the dropdown label to Provider and replace options with GitHub Copilot, Custom Provider, Azure Foundry. Keep element id `authMethod` if desired for minimal DOM churn, but prefer `providerType` if tests are updated consistently.
- Modify `options.js`: define provider constants/registry, migrate legacy storage, update UI visibility by provider, save `providerType`, keep `authMethod` migration compatibility.
- Modify `i18n.js`: add provider labels and change the existing authentication label to Provider.
- Modify `options.test.js`: add provider picker DOM fixtures and tests for provider UI, legacy migration, Azure API format visibility, and model fallback.
- Modify `background.test.js`: add tests for provider migration and Azure/Custom model discovery/request routing.

## Task 1: Add provider config migration in background

**Files:**
- Modify: `background.js`
- Test: `background.test.js`

- [ ] **Step 1: Write failing tests**

Add tests that assert legacy `authMethod` values map to `providerType`, Custom Provider and Azure Foundry fetch `<endpoint>/models`, and GitHub Copilot still fetches direct Copilot models.

```js
async function assertLegacyAuthMethodMigratesToProviderType() {
  const { context } = await createBackgroundContext({
    storage: { authMethod: 'github-copilot', endpoint: '', apiKey: '', model: 'gpt-4o' }
  });

  const config = await context.loadConfig();

  assert.strictEqual(config.providerType, 'github-copilot');
  assert.strictEqual(config.authMethod, 'github-copilot');
}

async function assertAzureFoundryModelListingUsesEndpointModels() {
  const { context, requests } = await createBackgroundContext({
    storage: {
      providerType: 'azure-foundry',
      endpoint: 'https://example.services.ai.azure.com/models',
      apiKey: 'azure-key',
      apiShape: 'openai-compatible'
    },
    fetchImpl: async url => ({
      ok: true,
      json: async () => ({ data: [{ id: 'azure-gpt-4o' }] })
    })
  });

  const models = await context.handleGetModels();

  assert.deepStrictEqual(JSON.parse(JSON.stringify(models)), ['azure-gpt-4o']);
  assert.strictEqual(requests[0].url, 'https://example.services.ai.azure.com/models/v1/models');
}
```

- [ ] **Step 2: Run failing test**

Run: `node background.test.js`
Expected: FAIL because `providerType` and Azure provider behavior are not implemented.

- [ ] **Step 3: Implement background provider registry**

Add provider constants and helpers:

```js
const PROVIDER_TYPES = {
  CUSTOM: 'custom-provider',
  GITHUB_COPILOT: 'github-copilot',
  AZURE_FOUNDRY: 'azure-foundry'
};

const AUTH_METHODS = {
  API_KEY: 'api-key',
  GITHUB_COPILOT: PROVIDER_TYPES.GITHUB_COPILOT
};

const PROVIDERS = {
  [PROVIDER_TYPES.GITHUB_COPILOT]: { usesCopilotAuth: true, requiresApiKey: false, supportsModelsEndpoint: false },
  [PROVIDER_TYPES.CUSTOM]: { usesCopilotAuth: false, requiresApiKey: true, supportsModelsEndpoint: true },
  [PROVIDER_TYPES.AZURE_FOUNDRY]: { usesCopilotAuth: false, requiresApiKey: true, supportsModelsEndpoint: true }
};

function normalizeProviderType(value, legacyAuthMethod) {
  if (PROVIDERS[value]) return value;
  if (legacyAuthMethod === AUTH_METHODS.GITHUB_COPILOT) return PROVIDER_TYPES.GITHUB_COPILOT;
  return PROVIDER_TYPES.CUSTOM;
}

function getProvider(config) {
  return PROVIDERS[normalizeProviderType(config.providerType, config.authMethod)] || PROVIDERS[PROVIDER_TYPES.CUSTOM];
}
```

Update `DEFAULT_CONFIG`, `STORAGE_KEYS`, `loadConfig`, `handleGetModels`, and `executeApiRequest` to use `providerType` while preserving `authMethod` for migration.

- [ ] **Step 4: Run background tests**

Run: `node background.test.js`
Expected: PASS.

## Task 2: Update options provider picker UI

**Files:**
- Modify: `options.html`
- Modify: `options.js`
- Modify: `i18n.js`
- Test: `options.test.js`

- [ ] **Step 1: Write failing tests**

Add tests that assert:

```js
async function testAzureFoundryUiShowsEndpointApiKeyApiShapeAndModel() {
  const { context, elements } = createTestContext();

  context.updateProviderTypeUI('azure-foundry');

  assert.strictEqual(elements.modelCard.style.display, '');
  assert.strictEqual(elements.endpointField.style.display, '');
  assert.strictEqual(elements.apiKeyField.style.display, '');
  assert.strictEqual(elements.apiShapeField.style.display, '');
  assert.strictEqual(elements.copilotSection.style.display, 'none');
}

async function testProviderChangeSavesProviderType() {
  const { elements, domListeners, syncWrites } = createTestContext();
  await domListeners.DOMContentLoaded();

  elements.providerType.value = 'azure-foundry';
  elements.providerType.listeners.change({ target: { value: 'azure-foundry' } });

  assert.deepStrictEqual(JSON.parse(JSON.stringify(syncWrites.at(-1))), { providerType: 'azure-foundry' });
}
```

- [ ] **Step 2: Run failing test**

Run: `node options.test.js`
Expected: FAIL because provider UI helpers and elements do not exist yet.

- [ ] **Step 3: Implement options provider registry**

Add provider constants and UI metadata:

```js
const PROVIDER_TYPES = {
  CUSTOM: 'custom-provider',
  GITHUB_COPILOT: 'github-copilot',
  AZURE_FOUNDRY: 'azure-foundry'
};

const PROVIDERS = {
  [PROVIDER_TYPES.GITHUB_COPILOT]: { showEndpoint: false, showApiKey: false, showApiShape: false, showCopilot: true, fetchModelsViaBackground: true },
  [PROVIDER_TYPES.CUSTOM]: { showEndpoint: true, showApiKey: true, showApiShape: true, showCopilot: false, fetchModelsViaBackground: false },
  [PROVIDER_TYPES.AZURE_FOUNDRY]: { showEndpoint: true, showApiKey: true, showApiShape: true, showCopilot: false, fetchModelsViaBackground: false }
};
```

Implement `normalizeProviderType`, `getProviderDefinition`, `updateProviderTypeUI`, and keep `updateAuthMethodUI` as a thin compatibility wrapper if tests or existing code still call it.

- [ ] **Step 4: Update HTML and i18n**

Change the dropdown label to use `data-i18n="provider"`, add options for the three provider values, and wrap API Format field in `id="apiShapeField"`. Add translations:

```js
provider: 'Provider',
providerCustom: 'Custom Provider',
providerGithubCopilot: 'GitHub Copilot',
providerAzureFoundry: 'Azure Foundry'
```

- [ ] **Step 5: Run options tests**

Run: `node options.test.js`
Expected: PASS.

## Task 3: Verify all tests and behavior

**Files:**
- Test: all `*.test.js`

- [ ] **Step 1: Run all tests**

Run:

```powershell
node background.test.js; node options.test.js; node popup.test.js; node i18n.test.js; node options-language.test.js; node content-language.test.js
```

Expected: all commands exit successfully.

- [ ] **Step 2: Manual code review checklist**

Check that:

```text
- GitHub Copilot model listing still calls https://api.githubcopilot.com/models.
- Custom Provider and Azure Foundry both show endpoint/API key/API format/model controls.
- Custom Provider and Azure Foundry both fall back to manual model entry if model discovery fails.
- New saves write providerType.
- Legacy authMethod configs still load correctly.
```

## Self-Review

- Spec coverage: provider picker replacement, three provider types, GitHub Copilot unchanged model listing, Custom Provider model fallback, Azure Foundry endpoint/API key/models/API type support, and modular registry approach are all covered.
- Placeholder scan: no TBD/TODO/placeholders remain.
- Type consistency: provider property is consistently named `providerType`; legacy `authMethod` is retained only as compatibility input.
