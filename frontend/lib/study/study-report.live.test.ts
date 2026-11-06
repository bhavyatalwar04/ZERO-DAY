import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { analyseStudy, parseCsv, studyReport, toStudyRows } from './analysis'

// ============================================================================
// 5.4 study report: `STUDY_CSV=path/to/export.csv npm run study`
// Reads the export from docs/STUDY.md (Supabase SQL editor → Download CSV),
// runs the pre-registered analysis (analysis.ts) and writes
// docs/evidence/study-<date>.md (or STUDY_OUT). No network, no LLM.
// Keep the CSV itself out of git: it contains user ids.
// Written by Claude at Bhavya's request (2026-11-04).
// ============================================================================

const csvPath = process.env.STUDY_CSV

describe('5.4 study report', () => {
  it.skipIf(!csvPath)('analyses the export and writes the report', () => {
    const rows = toStudyRows(parseCsv(fs.readFileSync(csvPath!, 'utf8')))
    expect(rows.length, 'no participant rows in the export (is the condition column empty?)').toBeGreaterThan(0)
    const date = new Date().toISOString().slice(0, 10)
    const md = studyReport(analyseStudy(rows), { source: path.basename(csvPath!), date })
    const out = process.env.STUDY_OUT ?? path.resolve(process.cwd(), `../docs/evidence/study-${date}.md`)
    fs.writeFileSync(out, md)
    console.log(`\n${md}\nWritten to ${out}`)
  })

  it.skipIf(!!csvPath)('needs STUDY_CSV', () => {
    console.log('Set STUDY_CSV to the exported CSV, e.g. STUDY_CSV=~/Downloads/study.csv npm run study')
  })
})
