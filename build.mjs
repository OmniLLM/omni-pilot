// OmniPilot build script.
//
// Manual concat instead of a real bundler: our unit tests exercise the built
// scripts through `vm.runInContext`, which exposes top-level declarations as
// context properties. Wrapping the output in an IIFE (as esbuild/rollup do
// by default) would hide those declarations and break the tests.
//
// Four concat sources feed into the built scripts:
//   * `src/utils/timeout.mjs` is inlined into every JavaScript bundle.
//   * `src/utils/i18n.mjs` is inlined into content/popup/options bundles.
//   * `src/utils/appearance.mjs` is inlined into every UI bundle.
//   * `src/background/agent/*.mjs` (Agent, Runner, Tool, ToolRegistry,
//     Session, State, A2aToolProvider, follow-up, constants) is inlined
//     into the background bundle before its entry file.
// In both cases, `export ...` lines are stripped so declarations land at
// top level in the concatenated script.
//
// Styles are emitted two ways:
//   * `dist/styles.css` — hand-written CSS for the content script, which is
//     injected into every page with no Shadow DOM. Never framework-generated.
//   * `dist/tailwind.css` — build-time Tailwind utilities for the popup,
//     options, and sidepanel pages only. See `src/styles/tailwind.css`.
//
// Run with: npm run build
import fs from 'fs'
import path from 'path'
import { spawnSync } from 'child_process'

const outdir = 'dist'

fs.rmSync(outdir, { recursive: true, force: true })
fs.mkdirSync(outdir, { recursive: true })

function inlineModule(file) {
  return stripExports(fs.readFileSync(file, 'utf8')).trimEnd() + '\n'
}

const i18nInlined = inlineModule('src/utils/i18n.mjs')
const appearanceInlined = inlineModule('src/utils/appearance.mjs')
const timeoutInlined = inlineModule('src/utils/timeout.mjs')

function stripUtilityImports(src) {
  return src.replace(/^import\s+\{[^}]+\}\s+from\s+['"][^'"]*(?:i18n|appearance)\.mjs['"];?\s*\n/gm, '')
}

// Strip `export { ... };` / `export default ...;` blocks so declarations
// land at top level when concatenated into a single script.
function stripExports(src) {
  return src
    .replace(/^export\s*\{[\s\S]*?\};?\s*$/gm, '')
    .replace(/^export\s+default\s+/gm, '')
    .replace(/^export\s+(async\s+)?function\s+/gm, '$1function ')
    .replace(/^export\s+const\s+/gm, 'const ')
}

// Concatenate all `.mjs` files in `src/background/agent/`, sorted for
// determinism, so they land in the bundle BEFORE the entry file. Each
// file's declarations become top-level in the resulting script.
function concatAgentPrimitives() {
  const dir = 'src/background/agent'
  if (!fs.existsSync(dir)) return ''
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.mjs')).sort()
  return files.map(f => {
    const raw = fs.readFileSync(path.join(dir, f), 'utf8')
    return `// ── agent/${f} ─────────────────────────────────────────────\n${stripExports(raw)}`
  }).join('\n\n') + '\n'
}

// Concatenate top-level provider helper files (currently just Copilot's
// model→shape mapping) into the background bundle BEFORE the entry file.
// The mapping is a plain data file — declarations must land top-level so
// index.mjs can call them without an import.
function concatBackgroundProviders() {
  const files = ['src/background/copilot-model-shapes.mjs']
  const parts = []
  for (const file of files) {
    if (!fs.existsSync(file)) continue
    const raw = fs.readFileSync(file, 'utf8')
    parts.push(`// ── ${path.basename(file)} ─────────────────────────────────────────────\n${stripExports(raw)}`)
  }
  return parts.length ? parts.join('\n\n') + '\n' : ''
}

// Read the prebuilt Preact + htm UMD bundle verbatim. This is NOT an ES module,
// so it must bypass stripExports/stripUtilityImports entirely — it ships as
// plain script that assigns a single `htmPreact` global.
//
// Two properties make this safe for our concat build:
//   1. Its IIFE encloses only its own internals. Code concatenated after it
//      stays top-level, so `vm.runInContext` still sees our declarations.
//   2. It prefers `exports`/`module` when present and falls back to the global.
//      No test context defines either, so the global branch always wins.
//
// The leading `;` defuses an ASI hazard: the file starts with `!function(...)`,
// which would otherwise continue an expression left open by the previous chunk.
function readPreactRuntime() {
  const file = 'node_modules/htm/preact/standalone.umd.js'
  if (!fs.existsSync(file)) {
    throw new Error(`Preact runtime missing at ${file} — run npm install`)
  }
  const raw = fs.readFileSync(file, 'utf8')
  return `// ── vendored: htm/preact standalone (build-time inline) ──────────\n;${raw}\n`
}

