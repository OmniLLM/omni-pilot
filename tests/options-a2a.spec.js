const { test, expect } = require('@playwright/test');
const path = require('path');

const optionsUrl = `file://${path.resolve(__dirname, '..', 'dist', 'options.html').replace(/\\/g, '/')}`;

/**
 * Opens the options page with a stubbed `chrome` surface.
 *
 * A2A agents and their tokens both live in `chrome.storage.local`, so both are
 * seeded there. The stub records every write so tests can assert on persistence.
 */
async function openOptionsPage(page, { servers = [], tokens = {}, syncStorage = {} } = {}) {
  await page.addInitScript(({ servers, tokens, syncStorage }) => {
    const syncStore = { languagePreference: 'en', ...syncStorage };
    const localStore = { a2aServers: servers, a2aServerTokens: tokens };
    const writes = [];
    const messages = [];
    const storageListeners = [];

    function makeArea(store, areaName) {
      return {
        get(keys, callback) {
          if (Array.isArray(keys)) {
            callback(Object.fromEntries(keys.map(key => [key, store[key]])));
            return;
          }
          if (keys && typeof keys === 'object') {
            const result = { ...keys };
            for (const key of Object.keys(keys)) {
              if (Object.prototype.hasOwnProperty.call(store, key)) result[key] = store[key];
            }
            callback(result);
            return;
          }
          callback({ ...store });
        },
        set(values, callback) {
          const changes = {};
          for (const [key, newValue] of Object.entries(values)) {
            changes[key] = { oldValue: store[key], newValue };
          }
          Object.assign(store, JSON.parse(JSON.stringify(values)));
          writes.push(JSON.parse(JSON.stringify(values)));
          for (const listener of storageListeners) listener(changes, areaName);
          callback?.();
        },
        remove(keys, callback) {
          for (const key of [].concat(keys)) delete store[key];
          callback?.();
        }
      };
    }

    window.__omniPilotTestState = { syncStore, localStore, writes, messages };
    window.chrome = {
      runtime: {
        lastError: null,
        sendMessage(message, callback) {
          messages.push(message);
          if (message.type === 'GET_MODELS') {
            callback({ models: [] });
            return;
          }
          if (message.type === 'A2A_DISCOVER_SERVER') {
            callback({
              success: true,
              agentCard: {
                name: 'Discovered Agent',
                skills: [{ id: 'alpha', name: 'Alpha' }]
              }
            });
            return;
          }
          callback({ status: 'pending' });
        }
      },
      storage: {
        sync: makeArea(syncStore, 'sync'),
        local: makeArea(localStore, 'local'),
        onChanged: {
          addListener(listener) { storageListeners.push(listener); },
          removeListener(listener) {
            const index = storageListeners.indexOf(listener);
            if (index >= 0) storageListeners.splice(index, 1);
          }
        }
      },
      tabs: { create() {} }
    };
    window.fetch = async () => ({ ok: true, json: async () => ({ data: [] }) });
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: async () => {} },
      configurable: true
    });
  }, { servers, tokens, syncStorage });

  await page.goto(optionsUrl);
  await page.waitForLoadState('domcontentloaded');

  // The agent list lives inside the collapsed "Advanced" section; open it so the
  // rendered controls are actually clickable.
  const advancedToggle = page.locator('#advancedToggle');
  if (await advancedToggle.count()) {
    if ((await advancedToggle.getAttribute('aria-expanded')) !== 'true') {
      await advancedToggle.click();
    }
  }
}

/** Reads the most recent persisted `a2aServers` array from the stub's write log. */
function persistedServers(page) {
  return page.evaluate(() => {
    const writes = window.__omniPilotTestState.writes.filter(write => Array.isArray(write.a2aServers));
    return writes.length ? writes[writes.length - 1].a2aServers : null;
  });
}

const SIMPLE_SERVER = {
  id: 'server-1',
  name: 'Stored Server',
  endpoint: 'https://stored.example.com',
  enabled: true
};

const SKILLED_SERVER = {
  id: 'server-skills',
  name: 'Skilled Agent',
  endpoint: 'https://skills.example.com',
  enabled: true,
  agentCard: {
    name: 'Skilled Agent',
    skills: [
      { id: 'alpha', name: 'Alpha Skill', description: 'Does alpha things' },
      { id: 'beta', name: 'Beta Skill', description: 'Does beta things' }
    ]
  },
  disabledSkillIds: ['beta']
};

