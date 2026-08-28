// Shared catalog of provider identities and built-in functions.
//
// Both the content script's floating panel and the side panel present the same
// provider list and the same built-in functions. These used to live privately
// in the content script; keeping one definition means the two surfaces cannot
// drift apart.
//
// build.mjs inlines this file into the bundles that need it (the `import` line
// is stripped), so the declarations below land at top level.

const PROVIDER_LABELS = {
  'custom-provider': 'Custom',
  'github-copilot': 'GitHub Copilot',
  'azure-foundry': 'Azure Foundry'
};

function getProviderEntries() {
  return Object.entries(PROVIDER_LABELS)
    .map(([providerType, label]) => ({ providerType, label }));
}

// `labelKey` indexes the translation table; `id` is the action name the
// background's ACTION_PROMPTS map is keyed by.
const ACTIONS = [
  { id: 'translate', labelKey: 'translate', icon: '🌍' },
  { id: 'summarize', labelKey: 'summarize', icon: '📝' },
  { id: 'explain', labelKey: 'explain', icon: '💡' },
  { id: 'improve', labelKey: 'improve', icon: '✨' },
  { id: 'sentiment', labelKey: 'sentiment', icon: '😊' },
  { id: 'code-explain', labelKey: 'codeExplain', icon: '🔧' },
  { id: 'divide-paragraphs', labelKey: 'divideParagraphs', icon: '📋' },
  { id: 'ask', labelKey: 'ask', icon: '❓' }
];

export { PROVIDER_LABELS, getProviderEntries, ACTIONS };
