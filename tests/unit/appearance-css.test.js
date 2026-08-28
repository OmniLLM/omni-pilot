const assert = require('node:assert');
const fs = require('node:fs');

const appearance = fs.readFileSync('src/styles/appearance.css', 'utf8');
const styles = ['current', 'clean-minimal', 'terminal', 'warm-editorial', 'neo-brutalist'];
const themes = ['light', 'dark'];
const requiredTokens = [
  'canvas', 'surface', 'surface-raised', 'text', 'text-muted', 'text-subtle',
  'border', 'border-strong', 'accent', 'accent-hover', 'on-accent', 'focus',
  'success', 'danger', 'warning', 'font-body', 'card-padding', 'border-width',
  'shadow-1', 'transition-duration'
];

for (const style of styles) {
  assert.match(appearance, new RegExp(`data-visual-style=["']${style}["']`), `missing style: ${style}`);
  for (const theme of themes) {
    if (style === 'current' && theme === 'dark') continue;
    const styleIndex = appearance.indexOf(`data-visual-style="${style}"][data-theme="${theme}"]`);
    assert.notStrictEqual(styleIndex, -1, `missing ${style} ${theme} palette`);
  }
}

for (const token of requiredTokens) {
  assert.match(appearance, new RegExp(`--appearance-${token}:`), `missing appearance token: ${token}`);
}

assert.match(appearance, /@media \(prefers-reduced-motion: reduce\)/);
assert.match(appearance, /@media \(forced-colors: active\)/);

const contentSource = fs.readFileSync('src/content-script/styles.css', 'utf8');
assert.match(contentSource, /#omnipilot-extension-root-7f3a9c/);
assert.doesNotMatch(contentSource, /\[data-omnipilot-owned=/);

console.log('appearance CSS contract tests passed');
