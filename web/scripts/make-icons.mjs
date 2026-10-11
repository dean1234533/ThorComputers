// Builds PWA icons from the official Thor Computer round mark (public/brand/mark-300.png).
import sharp from 'sharp'
const src = 'public/brand/mark-300.png'
const BLUE = { r: 0x22, g: 0x5a, b: 0xa5, alpha: 1 }
const out = (n) => `public/icons/${n}.png`

for (const s of [192, 512]) await sharp(src).resize(s, s, { kernel: 'lanczos3' }).png().toFile(out(`icon-${s}`))
// Maskable: brand-blue full bleed, mark inside the 80% safe zone.
for (const s of [192, 512]) {
  const inner = Math.round(s * 0.72)
  const mark = await sharp(src).resize(inner, inner, { kernel: 'lanczos3' }).png().toBuffer()
  await sharp({ create: { width: s, height: s, channels: 4, background: BLUE } })
    .composite([{ input: mark, gravity: 'center' }]).png().toFile(out(`maskable-${s}`))
}
await sharp(src).resize(180, 180).flatten({ background: BLUE }).png().toFile(out('apple-touch-icon'))
await sharp(src).resize(32, 32).png().toFile('public/favicon.png')
console.log('icons built')