test('renders the agent name and endpoint', async ({ page }) => {
  await openOptionsPage(page, { servers: [SIMPLE_SERVER] });

  const item = page.locator('.a2a-server-item[data-server-id="server-1"]');
  await expect(item).toHaveCount(1);
  await expect(item.locator('.a2a-server-name')).toContainText('Stored Server');
  await expect(item.locator('.a2a-server-endpoint')).toHaveText('https://stored.example.com');
});

test('never renders a stored token in the agent list', async ({ page }) => {
  await openOptionsPage(page, {
    servers: [SIMPLE_SERVER],
    tokens: { 'server-1': 'super-secret-token' }
  });

  await expect(page.locator('.a2a-server-item[data-server-id="server-1"]')).toHaveCount(1);
  const listText = await page.locator('#a2aServerList').innerText();
  expect(listText).not.toContain('super-secret-token');
});

test('renders markup in agent metadata as literal text', async ({ page }) => {
  await openOptionsPage(page, {
    servers: [{
      id: 'server-xss',
      name: '<img src=x onerror="window.__pwned = true">Evil',
      endpoint: 'https://evil.example.com/<script>window.__pwned2 = true</script>',
      enabled: true,
      agentCard: {
        name: 'Evil',
        skills: [{
          id: 'sk<b>1</b>',
          name: '<span class="injected">Skill</span>',
          description: '<i class="injected">desc</i>'
        }]
      }
    }]
  });

  const item = page.locator('.a2a-server-item[data-server-id="server-xss"]');
  await expect(item).toHaveCount(1);

  // The metadata must appear as text, not as parsed elements.
  await expect(item.locator('.a2a-server-name')).toContainText('<img src=x onerror=');
  await expect(page.locator('#a2aServerList img')).toHaveCount(0);
  await expect(page.locator('#a2aServerList script')).toHaveCount(0);

  await page.locator('[data-action="toggle-skills-panel"][data-server-id="server-xss"]').click();
  await expect(page.locator('.a2a-skill-row')).toHaveCount(1);
  await expect(page.locator('#a2aServerList .injected')).toHaveCount(0);
  await expect(page.locator('.a2a-skill-name')).toContainText('<span class="injected">Skill</span>');

  const pwned = await page.evaluate(() => [window.__pwned, window.__pwned2]);
  expect(pwned).toEqual([undefined, undefined]);
});

test('offers a disable control for enabled agents and an enable control for disabled ones', async ({ page }) => {
  await openOptionsPage(page, {
    servers: [
      { id: 'a', name: 'AgentA', endpoint: 'https://a.example', enabled: true },
      { id: 'b', name: 'AgentB', endpoint: 'https://b.example', enabled: false }
    ]
  });

  await expect(page.locator('[data-action="disable"][data-server-id="a"]')).toHaveCount(1);
  await expect(page.locator('[data-action="enable"][data-server-id="b"]')).toHaveCount(1);

  await expect(page.locator('.a2a-server-item[data-server-id="a"]')).not.toHaveClass(/disabled/);
  await expect(page.locator('.a2a-server-item[data-server-id="b"]')).toHaveClass(/disabled/);
  await expect(page.locator('.a2a-server-item[data-server-id="b"] .disabled-label')).toHaveCount(1);
});

test('renders the standard action controls for each agent', async ({ page }) => {
  await openOptionsPage(page, { servers: [SIMPLE_SERVER] });

  for (const action of ['edit', 'disable', 'health', 'discover', 'remove']) {
    await expect(page.locator(`[data-action="${action}"][data-server-id="server-1"]`)).toHaveCount(1);
  }
  await expect(page.locator('[data-action="health"][data-server-id="server-1"]'))
    .toHaveAttribute('data-endpoint', 'https://stored.example.com');
});

test('renders a health indicator addressable by agent id', async ({ page }) => {
  await openOptionsPage(page, { servers: [SIMPLE_SERVER, SKILLED_SERVER] });

  await expect(page.locator('.a2a-health-dot[data-health-for="server-1"]')).toHaveCount(1);
  await expect(page.locator('.a2a-health-dot[data-health-for="server-skills"]')).toHaveCount(1);
});

test('disabling an agent persists the state and re-renders the opposite control', async ({ page }) => {
  await openOptionsPage(page, {
    servers: [{ id: 'a', name: 'AgentA', endpoint: 'https://a.example', enabled: true }]
  });

  await page.locator('[data-action="disable"][data-server-id="a"]').click();

  await expect(page.locator('[data-action="enable"][data-server-id="a"]')).toHaveCount(1);
  await expect(page.locator('[data-action="disable"][data-server-id="a"]')).toHaveCount(0);
  expect((await persistedServers(page))[0].enabled).toBe(false);
});

