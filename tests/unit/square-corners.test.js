const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..', '..');
const uiSources = [
  'src/content-script/styles.css',
  'src/popup/index.html',
  'src/sidepanel/index.html',
  'src/options/index.html'
];

for (const relativePath of uiSources) {
  const source = fs.readFileSync(path.join(root, relativePath), 'utf8');
  const declarations = [...source.matchAll(/border-radius\s*:\s*([^;]+);/g)];
  assert.ok(declarations.length > 0, `${relativePath} should contain authored border-radius declarations`);
  for (const declaration of declarations) {
    assert.match(declaration[1].trim(), /^0(?:px)?$/, `${relativePath} contains a nonzero border radius: ${declaration[0]}`);
  }
}

const contentStyles = fs.readFileSync(path.join(root, 'src/content-script/styles.css'), 'utf8');
for (const token of ['xs', 'sm', 'md', 'pill']) {
  assert.match(contentStyles, new RegExp(`--op-radius-${token}:\\s*0;`), `--op-radius-${token} should remain zero`);
}

console.log('square corner policy tests passed');
