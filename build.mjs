// OmniPilot build script.
//
// Manual concat instead of a real bundler: our unit tests exercise the built
// scripts through `vm.runInContext`, which exposes top-level declarations as
// context properties. Wrapping the output in an IIFE (as esbuild/rollup do
// by default) would hide those declarations and break the tests. Since the
// only shared module is `src/utils/i18n.mjs`, hand-inlining it is trivial
// and keeps the output shape identical to the original flat scripts.
//
// Run with: npm run build
import fs from 'fs'

const outdir = 'dist'

fs.rmSync(outdir, { recursive: true, force: true })
fs.mkdirSync(outdir, { recursive: true })

// Read the shared i18n module and strip its `export { ... };` block so its
// bindings survive as top-level declarations when inlined into another script.
const i18nRaw = fs.readFileSync('src/utils/i18n.mjs', 'utf8')
const i18nInlined = i18nRaw.replace(/^export\s*\{[\s\S]*?\};?\s*$/m, '').trimEnd() + '\n'

// Strip `import { ... } from '.../i18n.mjs';` lines from an entry file.
function stripI18nImports(src) {
  return src.replace(/^import\s+\{[^}]+\}\s+from\s+['"][^'"]*i18n\.mjs['"];?\s*\n/gm, '')
}

const entries = [
  { name: 'background', src: 'src/background/index.mjs', needsI18n: false },
  { name: 'content',    src: 'src/content-script/index.mjs', needsI18n: true  },
  { name: 'popup',      src: 'src/popup/index.mjs', needsI18n: true  },
  { name: 'options',    src: 'src/options/index.mjs', needsI18n: true  },
  { name: 'sidepanel',  src: 'src/sidepanel/index.mjs', needsI18n: false },
]

for (const { name, src, needsI18n } of entries) {
  const raw = fs.readFileSync(src, 'utf8')
  const stripped = stripI18nImports(raw)
  const bundled = needsI18n ? `${i18nInlined}\n${stripped}` : stripped
  fs.writeFileSync(`${outdir}/${name}.js`, bundled)
  const sizeKb = (Buffer.byteLength(bundled) / 1024).toFixed(1)
  console.log(`  dist/${name}.js  ${sizeKb}kb`)
}

// Copy HTML + CSS assets that the manifest / HTML files reference by name.
fs.copyFileSync('src/popup/index.html',        `${outdir}/popup.html`)
fs.copyFileSync('src/options/index.html',      `${outdir}/options.html`)
fs.copyFileSync('src/sidepanel/index.html',    `${outdir}/sidepanel.html`)
fs.copyFileSync('src/content-script/styles.css', `${outdir}/styles.css`)

console.log('✓ built dist/')
