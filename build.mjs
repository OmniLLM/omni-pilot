// OmniPilot build script.
//
// Manual concat instead of a real bundler: our unit tests exercise the built
// scripts through `vm.runInContext`, which exposes top-level declarations as
// context properties. Wrapping the output in an IIFE (as esbuild/rollup do
// by default) would hide those declarations and break the tests.
//
// Three concat sources feed into the built scripts:
//   * `src/utils/timeout.mjs` is inlined into every JavaScript bundle.
//   * `src/utils/i18n.mjs` is inlined into content/popup/options bundles.
//   * `src/background/agent/*.mjs` (Agent, Runner, Tool, ToolRegistry,
//     Session, State, A2aToolProvider, follow-up, constants) is inlined
//     into the background bundle before its entry file.
// In both cases, `export ...` lines are stripped so declarations land at
// top level in the concatenated script.
//
// Run with: npm run build
import fs from 'fs'
import path from 'path'

const outdir = 'dist'

fs.rmSync(outdir, { recursive: true, force: true })
fs.mkdirSync(outdir, { recursive: true })

const i18nRaw = fs.readFileSync('src/utils/i18n.mjs', 'utf8')
const i18nInlined = i18nRaw.replace(/^export\s*\{[\s\S]*?\};?\s*$/m, '').trimEnd() + '\n'
const timeoutRaw = fs.readFileSync('src/utils/timeout.mjs', 'utf8')
const timeoutInlined = timeoutRaw.replace(/^export\s*\{[\s\S]*?\};?\s*$/m, '').trimEnd() + '\n'

function stripI18nImports(src) {
  return src.replace(/^import\s+\{[^}]+\}\s+from\s+['"][^'"]*i18n\.mjs['"];?\s*\n/gm, '')
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

const entries = [
  { name: 'background', src: 'src/background/index.mjs', needsI18n: false, needsAgent: true  },
  { name: 'content',    src: 'src/content-script/index.mjs', needsI18n: true,  needsAgent: false },
  { name: 'popup',      src: 'src/popup/index.mjs', needsI18n: true,  needsAgent: false },
  { name: 'options',    src: 'src/options/index.mjs', needsI18n: true,  needsAgent: false },
  { name: 'sidepanel',  src: 'src/sidepanel/index.mjs', needsI18n: false, needsAgent: false },
]

const agentPrimitives = concatAgentPrimitives()
const backgroundProviders = concatBackgroundProviders()

for (const { name, src, needsI18n, needsAgent } of entries) {
  const raw = fs.readFileSync(src, 'utf8')
  const stripped = stripI18nImports(raw)
  const parts = [timeoutInlined]
  if (needsI18n) parts.push(i18nInlined)
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
fs.copyFileSync('src/content-script/styles.css', `${outdir}/styles.css`)

console.log('✓ built dist/')
