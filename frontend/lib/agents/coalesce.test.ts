import { describe, it, expect } from 'vitest'
import { createCoalescer } from './coalesce'

/** A run whose completion the test controls. */
function controllableRun() {
  const started: number[] = []
  const finishers: (() => void)[] = []
  const run = (e: number) => {
    started.push(e)
    return new Promise<string>(resolve => finishers.push(() => resolve(`done ${e}`)))
  }
  const finishNext = async () => { finishers.shift()?.(); await new Promise(r => setTimeout(r, 0)) }
  return { run, started, finishNext }
}

describe('createCoalescer [decision 4]', () => {
  it('runs an event immediately when idle', async () => {
    const { run, started, finishNext } = controllableRun()
    const results: string[] = []
    const c = createCoalescer({ run, onResult: r => results.push(r) })
    c.submit(1)
    expect(started).toEqual([1])
    expect(c.busy).toBe(true)
    await finishNext()
    expect(results).toEqual(['done 1'])
    expect(c.busy).toBe(false)
  })

  it('while busy, keeps only the LATEST event and reports the dropped ones', async () => {
    const { run, started, finishNext } = controllableRun()
    const results: string[] = []
    const skipped: number[] = []
    const c = createCoalescer({ run, onResult: r => results.push(r), onSkipped: e => skipped.push(e) })
    c.submit(1)
    c.submit(2)
    c.submit(3)   // replaces 2
    c.submit(4)   // replaces 3
    expect(skipped).toEqual([2, 3])
    await finishNext()
    expect(started).toEqual([1, 4])
    await finishNext()
    expect(results).toEqual(['done 1', 'done 4'])
    expect(c.busy).toBe(false)
  })

  it('a failing run is reported and does not jam the queue', async () => {
    const errors: unknown[] = []
    const results: string[] = []
    let n = 0
    const c = createCoalescer({
      run: async (e: number) => { if (n++ === 0) throw new Error('boom'); return `done ${e}` },
      onResult: r => results.push(r),
      onError: err => errors.push(err),
    })
    c.submit(1)
    c.submit(2)
    await new Promise(r => setTimeout(r, 0))
    await new Promise(r => setTimeout(r, 0))
    expect(errors).toHaveLength(1)
    expect(results).toEqual(['done 2'])
  })
})
