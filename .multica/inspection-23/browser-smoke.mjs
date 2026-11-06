import { readFile } from 'node:fs/promises'
import ts from 'typescript'
import { chromium } from 'playwright-core'

const source = await readFile('lib/date-time.ts', 'utf8')
const code = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.ES2020 } }).outputText
const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true })
try {
  const page = await browser.newPage()
  const results = await page.evaluate(async code => {
    globalThis.Temporal = undefined
    const { zonedMidnight } = await import(URL.createObjectURL(new Blob([code], { type: 'text/javascript' })))
    const cases = [
      ['America/Havana', 2026, 3, 8, '2026-03-08T05:00:00.000Z'],
      ['America/Havana', 2026, 11, 1, '2026-11-01T04:00:00.000Z'],
      ['America/Santiago', 2026, 9, 6, '2026-09-06T04:00:00.000Z'],
      ['Africa/Cairo', 2026, 4, 24, '2026-04-23T22:00:00.000Z'],
      ['Pacific/Apia', 2011, 12, 30, '2011-12-30T10:00:00.000Z'],
      ['Asia/Shanghai', 2026, 12, 32, '2026-12-31T16:00:00.000Z'],
      ['UTC', 2026, 3, 8, '2026-03-08T00:00:00.000Z'],
      ['America/New_York', 2026, 3, 8, '2026-03-08T05:00:00.000Z'],
      ['America/New_York', 2026, 11, 1, '2026-11-01T04:00:00.000Z']
    ]
    return cases.map(([zone, year, month, day, expected]) => {
      const actual = new Date(zonedMidnight(year, month, day, zone)).toISOString()
      if (actual !== expected) throw new Error(`${zone}: ${actual} !== ${expected}`)
      return { zone, year, month, day, actual }
    })
  }, code)
  console.log(JSON.stringify({ browser: await browser.version(), temporal: 'disabled', passed: results.length, results }, null, 2))
} finally {
  await browser.close()
}
