// Generates build/icon.png (512×512) — a flat printer mark in Keenetic blue.
// Kept as a script so the icon is reproducible instead of a binary blob.
import { deflateSync } from 'node:zlib'
import { writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const S = 512
const px = new Uint8Array(S * S * 4)

const put = (x, y, [r, g, b], a = 255) => {
  if (x < 0 || y < 0 || x >= S || y >= S) return
  const i = (y * S + x) * 4
  const sa = a / 255
  px[i] = Math.round(px[i] * (1 - sa) + r * sa)
  px[i + 1] = Math.round(px[i + 1] * (1 - sa) + g * sa)
  px[i + 2] = Math.round(px[i + 2] * (1 - sa) + b * sa)
  px[i + 3] = Math.max(px[i + 3], Math.round(a))
}

const rect = (x, y, w, h, color) => {
  for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) put(i, j, color)
}

const roundRect = (x, y, w, h, r, color) => {
  for (let j = y; j < y + h; j++) {
    for (let i = x; i < x + w; i++) {
      const dx = Math.max(x + r - i, i - (x + w - r - 1), 0)
      const dy = Math.max(y + r - j, j - (y + h - r - 1), 0)
      const d = Math.hypot(dx, dy)
      if (d <= r - 0.5) put(i, j, color)
      else if (d < r + 0.5) put(i, j, color, (r + 0.5 - d) * 255)
    }
  }
}

const circle = (cx, cy, r, color) => {
  for (let j = Math.floor(cy - r - 1); j <= cy + r + 1; j++) {
    for (let i = Math.floor(cx - r - 1); i <= cx + r + 1; i++) {
      const d = Math.hypot(i - cx, j - cy)
      if (d <= r - 0.5) put(i, j, color)
      else if (d < r + 0.5) put(i, j, color, (r + 0.5 - d) * 255)
    }
  }
}

const BLUE = [0, 134, 203]
const WHITE = [255, 255, 255]
const SOFT = [204, 230, 245]

roundRect(0, 0, S, S, 104, BLUE)
// sheet feeding in
roundRect(160, 84, 192, 96, 10, SOFT)
// printer body
roundRect(104, 172, 304, 150, 18, WHITE)
// status light
circle(360, 214, 13, BLUE)
// output tray with two text lines
roundRect(152, 296, 208, 132, 12, WHITE)
rect(152, 296, 208, 10, BLUE)
rect(184, 340, 144, 14, SOFT)
rect(184, 374, 96, 14, SOFT)

// --- PNG encoding -----------------------------------------------------------
const raw = Buffer.alloc((S * 4 + 1) * S)
for (let y = 0; y < S; y++) {
  raw[y * (S * 4 + 1)] = 0
  Buffer.from(px.buffer, y * S * 4, S * 4).copy(raw, y * (S * 4 + 1) + 1)
}

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c >>> 0
})
const crc32 = (buf) => {
  let c = 0xffffffff
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}
const chunk = (type, data) => {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body))
  return Buffer.concat([len, body, crc])
}
const ihdr = Buffer.alloc(13)
ihdr.writeUInt32BE(S, 0)
ihdr.writeUInt32BE(S, 4)
ihdr[8] = 8
ihdr[9] = 6
const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', ihdr),
  chunk('IDAT', deflateSync(raw, { level: 9 })),
  chunk('IEND', Buffer.alloc(0)),
])

const out = join(dirname(fileURLToPath(import.meta.url)), '..', 'build', 'icon.png')
mkdirSync(dirname(out), { recursive: true })
writeFileSync(out, png)
console.log('icon written:', out, png.length, 'bytes')
