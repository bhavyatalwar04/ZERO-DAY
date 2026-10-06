// 4.3 Fetch + validate REAL daily OHLCV for a scenario day (ADR-009).
// Usage: node scripts/fetch-scenario-daily.mjs <SCENARIO_ID> <YYYY-MM-DD> <TICKER>...
// Writes lib/data/scenarios/<id>/daily.json: the scenario day's bar and the
// previous trading day's close per ticker, plus provenance (source URL, fetch time).
//
// Yahoo's chart API returns prices ADJUSTED for later splits/bonus issues. A trader on
// the day saw unadjusted prices, so we multiply back by every split after the date
// (events=split) and record the factor. Validation fails loudly on bad bars.
// Written by Claude at Bhavya's request (2026-10-03).
import fs from 'node:fs'
import path from 'node:path'

const [id, date, ...tickers] = process.argv.slice(2)
if (!id || !/^\d{4}-\d{2}-\d{2}$/.test(date ?? '') || tickers.length === 0) {
  console.error('usage: node scripts/fetch-scenario-daily.mjs <SCENARIO_ID> <YYYY-MM-DD> <TICKER>...')
  process.exit(1)
}

const day = Date.parse(`${date}T00:00:00Z`) / 1000
const from = day - 12 * 86400, to = day + 2 * 86400
const ymd = (sec, tz) => new Date((sec + tz) * 1000).toISOString().slice(0, 10)

async function fetchTicker(t) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(t)}?period1=${from}&period2=${to}&interval=1d&events=split`
  const res = await fetch(url, { headers: { 'user-agent': 'Mozilla/5.0' } })
  if (!res.ok) throw new Error(`${t}: HTTP ${res.status}`)
  const j = await res.json()
  const r = j.chart?.result?.[0]
  if (!r) throw new Error(`${t}: no data (${j.chart?.error?.description ?? 'unknown'})`)
  const tz = r.meta.gmtoffset ?? 0
  const q = r.indicators.quote[0]
  const rows = r.timestamp.map((ts, i) => ({ date: ymd(ts, tz), open: q.open[i], high: q.high[i], low: q.low[i], close: q.close[i], volume: q.volume[i] }))
    .filter(b => b.open != null && b.close != null)
  const i = rows.findIndex(b => b.date === date)
  if (i < 1) throw new Error(`${t}: ${date} not found or no previous day (got ${rows.map(b => b.date).join(', ')})`)

  // Splits after the scenario date: Yahoo's prices are divided by these; undo it.
  const splitsUrl = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(t)}?period1=${day}&period2=${Math.floor(Date.now() / 1000)}&interval=1mo&events=split`
  const sj = await (await fetch(splitsUrl, { headers: { 'user-agent': 'Mozilla/5.0' } })).json()
  const splits = Object.values(sj.chart?.result?.[0]?.events?.splits ?? {}).filter(s => s.date > day + 86400)
  const factor = splits.reduce((f, s) => f * (s.numerator / s.denominator), 1)
  const un = n => Math.round(n * factor * 100) / 100
  const bar = rows[i], prev = rows[i - 1]
  return {
    ticker: t, currency: r.meta.currency, exchange: r.meta.exchangeName,
    date, prevDate: prev.date, prevClose: un(prev.close),
    open: un(bar.open), high: un(bar.high), low: un(bar.low), close: un(bar.close),
    volume: bar.volume ? Math.round(bar.volume / factor) : 0,
    splitFactor: factor, splits: splits.map(s => `${s.splitRatio} on ${ymd(s.date, 0)}`),
    source: url,
  }
}

function validate(b) {
  const problems = []
  if (!(b.low <= Math.min(b.open, b.close) && Math.max(b.open, b.close) <= b.high)) problems.push('OHLC inconsistent (low ≤ open,close ≤ high fails)')
  if (!(b.prevClose > 0)) problems.push('no previous close')
  if (b.high / b.low > 3) problems.push(`range ${Math.round(b.high / b.low * 100)}% of low: check for a bad print`)
  if (b.volume === 0 && !b.ticker.startsWith('^')) problems.push('zero volume')
  return problems
}

const out = { scenarioId: id, date, fetchedAt: new Date().toISOString(), source: 'Yahoo Finance chart API (daily bars, split-unadjusted by this script)', bars: {} }
let bad = 0
for (const t of tickers) {
  try {
    const b = await fetchTicker(t)
    const p = validate(b)
    if (p.length) { bad++; console.error(`✗ ${t}: ${p.join('; ')}`) }
    out.bars[t] = b
    const chg = ((b.close / b.prevClose - 1) * 100).toFixed(2)
    console.log(`${t.padEnd(14)} prev ${b.prevClose} → O ${b.open} H ${b.high} L ${b.low} C ${b.close} (${chg}%)${b.splitFactor !== 1 ? ` [split ×${b.splitFactor}: ${b.splits.join(', ')}]` : ''}`)
  } catch (e) { bad++; console.error(`✗ ${e.message}`) }
}
const dir = path.resolve('lib/data/scenarios', id.toLowerCase())
fs.mkdirSync(dir, { recursive: true })
if (process.env.DRY !== '1') fs.writeFileSync(path.join(dir, 'daily.json'), JSON.stringify(out, null, 2) + '\n')
if (bad) { console.error(`${bad} problem(s)`); process.exit(2) }
