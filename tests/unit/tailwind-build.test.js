// Enforces the guarantees of the `extension-page-styling` capability.
//
// The utility CSS framework runs at build time and is linked ONLY from the
// popup, options, and sidepanel pages. The content script is injected into
// arbitrary third-party pages with no Shadow DOM, so a leaked global reset or
// an unprefixed utility class there would visually corrupt the open web.
// These assertions are the mechanical guard for that boundary.

const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..', '..');
const read = relativePath => fs.readFileSync(path.join(root, relativePath), 'utf8');

const tailwindCss = read('dist/tailwind.css');
const packageJson = JSON.parse(read('package.json'));
const viteConfig = read('vite.config.mjs');
assert.ok(packageJson.devDependencies?.vite, 'Vite must be installed for the Tailwind build');
assert.ok(packageJson.devDependencies?.['@tailwindcss/vite'], '@tailwindcss/vite must be installed');
assert.ok(!packageJson.devDependencies?.['@tailwindcss/cli'], 'the legacy Tailwind CLI integration must not remain');
assert.match(viteConfig, /import\s+tailwindcss\s+from\s+['"]@tailwindcss\/vite['"]/, 'Vite config must import the official Tailwind plugin');
assert.match(viteConfig, /plugins\s*:\s*\[\s*tailwindcss\(\)\s*\]/, 'Vite config must enable the Tailwind plugin');
// The content script's CSS is inlined into its bundle and injected into a
// shadow root, so read it back out of the bundle rather than from a file.
const contentBundle = read('dist/content.js');
const contentCssMatch = contentBundle.match(/^const OMNIPILOT_CONTENT_CSS = (".*");$/m);
assert.ok(contentCssMatch, 'dist/content.js must inline the content stylesheet as OMNIPILOT_CONTENT_CSS');
const contentCss = JSON.parse(contentCssMatch[1]);

// Comments carry URLs like `tailwindcss.com` that would otherwise look like
// class selectors to the scanner below.
const tailwindRules = tailwindCss.replace(/\/\*[\s\S]*?\*\//g, '');

// ── Output exists and is non-empty ────────────────────────────────────────
assert.ok(tailwindCss.length > 0, 'dist/tailwind.css must not be empty');
assert.match(tailwindCss, /@layer utilities\{/, 'dist/tailwind.css must contain a utilities layer');

// ── Cascade layer order ───────────────────────────────────────────────────
// Unlayered CSS beats layered CSS whatever the specificity, so the pages' `*`
// resets must sit in a layer BELOW utilities or they cancel every utility
// margin and padding. Everything else on a page stays unlayered and wins.
//
// The minifier may split `@layer base, theme, utilities;` into a bare
// `@layer base;` followed by the `@layer theme{...}` / `@layer utilities{...}`
// blocks. Either form is fine — what matters is first-appearance order.
const layerAt = name => {
  const match = tailwindRules.match(new RegExp(`@layer[^;{]*\\b${name}\\b`));
  return match ? match.index : -1;
};
const [baseAt, themeAt, utilitiesAt] = ['base', 'theme', 'utilities'].map(layerAt);
assert.ok(baseAt >= 0, 'dist/tailwind.css must declare a `base` layer for the page resets');
assert.ok(themeAt >= 0, 'dist/tailwind.css must declare a `theme` layer');
assert.ok(utilitiesAt >= 0, 'dist/tailwind.css must declare a `utilities` layer');
assert.ok(
  baseAt < themeAt && themeAt < utilitiesAt,
  'layer order must be base < theme < utilities, so utilities can override the page resets'
);

// ── Every utility selector is namespaced ──────────────────────────────────
// Tailwind v4 compiles the `op` prefix to the escaped selector `.op\:flex`.
const classSelectors = [...tailwindRules.matchAll(/\.(-?[_a-zA-Z][\w\\:.\-]*)/g)]
  .map(match => match[1])
  .filter(name => !name.startsWith('op\\:'));
assert.deepStrictEqual(
  [...new Set(classSelectors)],
  [],
  'every class selector in dist/tailwind.css must be prefixed with `op:`'
);

for (const unprefixed of ['.flex{', '.hidden{', '.block{', '.grid{', '.relative{']) {
  assert.ok(
    !tailwindCss.includes(unprefixed),
    `dist/tailwind.css must not emit the unprefixed selector ${unprefixed}`
  );
}

// ── Every framework-declared theme variable is namespaced ─────────────────
// `--tw-*` are Tailwind's internal composition variables and are expected;
// everything the theme declares must carry the `--op-` prefix. References to
// the shared `--appearance-*` contract are the intended bridge.
const declaredVars = [...tailwindCss.matchAll(/(--[\w-]+)\s*:/g)].map(match => match[1]);
const foreignVars = declaredVars.filter(name =>
  !name.startsWith('--op-') && !name.startsWith('--tw-') && !name.startsWith('--appearance-')
);
assert.deepStrictEqual(
  [...new Set(foreignVars)],
  [],
  'theme variables emitted by the framework must be prefixed with `--op-`'
);

// ── No Preflight / global reset ───────────────────────────────────────────
assert.ok(
  !/(^|[{}])\s*html\s*[,{]/.test(tailwindRules),
  'dist/tailwind.css must not contain a bare `html` selector (Preflight leaked in)'
);
assert.ok(
  !/(^|[{}])\s*body\s*[,{]/.test(tailwindRules),
  'dist/tailwind.css must not contain a bare `body` selector (Preflight leaked in)'
);

// Tailwind v4 emits one universal-selector rule inside an `@supports` guard to
// polyfill `@property` fallbacks. That is permitted because it assigns only
// `--tw-*` custom properties. Any universal rule touching the box model or
// inherited typography would be a reset, and is not.
const universalRules = [...tailwindCss.matchAll(/\*\s*,[^{}]*\{([^{}]*)\}/g)].map(match => match[1]);
for (const body of universalRules) {
  for (const declaration of body.split(';').map(part => part.trim()).filter(Boolean)) {
    const property = declaration.split(':')[0].trim();
    assert.ok(
      property.startsWith('--tw-'),
      `universal-selector rules must only assign --tw-* variables, found: ${declaration}`
    );
  }
}

// ── Radius utilities are connected to the selectable shape contract ───────
const radiusTokens = new Map(
  [...tailwindCss.matchAll(/(--op-radius-[\w-]+)\s*:\s*([^;}]+)/g)].map(m => [m[1], m[2].trim()])
);
for (const match of tailwindCss.matchAll(/border-radius\s*:\s*([^;}]+)/g)) {
  const value = match[1].trim();
  const reference = value.match(/^var\((--op-radius-[\w-]+)\)$/);
  if (reference) {
    assert.ok(radiusTokens.has(reference[1]), `unknown radius token ${reference[1]}`);
    assert.ok(radiusTokens.get(reference[1]), `${reference[1]} must resolve through the appearance contract`);
  } else {
    assert.match(value, /^0(?:px)?$/, `literal radius values must remain zero: ${value}`);
  }
}

// The authored entry must clear the whole radius namespace, so an unlisted
// scale value can never survive into a future build.
const tailwindEntry = read('src/styles/tailwind.css');
assert.match(tailwindEntry, /--radius-\*\s*:\s*initial\s*;/, 'radius namespace must be cleared with `--radius-*: initial`');
for (const scale of ['xs', 'sm', 'md', 'lg', 'xl', '2xl', '3xl', '4xl', 'full']) {
  assert.match(
    tailwindEntry,
    new RegExp(`--radius-${scale.replace(/[$()*+.?[\\\]^{|}]/g, '\\$&')}\\s*:\\s*var\\(--appearance-radius-`),
    `--radius-${scale} must resolve through the appearance radius contract`
  );
}

// ── The content script must never be styled by utilities ──────────────────
assert.ok(
  !contentCss.includes('op\\:'),
  'the content script stylesheet must not contain utility selectors — it is injected into every third-party page'
);
const appearanceCss = read('src/styles/appearance.css');
const contentAppearanceCss = appearanceCss
  .replace(/\[data-appearance-root\]\[data-surface\], /g, '')
  .replace(/, \[data-appearance-preview\]/g, '')
  .replace(/:where\(#omnipilot-extension-root-7f3a9c\[data-surface="content"\], \[data-appearance-root\]\[data-surface="sidepanel"\]\)/g, '#omnipilot-extension-root-7f3a9c[data-surface="content"]');
assert.strictEqual(
  contentCss,
  `${contentAppearanceCss}\n${read('src/content-script/styles.css')}`,
  'the inlined content stylesheet must remain exactly the transformed appearance CSS plus the hand-written content CSS'
);
// The whole point of the shadow root: nothing is injected into the host page.
const manifest = JSON.parse(read('manifest.json'));
for (const entry of manifest.content_scripts ?? []) {
  assert.ok(
    !entry.css,
    'manifest content_scripts must not inject CSS into host pages — the content script styles its own shadow root'
  );
}
assert.ok(
  !fs.existsSync(path.join(root, 'dist/styles.css')),
  'dist/styles.css must no longer be emitted — the content stylesheet is inlined into dist/content.js'
);
// Match `op:` only as a class token, so CSS text like `top: 0` cannot false-match.
const UTILITY_TOKEN = /(?<![\w-])op:[a-z0-9[]/;
assert.ok(
  !UTILITY_TOKEN.test(read('src/content-script/index.mjs')),
  'the content script must not use utility classes'
);

// The utility entry must not scan the content script.
const sourceGlobs = [...tailwindEntry.matchAll(/@source\s+"([^"]+)"/g)].map(match => match[1]);
assert.ok(sourceGlobs.length > 0, 'src/styles/tailwind.css must declare explicit @source globs');
for (const glob of sourceGlobs) {
  assert.ok(
    !glob.includes('content-script'),
    `@source must never include the content script, found: ${glob}`
  );
}
assert.match(
  tailwindEntry,
  /source\(none\)/,
  'automatic source detection must be disabled so only explicit @source globs are scanned'
);
assert.match(
  tailwindEntry,
  /@layer\s+base\s*,\s*theme\s*,\s*utilities\s*;/,
  'src/styles/tailwind.css must declare the cascade order `base, theme, utilities`'
);
assert.ok(
  !/@import\s+"tailwindcss\/preflight/.test(tailwindEntry),
  'Preflight must never be imported'
);

// ── Extension pages link the stylesheet in the right order ────────────────
for (const page of ['src/popup/index.html', 'src/options/index.html', 'src/sidepanel/index.html']) {
  const html = read(page);
  const appearanceAt = html.indexOf('href="appearance.css"');
  const tailwindAt = html.indexOf('href="tailwind.css"');
  const pageName = path.basename(path.dirname(page));
  const componentAt = html.indexOf(`href="${pageName}.css"`);
  const componentCss = read(`src/styles/${pageName}.css`);
  assert.ok(appearanceAt >= 0, `${page} must link appearance.css`);
  assert.ok(tailwindAt >= 0, `${page} must link tailwind.css`);
  assert.ok(componentAt >= 0, `${page} must link its Vite-managed component stylesheet`);
  assert.ok(!html.includes('<style>'), `${page} must not contain inline component CSS`);
  assert.ok(!/\sstyle="/.test(html), `${page} must not contain inline style attributes`);
  // Each page keeps its own reset because Preflight is deliberately not shipped.
  // popup/options use the `*, *::before, *::after` form; sidepanel uses bare `*`.
  assert.match(
    componentCss,
    /\*(?:\s*,\s*\*::before\s*,\s*\*::after)?\s*\{\s*box-sizing:\s*border-box;\s*margin:\s*0;\s*padding:\s*0;\s*\}/,
    `${page} must keep its own reset, since Preflight is not shipped`
  );
  assert.ok(appearanceAt < tailwindAt, `${page}: tailwind.css must be linked after appearance.css`);
  assert.ok(
    tailwindAt < componentAt,
    `${page}: component CSS must load after Tailwind utilities`
  );
  // Cascade layers: unlayered CSS beats layered CSS regardless of specificity.
  // Each page must layer ONLY its reset, so utilities can override it while
  // the rest of the page's hand-written CSS still wins over utilities.
  assert.match(
    componentCss,
    /@layer\s+base\s*\{/,
    `${page} must wrap its reset in @layer base, or the reset will cancel every utility margin and padding`
  );
  const layerBlocks = [...componentCss.matchAll(/@layer\s+([\w\s,]+?)\s*\{/g)].map(match => match[1].trim());
  assert.deepStrictEqual(
    layerBlocks,
    ['base'],
    `${page} must place only its reset in a layer; everything else stays unlayered so it keeps precedence`
  );
  // MV3 forbids loading remote subresources. Anchor hrefs to the web are fine;
  // only <link> stylesheets and <script> sources matter here.
  assert.ok(
    !/<link\b[^>]*href="https?:\/\//i.test(html),
    `${page} must not load a remote stylesheet (MV3 CSP)`
  );
  assert.ok(
    !/<script\b[^>]*src="https?:\/\//i.test(html),
    `${page} must not load a remote script (MV3 CSP)`
  );
}

// ── The popup migration preserved every scripted hook ─────────────────────
//
// The popup's markup now lives in its entry module rather than in the page,
// so these assertions follow it there. The guarantees are unchanged: the
// scripted hooks, the utility classes, and the .dot state pair must all
// survive.
const popupHtml = read('src/popup/index.html');
const popupJs = read('src/popup/index.mjs');

// The page keeps only the mount root, and every element the script looks up
// must still resolve — otherwise the component never mounts.
for (const id of [...popupJs.matchAll(/getElementById\('([^']+)'\)/g)].map(match => match[1])) {
  assert.ok(popupHtml.includes(`id="${id}"`), `popup markup must keep the #${id} element`);
}

// Identifiers targeted by CSS, ARIA, and the browser tests, wherever rendered.
for (const id of [
  'desc', 'statusDot', 'statusText', 'appearanceLabel', 'themePreferenceSelect',
  'visualStylePreferenceSelect', 'languageLabel', 'languageSelect', 'settingsBtn', 'settingsLabel'
]) {
  assert.ok(
    popupJs.includes(`id="${id}"`) || popupHtml.includes(`id="${id}"`),
    `the popup must still render the #${id} element`
  );
}

assert.ok(popupJs.includes('class="dot'), 'the status dot must keep its .dot class');
assert.match(popupJs, /class="dot ok/, 'the status dot must still express its ready state as .ok');
assert.match(read('src/styles/popup.css'), /\.dot\.ok\s*\{/, 'the .dot.ok state rule must remain, it is toggled from JS');
assert.ok(UTILITY_TOKEN.test(popupJs), 'the popup must actually use utility classes');

// Tailwind tokenizes candidates on whitespace, so a utility written directly
// against a template interpolation is swallowed and silently never emitted.
// This is invisible at build time and only shows up as missing styling.
for (const file of ['src/popup/index.mjs', 'src/sidepanel/index.mjs']) {
  const source = read(file);
  const fused = [...source.matchAll(/(?<![\w-])op:[a-z0-9.[\]-]*\$\{/g)].map(match => match[0]);
  assert.deepStrictEqual(
    fused,
    [],
    `${file}: utility classes must not be written directly against \${...} — Tailwind will not emit them`
  );
}

console.log('Tailwind build tests passed');
