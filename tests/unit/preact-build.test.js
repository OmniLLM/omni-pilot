// Guards the vendored component runtime.
//
// The whole Preact adoption rests on one property: inlining a UMD bundle must
// not hide the declarations that follow it, because every unit test in this
// repo reads top-level declarations off a `vm.runInContext` context object.
// These assertions fail loudly if that ever stops being true.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..', '..');
const read = rel => fs.readFileSync(path.join(root, rel), 'utf8');

const RUNTIME_GLOBAL = 'htmPreact';
const WITH_RUNTIME = ['dist/popup.js', 'dist/sidepanel.js'];
const WITHOUT_RUNTIME = ['dist/background.js', 'dist/content.js', 'dist/options.js'];

// ── The runtime reaches exactly the surfaces that asked for it ────────────

for (const file of WITH_RUNTIME) {
  const source = read(file);
  assert.ok(
    source.includes(RUNTIME_GLOBAL),
    `${file} must contain the vendored component runtime`
  );
  assert.ok(
    source.includes('vendored: htm/preact standalone'),
    `${file} must carry the vendoring marker comment`
  );
}

for (const file of WITHOUT_RUNTIME) {
  const source = read(file);
  assert.ok(
    !source.includes(RUNTIME_GLOBAL),
    `${file} must NOT contain the component runtime — it renders no extension-page UI`
  );
}

// The content script is injected into arbitrary websites with no DOM or style
// isolation. Keeping a framework runtime out of it is a hard requirement.
assert.ok(
  !read('dist/content.js').includes('vendored: htm/preact'),
  'the content script must never carry the component runtime'
);

// ── Inlining is opt-in per entry, not global ─────────────────────────────

const buildSource = read('build.mjs');
const flagged = [...buildSource.matchAll(/name:\s*'([a-z]+)'[^}]*needsPreact:\s*(true|false)/g)]
  .filter(match => match[2] === 'true')
  .map(match => match[1]);
assert.deepStrictEqual(
  flagged.sort(),
  ['popup', 'sidepanel'],
  'only the popup and sidepanel entries may opt into the component runtime'
);

// ── MV3 CSP: nothing may compile code at runtime ─────────────────────────

for (const file of WITH_RUNTIME) {
  const source = read(file);
  assert.ok(!/\beval\s*\(/.test(source), `${file} must not call eval()`);
  assert.ok(!/\bnew\s+Function\s*\(/.test(source), `${file} must not call new Function()`);
}

// The runtime must be a local build-time artifact, never fetched at runtime.
for (const file of ['dist/popup.html', 'dist/sidepanel.html']) {
  const html = read(file);
  assert.ok(
    !/<script[^>]+type=["']module["']/.test(html),
    `${file} must keep classic <script> tags so declarations stay top-level`
  );
  for (const src of [...html.matchAll(/<script[^>]+src=["']([^"']+)["']/g)].map(m => m[1])) {
    assert.ok(
      !/^https?:|^\/\//.test(src),
      `${file} must not load remote scripts (found ${src})`
    );
  }
}

// ── The runtime does not hide what follows it ────────────────────────────
//
// This is the assertion that protects every other unit test in the repo.

for (const file of WITH_RUNTIME) {
  // A probe declared after the entry source stands in for the entry's own
  // top-level declarations. Function declarations hoist, so it resolves even
  // if the entry itself throws for want of a real DOM.
  const source = `${read(file)}\nfunction __probeAfterRuntime() { return 'visible'; }`;

  // Deliberately no `module` or `exports` on the context: their presence would
  // divert the UMD away from the global branch it relies on here.
  const context = {
    console,
    setTimeout,
    clearTimeout,
    globalThis: undefined
  };
  vm.createContext(context);

  try {
    vm.runInContext(source, context);
  } catch {
    // Expected: the entry needs a browser DOM. Declaration visibility is what
    // is under test, and hoisting guarantees it regardless.
  }

  assert.strictEqual(
    typeof context.__probeAfterRuntime,
    'function',
    `${file}: a top-level declaration after the runtime must stay visible on the context`
  );
  assert.strictEqual(
    context.__probeAfterRuntime(),
    'visible',
    `${file}: the post-runtime declaration must be callable`
  );

  const runtime = context[RUNTIME_GLOBAL];
  assert.ok(runtime, `${file}: the runtime must publish its global on the context`);
  for (const api of ['h', 'html', 'render', 'Component', 'useState', 'useEffect', 'useRef']) {
    assert.strictEqual(
      typeof runtime[api],
      'function',
      `${file}: the runtime must expose ${api}()`
    );
  }

  // Modules inlined after the runtime must also survive.
  assert.strictEqual(
    typeof context.createAppearanceController,
    'function',
    `${file}: shared modules inlined after the runtime must stay visible`
  );
}

// ── No bundler crept in ──────────────────────────────────────────────────

assert.ok(
  !/needsPreact/.test(read('dist/background.js')),
  'build flags must not leak into output'
);
assert.ok(
  buildSource.includes('stripExports') && buildSource.includes('stripUtilityImports'),
  'the concatenation helpers must still drive the build'
);

// The vendored runtime is not an ES module and must bypass the ESM helpers.
assert.ok(
  /readPreactRuntime[\s\S]{0,600}readFileSync/.test(buildSource),
  'the runtime must be read verbatim, without export stripping'
);

// ── It ships inside the existing bundles, adding no packaged file ────────

const packSource = read('pack.mjs');
assert.ok(
  !/preact|htm/i.test(packSource),
  'pack.mjs must not need a separate runtime entry — the runtime is inlined'
);

const pkg = JSON.parse(read('package.json'));
assert.ok(
  !pkg.dependencies || Object.keys(pkg.dependencies).length === 0,
  'the component runtime must not become a runtime dependency'
);
for (const name of ['preact', 'htm']) {
  assert.ok(
    pkg.devDependencies[name],
    `${name} must be declared as a devDependency`
  );
}

console.log('Preact runtime build tests passed');