test('enabling an agent persists the state and re-renders the opposite control', async ({ page }) => {
  await openOptionsPage(page, {
    servers: [{ id: 'a', name: 'AgentA', endpoint: 'https://a.example', enabled: false }]
  });

  await page.locator('[data-action="enable"][data-server-id="a"]').click();

  await expect(page.locator('[data-action="disable"][data-server-id="a"]')).toHaveCount(1);
  expect((await persistedServers(page))[0].enabled).toBe(true);
});

test('removing an agent clears it from the list and from storage', async ({ page }) => {
  await openOptionsPage(page, { servers: [SIMPLE_SERVER] });

  await page.locator('[data-action="remove"][data-server-id="server-1"]').click();

  await expect(page.locator('.a2a-server-item')).toHaveCount(0);
  expect(await persistedServers(page)).toEqual([]);
});

test('summarises enabled skills and expands the skill panel on demand', async ({ page }) => {
  await openOptionsPage(page, { servers: [SKILLED_SERVER] });

  await expect(page.locator('.a2a-skill-summary')).toHaveText('Skills: 1 of 2 enabled');
  await expect(page.locator('.a2a-skill-panel')).toHaveCount(0);

  const toggle = page.locator('[data-action="toggle-skills-panel"][data-server-id="server-skills"]');
  await expect(toggle).toHaveText('Show');
  await toggle.click();

  await expect(page.locator('.a2a-skill-panel')).toHaveCount(1);
  await expect(page.locator('.a2a-skill-row')).toHaveCount(2);
  await expect(toggle).toHaveText('Hide');

  const alpha = page.locator('[data-skill-toggle][data-server-id="server-skills"][data-skill-id="alpha"]');
  const beta = page.locator('[data-skill-toggle][data-server-id="server-skills"][data-skill-id="beta"]');
  await expect(alpha).toBeChecked();
  await expect(beta).not.toBeChecked();

  await toggle.click();
  await expect(page.locator('.a2a-skill-panel')).toHaveCount(0);
});

test('renders skill names, ids, and descriptions in the expanded panel', async ({ page }) => {
  await openOptionsPage(page, { servers: [SKILLED_SERVER] });
  await page.locator('[data-action="toggle-skills-panel"][data-server-id="server-skills"]').click();

  const alphaRow = page.locator('.a2a-skill-row').first();
  await expect(alphaRow.locator('.a2a-skill-name')).toHaveText('Alpha Skill');
  await expect(alphaRow.locator('.a2a-skill-id')).toHaveText('alpha');
  await expect(alphaRow.locator('.a2a-skill-desc')).toHaveText('Does alpha things');
});

test('toggling a skill checkbox persists the disabled skill list', async ({ page }) => {
  await openOptionsPage(page, { servers: [SKILLED_SERVER] });
  await page.locator('[data-action="toggle-skills-panel"][data-server-id="server-skills"]').click();

  await page.locator('[data-skill-toggle][data-skill-id="alpha"]').uncheck();

  await expect.poll(async () => (await persistedServers(page))?.[0]?.disabledSkillIds?.slice().sort())
    .toEqual(['alpha', 'beta']);
  await expect(page.locator('.a2a-skill-summary')).toHaveText('Skills: 0 of 2 enabled');
  await expect(page.locator('.a2a-skill-hint')).toHaveCount(1);
});

test('enable-all and disable-all update every skill', async ({ page }) => {
  await openOptionsPage(page, { servers: [SKILLED_SERVER] });
  await page.locator('[data-action="toggle-skills-panel"][data-server-id="server-skills"]').click();

  await page.locator('[data-action="enable-all-skills"][data-server-id="server-skills"]').click();
  await expect(page.locator('.a2a-skill-summary')).toHaveText('Skills: 2 of 2 enabled');
  expect((await persistedServers(page))[0].disabledSkillIds).toEqual([]);

  await page.locator('[data-action="disable-all-skills"][data-server-id="server-skills"]').click();
  await expect(page.locator('.a2a-skill-summary')).toHaveText('Skills: 0 of 2 enabled');
  expect((await persistedServers(page))[0].disabledSkillIds.slice().sort()).toEqual(['alpha', 'beta']);
});

test('reports when an agent card has no discovered skills', async ({ page }) => {
  await openOptionsPage(page, {
    servers: [{
      id: 'bare',
      name: 'Bare Agent',
      endpoint: 'https://bare.example.com',
      enabled: true,
      agentCard: { name: 'Bare Agent', skills: [] }
    }]
  });

  await expect(page.locator('.a2a-skill-summary')).toHaveText('No skills discovered');
  await expect(page.locator('[data-action="toggle-skills-panel"]')).toHaveCount(0);
});

