// Visual-parity guard for the popup's migration to utility classes.
//
// The popup markup moved from bespoke CSS classes to `op:` utilities. These
// assertions pin the computed values that the original hand-written CSS
// produced, so a utility mapping mistake — or a cascade-layer regression that
// lets the `*` reset cancel utility spacing — fails loudly.
const { test, expect } = require('@playwright/test');
const path = require('path');

const POPUP_URL = 'file:///' + path.resolve(__dirname, '..', 'dist', 'popup.html').replace(/\\/g, '/');

// [selector, CSS property, expected computed value, what it came from]
const COMPUTED = [
  ['#desc', 'fontSize', '12px', '--appearance-font-size-sm'],
  ['#desc', 'marginBottom', '12px', 'op:mb-3'],
  ['#desc', 'lineHeight', '18.6px', '--appearance-line-height-body x 12px'],
  ['#statusDot', 'width', '6px', 'op:w-1.5'],
  ['#statusDot', 'height', '6px', 'op:h-1.5'],
  ['#statusDot', 'flexShrink', '0', 'op:shrink-0'],
  ['#statusDot', 'borderRadius', '0px', 'square-corner policy'],
  ['.header-left', 'display', 'flex', 'op:flex'],
  ['.header-left', 'columnGap', '8px', 'op:gap-2'],
  ['.header-left', 'textDecorationLine', 'none', 'op:no-underline'],
  ['.title', 'fontSize', '14px', '--appearance-font-size-md'],
  ['.title', 'fontWeight', '600', '--appearance-weight-strong'],
  ['.title', 'letterSpacing', '-0.14px', '--appearance-heading-tracking'],
  ['.theme-row', 'display', 'flex', 'op:flex'],
  ['.theme-row', 'paddingTop', '10px', 'op:py-2.5'],
  ['.theme-row', 'paddingLeft', '12px', 'op:px-3'],
  ['.theme-row', 'marginBottom', '12px', '--appearance-row-gap'],
  ['.theme-row', 'columnGap', '12px', 'op:gap-3'],
  ['.theme-row', 'borderRadius', '0px', 'square-corner policy'],
  ['.theme-copy', 'rowGap', '2px', 'op:gap-0.5'],
  ['#appearanceLabel', 'fontSize', '12px', 'op:text-sm'],
  ['#appearanceLabel', 'fontWeight', '600', 'op:font-strong'],
  ['#settingsBtn', 'display', 'flex', 'op:flex'],
  ['#settingsBtn', 'paddingTop', '8px', 'op:p-2'],
  ['#settingsBtn', 'width', '228px', 'op:w-full inside the 260px body'],
  ['#settingsBtn', 'fontSize', '12px', 'op:text-sm'],
  ['#settingsBtn', 'fontWeight', '500', 'op:font-medium'],
  ['#settingsBtn', 'cursor', 'pointer', 'op:cursor-pointer'],
  ['#settingsBtn', 'borderRadius', '0px', 'square-corner policy'],
];

// [selector, CSS property, appearance token the value must resolve to]
const TOKEN_COLORS = [
  ['#desc', 'color', '--appearance-text-muted'],
  ['.title', 'color', '--appearance-text'],
  ['#appearanceLabel', 'color', '--appearance-text'],
  ['.theme-row', 'backgroundColor', '--appearance-surface'],
  ['#settingsBtn', 'backgroundColor', '--appearance-surface'],
];

test.describe('popup visual parity after the utility-class migration', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(POPUP_URL);
  });

  for (const [selector, property, expected, source] of COMPUTED) {
    test(`${selector} ${property} is ${expected} (${source})`, async ({ page }) => {
      const actual = await page.evaluate(
        ([sel, prop]) => getComputedStyle(document.querySelector(sel))[prop],
        [selector, property]
      );
      expect(actual).toBe(expected);
    });
  }

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
      dot.classList.remove('ok');
      return { off: before, on: after };
    });
    expect(off).not.toBe(on);
  });

  test('utilities override the reset rather than being cancelled by it', async ({ page }) => {
    // Regression guard: unlayered CSS beats layered CSS regardless of
    // specificity. If a page's `*` reset ever leaves @layer base, every
    // utility margin and padding silently collapses to 0.
    const spacing = await page.evaluate(() => ({
      descMargin: getComputedStyle(document.querySelector('#desc')).marginBottom,
      rowPadding: getComputedStyle(document.querySelector('.theme-row')).paddingTop,
    }));
    expect(spacing.descMargin).toBe('12px');
    expect(spacing.rowPadding).toBe('10px');
  });
});
