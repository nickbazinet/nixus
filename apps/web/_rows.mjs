import { chromium } from '@playwright/test'
import { mkdirSync } from 'node:fs'
mkdirSync('/tmp/stage-rows', { recursive: true })
const BASE = 'http://127.0.0.1:4319'
const b = await chromium.launch({ channel: 'chrome' })
const errs = []
for (const [scheme, w, h, mobile] of [['light', 1440, 900, false], ['dark', 1440, 900, false], ['light', 390, 844, true]]) {
  const ctx = await b.newContext({ viewport: { width: w, height: h }, colorScheme: scheme, isMobile: mobile, hasTouch: mobile, deviceScaleFactor: mobile ? 2 : 1 })
  const p = await ctx.newPage()
  p.on('console', (m) => { if (['error', 'warning'].includes(m.type())) errs.push(m.text()) })
  p.on('requestfailed', (r) => errs.push('FAILED ' + r.url()))
  p.on('response', (r) => { if (r.status() >= 400) errs.push(r.status() + ' ' + r.url()) })
  await p.goto(BASE + '/', { waitUntil: 'networkidle' })
  await p.evaluate(async () => { for (let y = 0; y < document.body.scrollHeight; y += 450) { scrollTo(0, y); await new Promise(r => setTimeout(r, 45)) } })
  const heights = []
  for (const id of ['organize', 'understand', 'guide', 'automate']) {
    const row = p.locator(`[data-stage=${id}]`)
    await row.scrollIntoViewIfNeeded(); await p.waitForTimeout(950)
    const frame = row.locator('figure')
    const bb = await frame.boundingBox()
    const img = await row.locator('img').evaluate((i) => ({ src: i.getAttribute('src'), natural: i.naturalWidth + 'x' + i.naturalHeight, ok: i.complete && i.naturalWidth > 0 }))
    heights.push(Math.round(bb.height))
    if ((id === 'guide' || id === 'automate') && !(mobile && scheme !== 'light')) await row.screenshot({ path: `/tmp/stage-rows/${scheme}-${mobile ? 'phone' : 'desktop'}-${id}.png` })
    console.log(`${scheme.padEnd(5)} ${String(w).padEnd(5)} ${id.padEnd(10)} ${img.src.padEnd(34)} natural ${img.natural.padEnd(10)} loaded:${img.ok}  frame ${Math.round(bb.width)}x${Math.round(bb.height)}`)
  }
  console.log(`      -> frame heights ${heights.join(', ')}  (spread ${Math.max(...heights) - Math.min(...heights)}px)\n`)
  await ctx.close()
}
console.log('console/network problems:', errs.length ? errs : 'none')
await b.close()
