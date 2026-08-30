// Focused layout and styling coverage for the compact popup launcher.
const { test, expect } = require('@playwright/test');
const path = require('path');

const POPUP_URL = 'file:///' + path.resolve(__dirname, '..', 'dist', 'popup.html').replace(/\\/g, '/');

const TOKEN_COLORS = [
  ['#desc', 'color', '--appearance-text-muted'],
  ['.title', 'color', '--appearance-text'],
  ['#appearanceLabel', 'color', '--appearance-text-muted'],
  ['#sidePanelBtn', 'backgroundColor', '--appearance-accent'],
];

test.describe('popup launcher layout', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(POPUP_URL);
  });

  test('the primary action is visually prominent and precedes preferences', async ({ page }) => {
    const order = await page.evaluate(() => {
      const primary = document.querySelector('#sidePanelBtn');
      const preferences = document.querySelector('.preferences');
      const settings = document.querySelector('#settingsBtn');
      return {
        primaryBeforePreferences: Boolean(primary.compareDocumentPosition(preferences) & Node.DOCUMENT_POSITION_FOLLOWING),
        preferencesBeforeSettings: Boolean(preferences.compareDocumentPosition(settings) & Node.DOCUMENT_POSITION_FOLLOWING),
        primaryBackground: getComputedStyle(primary).backgroundColor,
        settingsBackground: getComputedStyle(settings).backgroundColor,
      };
    });

    expect(order.primaryBeforePreferences).toBe(true);
    expect(order.preferencesBeforeSettings).toBe(true);
    expect(order.primaryBackground).not.toBe(order.settingsBackground);
  });

  test('interactive controls meet the 44px minimum target size', async ({ page }) => {
    for (const selector of [
      '#themePreferenceSelect',
      '#uiShapePreferenceSelect',
      '#visualStylePreferenceSelect',
      '#languageSelect',
      '#sidePanelBtn',
      '#settingsBtn',
    ]) {
      const height = await page.locator(selector).evaluate(element => element.getBoundingClientRect().height);
      expect(height, selector).toBeGreaterThanOrEqual(44);
    }
  });

  test('the default follows the selectable radius contract', async ({ page }) => {
    const radii = await page.evaluate(() => ({
      action: getComputedStyle(document.querySelector('#sidePanelBtn')).borderRadius,
      select: getComputedStyle(document.querySelector('#themePreferenceSelect')).borderRadius,
      dot: getComputedStyle(document.querySelector('#statusDot')).borderRadius,
      actionToken: getComputedStyle(document.documentElement).getPropertyValue('--appearance-radius-md').trim(),
      selectToken: getComputedStyle(document.documentElement).getPropertyValue('--appearance-radius-sm').trim(),
      dotToken: getComputedStyle(document.documentElement).getPropertyValue('--appearance-radius-pill').trim(),
    }));

    expect(radii.action).toBe(radii.actionToken);
    expect(radii.select).toBe(radii.selectToken);
    expect(radii.dot).toBe(radii.dotToken);
  });

  test('long content at increased text size does not overflow horizontally', async ({ page }) => {
    await page.addStyleTag({ content: 'html { font-size: 200%; }' });
    await page.evaluate(() => {
      document.querySelector('#sidePanelLabel').textContent = 'Ask a very detailed question about everything on this unusually complex page';
      document.querySelector('#statusText').textContent = 'Configuration requires additional attention';
      document.querySelector('#appearanceLabel').textContent = 'Appearance and reading preferences';
      document.querySelectorAll('.preference-row label').forEach((label, index) => {
        label.textContent = `Extremely descriptive preference label number ${index + 1}`;
      });
    });

    const layout = await page.evaluate(() => ({
      bodyOverflow: document.body.scrollWidth > document.body.clientWidth,
      rootOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
      actionWidth: document.querySelector('#sidePanelBtn').getBoundingClientRect().width,
      popupWidth: document.body.getBoundingClientRect().width,
    }));

    expect(layout.bodyOverflow).toBe(false);
    expect(layout.rootOverflow).toBe(false);
    expect(layout.actionWidth).toBeLessThanOrEqual(layout.popupWidth);
  });

  test('the popup adapts to a 240px viewport at increased text size', async ({ page }) => {
    await page.setViewportSize({ width: 240, height: 900 });
    await page.addStyleTag({ content: 'html { font-size: 200%; }' });

    const layout = await page.evaluate(() => {
      const viewportWidth = document.documentElement.clientWidth;
      const controls = [...document.querySelectorAll('button, select')];
      return {
        overflow: document.documentElement.scrollWidth > viewportWidth,
        controlsFit: controls.every(control => {
          const box = control.getBoundingClientRect();
          return box.left >= 0 && box.right <= viewportWidth;
        }),
      };
    });

    expect(layout.overflow).toBe(false);
    expect(layout.controlsFit).toBe(true);
  });

  for (const [selector, property, token] of TOKEN_COLORS) {
    test(`${selector} ${property} resolves to var(${token})`, async ({ page }) => {
      const [actual, expected] = await page.evaluate(
        ([sel, prop, tok]) => {
          const probe = document.createElement('div');
          probe.style.color = `var(${tok})`;
          document.documentElement.appendChild(probe);
          const want = getComputedStyle(probe).color;
          probe.remove();
          return [getComputedStyle(document.querySelector(sel))[prop], want];
        },
        [selector, property, token]
      );
      expect(actual).toBe(expected);
    });
  }

  test('the .dot / .dot.ok state hook still switches colour', async ({ page }) => {
    const { off, on } = await page.evaluate(() => {
      const dot = document.getElementById('statusDot');
      const before = getComputedStyle(dot).backgroundColor;
      dot.classList.add('ok');
      const after = getComputedStyle(dot).backgroundColor;
      return { off: before, on: after };
    });
    expect(off).not.toBe(on);
  });

  test('Tailwind utilities remain active alongside the layered reset', async ({ page }) => {
    const styles = await page.evaluate(() => ({
      shellDisplay: getComputedStyle(document.querySelector('.popup-shell')).display,
      primaryDisplay: getComputedStyle(document.querySelector('#sidePanelBtn')).display,
      primaryWidth: getComputedStyle(document.querySelector('#sidePanelBtn')).width,
    }));

    expect(styles.shellDisplay).toBe('flex');
    expect(styles.primaryDisplay).toBe('flex');
    expect(parseFloat(styles.primaryWidth)).toBeGreaterThan(0);
  });
});
