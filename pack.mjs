// OmniPilot Chrome-extension packager.
// Bundles manifest.json + PRIVACY.md + icons/ + dist/ into a distributable ZIP.
// Requires `npm run build` to have populated dist/ (see Makefile `package` target).
// Zero external deps — uses Node's zlib.deflateRawSync to write a minimal ZIP.
import fs from 'fs'
import path from 'path'
import zlib from 'zlib'

const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'))
const outFile = process.argv[2] || `${pkg.name}-${pkg.version}.zip`

// Files/dirs to ship. Each entry is a filesystem path; nested files are added
// recursively with their relative path preserved inside the ZIP.
const ENTRIES = ['manifest.json', 'PRIVACY.md', 'icons', 'dist']

// Refuse to ship without a build — a missing dist/ would silently produce a
// half-broken package that won't load in Chrome.
if (!fs.existsSync('dist/background.js')) {
  console.error('✗ dist/ is missing or empty — run `npm run build` first.')
  process.exit(1)
}

function collect(entry, base = '') {
  const stat = fs.statSync(entry)
  if (stat.isFile()) return [{ archivePath: base + path.basename(entry), fsPath: entry }]
  const dirName = base + path.basename(entry) + '/'
  return fs.readdirSync(entry).flatMap(child =>
    collect(path.join(entry, child), dirName)
  )
}

const files = ENTRIES.flatMap(entry => collect(entry))

// --- Minimal ZIP writer (spec: PKWARE APPNOTE §4.3) ---
// Uses store or deflate per-file depending on which is smaller.
function crc32(buf) {
  // Standard IEEE 802.3 CRC-32, table lookup.
  let table = crc32.table
  if (!table) {
    table = new Uint32Array(256)
    for (let i = 0; i < 256; i++) {
      let c = i
      for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1)
      table[i] = c >>> 0
    }
    crc32.table = table
  }
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i++) c = table[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function dosDateTime(d) {
  // ZIP encodes mtime as an MS-DOS date+time pair. Two-second resolution is enough.
  const time = ((d.getHours() & 0x1f) << 11) | ((d.getMinutes() & 0x3f) << 5) | ((d.getSeconds() >>> 1) & 0x1f)
  const date = (((d.getFullYear() - 1980) & 0x7f) << 9) | (((d.getMonth() + 1) & 0x0f) << 5) | (d.getDate() & 0x1f)
  return { time, date }
}

const localChunks = []
const centralChunks = []
let offset = 0

// Force a fixed mtime for reproducible ZIPs. Value below is 2025-01-01 00:00:00.
const { time: mtime, date: mdate } = dosDateTime(new Date(2025, 0, 1, 0, 0, 0))

for (const { archivePath, fsPath } of files) {
  const raw = fs.readFileSync(fsPath)
  const deflated = zlib.deflateRawSync(raw)
  const useDeflate = deflated.length < raw.length
  const body = useDeflate ? deflated : raw
  const method = useDeflate ? 8 : 0
  const crc = crc32(raw)
  const nameBuf = Buffer.from(archivePath, 'utf8')

  // Local file header (30 bytes + name)
  const lfh = Buffer.alloc(30)
  lfh.writeUInt32LE(0x04034b50, 0)
  lfh.writeUInt16LE(20, 4)                 // version needed
  lfh.writeUInt16LE(0, 6)                  // flags
  lfh.writeUInt16LE(method, 8)
  lfh.writeUInt16LE(mtime, 10)
  lfh.writeUInt16LE(mdate, 12)
  lfh.writeUInt32LE(crc, 14)
  lfh.writeUInt32LE(body.length, 18)       // compressed size
  lfh.writeUInt32LE(raw.length, 22)        // uncompressed size
  lfh.writeUInt16LE(nameBuf.length, 26)
  lfh.writeUInt16LE(0, 28)                 // extra length
  localChunks.push(lfh, nameBuf, body)

  // Central directory record (46 bytes + name)
  const cdr = Buffer.alloc(46)
  cdr.writeUInt32LE(0x02014b50, 0)
  cdr.writeUInt16LE(20, 4)                 // version made by
  cdr.writeUInt16LE(20, 6)                 // version needed
  cdr.writeUInt16LE(0, 8)                  // flags
  cdr.writeUInt16LE(method, 10)
  cdr.writeUInt16LE(mtime, 12)
  cdr.writeUInt16LE(mdate, 14)
  cdr.writeUInt32LE(crc, 16)
  cdr.writeUInt32LE(body.length, 20)
  cdr.writeUInt32LE(raw.length, 24)
  cdr.writeUInt16LE(nameBuf.length, 28)
  cdr.writeUInt16LE(0, 30)                 // extra length
  cdr.writeUInt16LE(0, 32)                 // comment length
  cdr.writeUInt16LE(0, 34)                 // disk number
  cdr.writeUInt16LE(0, 36)                 // internal attributes
  cdr.writeUInt32LE(0, 38)                 // external attributes
  cdr.writeUInt32LE(offset, 42)            // local header offset
  centralChunks.push(cdr, nameBuf)

  offset += lfh.length + nameBuf.length + body.length
}

const central = Buffer.concat(centralChunks)
const centralOffset = offset

// End-of-central-directory record
const eocd = Buffer.alloc(22)
eocd.writeUInt32LE(0x06054b50, 0)
eocd.writeUInt16LE(0, 4)                   // disk number
eocd.writeUInt16LE(0, 6)                   // central dir start disk
eocd.writeUInt16LE(files.length, 8)        // records on this disk
eocd.writeUInt16LE(files.length, 10)       // total records
eocd.writeUInt32LE(central.length, 12)     // central dir size
eocd.writeUInt32LE(centralOffset, 16)      // central dir offset
eocd.writeUInt16LE(0, 20)                  // comment length

fs.writeFileSync(outFile, Buffer.concat([...localChunks, central, eocd]))

const total = fs.statSync(outFile).size
console.log(`✓ ${outFile}  (${files.length} files, ${(total / 1024).toFixed(1)} KB)`)
