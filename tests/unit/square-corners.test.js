const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..', '..');
const read = relativePath => fs.readFileSync(path.join(root, relativePath), 'utf8');
const appearance = read('src/styles/appearance.css');

for (const shape of ['subtle', 'rounded', 'pill']) {
  assert.match(appearance, new RegExp(`data-ui-shape=["']${shape}["']`), `missing UI shape: ${shape}`);
}
for (const token of ['xs', 'sm', 'md', 'pill']) {
  assert.match(appearance, new RegExp(`--appearance-radius-${token}:`), `missing radius token: ${token}`);
}

for (const file of [
  'src/styles/popup.css',
  'src/styles/options.css',
  'src/styles/sidepanel.css',
  'src/content-script/styles.css'
]) {
  const css = read(file);
  assert.ok(!/border-radius\s*:\s*0(?:px)?\s*;/.test(css), `${file} must use selectable radius tokens`);
  assert.match(css, /border-radius\s*:\s*var\(--appearance-radius-/, `${file} must consume appearance radius tokens`);
}

console.log('selectable corner policy tests passed');