const entries = [
  { name: 'background', src: 'src/background/index.mjs', needsI18n: false, needsAppearance: false, needsAgent: true,  needsPreact: false },
  { name: 'content',    src: 'src/content-script/index.mjs', needsI18n: true,  needsAppearance: true,  needsAgent: false, needsPreact: false },
  { name: 'popup',      src: 'src/popup/index.mjs', needsI18n: true,  needsAppearance: true,  needsAgent: false, needsPreact: true  },
  { name: 'options',    src: 'src/options/index.mjs', needsI18n: true,  needsAppearance: true,  needsAgent: false, needsPreact: true  },
  { name: 'sidepanel',  src: 'src/sidepanel/index.mjs', needsI18n: false, needsAppearance: true,  needsAgent: false, needsPreact: true  },
]

const agentPrimitives = concatAgentPrimitives()
const backgroundProviders = concatBackgroundProviders()
const preactRuntime = readPreactRuntime()

for (const { name, src, needsI18n, needsAppearance, needsAgent, needsPreact } of entries) {
  const raw = fs.readFileSync(src, 'utf8')
  const stripped = stripUtilityImports(raw)
  const parts = [timeoutInlined]
  if (needsPreact) parts.push(preactRuntime)
  if (needsI18n) parts.push(i18nInlined)
  if (needsAppearance) parts.push(appearanceInlined)
  if (needsAgent) parts.push(agentPrimitives)
  if (needsAgent) parts.push(backgroundProviders)
  parts.push(stripped)
  const bundled = parts.join('\n')
  fs.writeFileSync(`${outdir}/${name}.js`, bundled)
  const sizeKb = (Buffer.byteLength(bundled) / 1024).toFixed(1)
  console.log(`  dist/${name}.js  ${sizeKb}kb`)
}

fs.copyFileSync('src/popup/index.html',        `${outdir}/popup.html`)
fs.copyFileSync('src/options/index.html',      `${outdir}/options.html`)
fs.copyFileSync('src/sidepanel/index.html',    `${outdir}/sidepanel.html`)
const appearanceCss = fs.readFileSync('src/styles/appearance.css', 'utf8')
fs.writeFileSync(`${outdir}/appearance.css`, appearanceCss)
const contentAppearanceCss = appearanceCss
  .replace(/\[data-appearance-root\]\[data-surface\], /g, '')
  .replace(/, \[data-appearance-preview\]/g, '')
  .replace(/:where\(#omnipilot-extension-root-7f3a9c\[data-surface="content"\], \[data-appearance-root\]\[data-surface="sidepanel"\]\)/g, '#omnipilot-extension-root-7f3a9c[data-surface="content"]')
const contentCss = fs.readFileSync('src/content-script/styles.css', 'utf8')
fs.writeFileSync(`${outdir}/styles.css`, `${contentAppearanceCss}\n${contentCss}`)

buildTailwind()

console.log('✓ built dist/')

// Compile the utility stylesheet for the popup/options/sidepanel pages.
//
// Invoke the resolved local CLI entry rather than `npx`, which can hit the
// registry and make the build network-dependent — unacceptable because
// `npm run test:unit` runs this build every time.
//
// `src/styles/tailwind.css` scopes scanning to the three extension pages and
// never imports Preflight, so nothing here can reach the content script.
function buildTailwind() {
  const cli = path.join('node_modules', '@tailwindcss', 'cli', 'dist', 'index.mjs')
  if (!fs.existsSync(cli)) {
    throw new Error(`Tailwind CLI not found at ${cli}. Run \`npm install\` before building.`)
  }
  const out = `${outdir}/tailwind.css`
  const result = spawnSync(
    process.execPath,
    [cli, '-i', 'src/styles/tailwind.css', '-o', out, '--minify'],
    { encoding: 'utf8' }
  )
  if (result.error) throw result.error
  if (result.status !== 0) {
    throw new Error(`Tailwind build failed (exit ${result.status}):\n${result.stderr || result.stdout}`)
  }
  const sizeKb = (fs.statSync(out).size / 1024).toFixed(1)
  console.log(`  ${out}  ${sizeKb}kb`)
}