test('renders no skill controls for an agent that was never discovered', async ({ page }) => {
  await openOptionsPage(page, { servers: [SIMPLE_SERVER] });

  await expect(page.locator('.a2a-skill-controls')).toHaveCount(0);
});

test('opens an inline edit form prefilled with the agent details', async ({ page }) => {
  await openOptionsPage(page, {
    servers: [SIMPLE_SERVER],
    tokens: { 'server-1': 'stored-token' }
  });

  await page.locator('[data-action="edit"][data-server-id="server-1"]').click();

  const form = page.locator('.a2a-edit-form[data-server-id="server-1"]');
  await expect(form).toHaveCount(1);
  await expect(page.locator('.a2a-server-item[data-server-id="server-1"]')).toHaveCount(0);
  await expect(form.locator('.a2a-edit-name')).toHaveValue('Stored Server');
  await expect(form.locator('.a2a-edit-endpoint')).toHaveValue('https://stored.example.com');
  await expect(form.locator('.a2a-edit-token')).toHaveValue('stored-token');
  await expect(form.locator('[data-action="save-edit"][data-server-id="server-1"]')).toHaveCount(1);
  await expect(form.locator('[data-action="cancel-edit"][data-server-id="server-1"]')).toHaveCount(1);
});

test('cancelling an edit restores the agent row without persisting', async ({ page }) => {
  await openOptionsPage(page, { servers: [SIMPLE_SERVER] });

  await page.locator('[data-action="edit"][data-server-id="server-1"]').click();
  await page.locator('.a2a-edit-form .a2a-edit-name').fill('Renamed But Discarded');
  await page.locator('[data-action="cancel-edit"][data-server-id="server-1"]').click();

  await expect(page.locator('.a2a-edit-form')).toHaveCount(0);
  await expect(page.locator('.a2a-server-item[data-server-id="server-1"] .a2a-server-name'))
    .toContainText('Stored Server');
});

test('saving an edit persists the new name and endpoint and closes the form', async ({ page }) => {
  await openOptionsPage(page, { servers: [SIMPLE_SERVER] });

  await page.locator('[data-action="edit"][data-server-id="server-1"]').click();
  await page.locator('.a2a-edit-form .a2a-edit-name').fill('Renamed Server');
  await page.locator('.a2a-edit-form .a2a-edit-endpoint').fill('https://renamed.example.com');
  await page.locator('[data-action="save-edit"][data-server-id="server-1"]').click();

  await expect(page.locator('.a2a-edit-form')).toHaveCount(0);
  const item = page.locator('.a2a-server-item[data-server-id="server-1"]');
  await expect(item.locator('.a2a-server-name')).toContainText('Renamed Server');
  await expect(item.locator('.a2a-server-endpoint')).toHaveText('https://renamed.example.com');

  const saved = (await persistedServers(page))[0];
  expect(saved.name).toBe('Renamed Server');
  expect(saved.endpoint).toBe('https://renamed.example.com');
});

test('rejects an edit that clears the required name', async ({ page }) => {
  await openOptionsPage(page, { servers: [SIMPLE_SERVER] });

  await page.locator('[data-action="edit"][data-server-id="server-1"]').click();
  await page.locator('.a2a-edit-form .a2a-edit-name').fill('   ');
  await page.locator('[data-action="save-edit"][data-server-id="server-1"]').click();

  await expect(page.locator('#a2aStatus')).toHaveClass(/error/);
  await expect(page.locator('.a2a-edit-form')).toHaveCount(1);
});

test('renders every configured agent', async ({ page }) => {
  await openOptionsPage(page, {
    servers: [
      { id: 'a', name: 'AgentA', endpoint: 'https://a.example', enabled: true },
      { id: 'b', name: 'AgentB', endpoint: 'https://b.example', enabled: false },
      SKILLED_SERVER
    ]
  });

  await expect(page.locator('.a2a-server-item')).toHaveCount(3);
});

test('renders an empty list when no agents are configured', async ({ page }) => {
  await openOptionsPage(page, { servers: [] });

  await expect(page.locator('#a2aServerList')).toHaveCount(1);
  await expect(page.locator('.a2a-server-item')).toHaveCount(0);
});

test('discovering an agent stores the returned agent card', async ({ page }) => {
  await openOptionsPage(page, { servers: [SIMPLE_SERVER] });

  await page.locator('[data-action="discover"][data-server-id="server-1"]').click();

  await expect.poll(async () => (await persistedServers(page))?.[0]?.agentCard?.name)
    .toBe('Discovered Agent');
});
