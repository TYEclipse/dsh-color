import { describe, expect, it } from 'vitest'
import { buildColorTools } from '../src/tools.ts'
import type { CvdResult } from '../src/tools.ts'
import { assertLossless } from './helpers/lossless-json.ts'

/**
 * ORACLE: test/oracle/anchors.py
 * Every expected value in this file is printed by section J of that oracle —
 * an independent Python implementation driven by the matrix table published
 * with Machado, Oliveira & Fernandes (2009). Its `--check` replays the table's
 * own invariants (severity 0.0 is exactly the identity; every row sums to 1, so
 * neutral colors stay neutral) plus two physiological facts (deuteranopia
 * collapses a red/green pair that tritanopia leaves far apart). Never edit an
 * expectation by hand: re-run `python3 test/oracle/anchors.py` and copy.
 */

const tools = buildColorTools()
const simulate = tools.cvd_simulate.execute as (
  args: { colors: string[]; type?: string; severity?: number; threshold?: number },
) => Promise<CvdResult>

function text(block: unknown): string {
  return ((block as { text: string }[])[0]?.text) ?? ''
}

function hexes(result: CvdResult): string[] {
  return result.colors.map((color) => color.hex)
}

function shifts(result: CvdResult): number[] {
  return result.colors.map((color) => color.deltaE00)
}

describe('cvd_simulate tool', () => {
  it('is the identity at severity 0', async () => {
    const result = await simulate({ colors: ['#ff0000'], type: 'deutan', severity: 0 })
    assertLossless(result)
    expect(result.ok).toBe(true)
    expect(result.count).toBe(1)
    expect(hexes(result)).toEqual(['#ff0000'])
    expect(result.colors[0]?.rgb).toBe('rgb(255, 0, 0)')
    expect(shifts(result)).toEqual([0])
    expect(result.colors[0]?.clamped).toBe(false)
    expect(result.pairs).toEqual([])
    expect(result.confusablePairs).toBe(0)
    expect(result.note).toBe('one color only — pass a palette to get the pairwise collapse check')
  })

  it('simulates deuteranopia: pure red and pure green both become olive/yellow', async () => {
    const result = await simulate({ colors: ['#ff0000', '#00ff00'], type: 'deutan', severity: 1 })
    assertLossless(result)
    expect(hexes(result)).toEqual(['#a39000', '#efd63a'])
    expect(result.colors[0]?.rgb).toBe('rgb(163, 144, 0)')
    expect(result.colors[1]?.rgb).toBe('rgb(239, 214, 58)')
    expect(shifts(result)).toEqual([44.2817, 27.9874])
    // Pure red needs clamping (its linear red goes out of gamut); pure green does not.
    expect(result.colors[0]?.clamped).toBe(true)
    expect(result.colors[1]?.clamped).toBe(false)
    expect(result.clamped).toBe(true)
  })

  it('simulates protanopia and tritanopia for the same colors', async () => {
    const protan = await simulate({ colors: ['#ff0000', '#00ff00', '#0000ff'], type: 'protan', severity: 1 })
    assertLossless(protan)
    expect(hexes(protan)).toEqual(['#6d5f00', '#ffe500', '#0059ff'])
    expect(shifts(protan)).toEqual([42.3963, 28.2679, 14.8912])

    const tritan = await simulate({ colors: ['#ff0000', '#00ff00', '#0000ff'], type: 'tritan', severity: 1 })
    assertLossless(tritan)
    expect(hexes(tritan)).toEqual(['#ff000f', '#00f7d9', '#006b96'])
    expect(shifts(tritan)).toEqual([1.4595, 25.7757, 23.7359])
  })

  it('interpolates between the tabulated tenths', async () => {
    const sweep: { severity: number; hex: string; delta: number }[] = [
      { severity: 0.2, hex: '#e25500', delta: 10.2289 },
      { severity: 0.5, hex: '#c37600', delta: 25.1428 },
      { severity: 0.55, hex: '#bf7a00', delta: 27.5949 },
      { severity: 0.8, hex: '#ae8800', delta: 37.7614 },
      { severity: 1, hex: '#a39000', delta: 44.2817 },
    ]
    for (const step of sweep) {
      const result = await simulate({ colors: ['#ff0000'], type: 'deutan', severity: step.severity })
      expect(result.severity).toBe(step.severity)
      expect(result.colors[0]?.hex).toBe(step.hex)
      expect(result.colors[0]?.deltaE00).toBeCloseTo(step.delta, 4)
    }
  })

  it('flags the pairs a deficiency collapses — deutan red vs green', async () => {
    const result = await simulate({ colors: ['#e53935', '#2ca02c'], type: 'deutan', severity: 1 })
    assertLossless(result)
    expect(result.colors[0]?.hex).toBe('#98892e')
    expect(result.colors[1]?.hex).toBe('#968838')
    expect(result.pairs).toHaveLength(1)
    expect(result.pairs[0]).toEqual({
      a: '#e53935',
      b: '#2ca02c',
      before: 71.3277,
      after: 1.6504,
      collapse: true,
    })
    expect(result.confusablePairs).toBe(1)
    expect(result.worstPair).toEqual({ a: '#e53935', b: '#2ca02c', after: 1.6504 })
    expect(result.note).toBe('1 of 1 pair drop below ΔE00 2 under this simulation')
  })

  it('flags the pairs a deficiency collapses — protan and tritan', async () => {
    const protan = await simulate({ colors: ['#673ab7', '#9c27b0'], type: 'protan', severity: 1 })
    assertLossless(protan)
    expect(protan.pairs[0]).toEqual({ a: '#673ab7', b: '#9c27b0', before: 10.2784, after: 1.1755, collapse: true })

    const tritan = await simulate({ colors: ['#e53935', '#e91e63'], type: 'tritan', severity: 1 })
    assertLossless(tritan)
    expect(tritan.pairs[0]).toEqual({ a: '#e53935', b: '#e91e63', before: 14.4173, after: 1.394, collapse: true })
  })

  it('does not call a pair collapsed when it stays apart, or was never apart', async () => {
    const apart = await simulate({ colors: ['#ff0000', '#00ff00'], type: 'deutan', severity: 1 })
    expect(apart.pairs[0]).toEqual({ a: '#ff0000', b: '#00ff00', before: 86.6078, after: 19.5135, collapse: false })
    expect(apart.confusablePairs).toBe(0)
    expect(apart.worstPair).toEqual({ a: '#ff0000', b: '#00ff00', after: 19.5135 })
    expect(apart.note).toBe('every pair stays at or above ΔE00 2 under this simulation')

    // Both were already only 3.23 apart, and the shift leaves them 3.34 apart:
    // distinguishable before, still distinguishable after.
    const similar = await simulate({ colors: ['#d32f2f', '#c62828'], type: 'deutan', severity: 1 })
    expect(similar.pairs[0]).toEqual({ a: '#d32f2f', b: '#c62828', before: 3.2276, after: 3.3407, collapse: false })
  })

  it('honours the threshold', async () => {
    const result = await simulate({ colors: ['#ff0000', '#00ff00'], type: 'deutan', severity: 1, threshold: 20 })
    expect(result.threshold).toBe(20)
    expect(result.pairs[0]?.collapse).toBe(true)
    expect(result.confusablePairs).toBe(1)
    expect(result.note).toBe('1 of 1 pair drop below ΔE00 20 under this simulation')
  })

  it('reports every pair of a palette, not just the adjacent ones', async () => {
    const result = await simulate({ colors: ['#ff0000', '#00ff00', '#0000ff'], type: 'deutan', severity: 1 })
    assertLossless(result)
    expect(result.pairs).toHaveLength(3)
    expect(result.pairs.map((pair) => [pair.a, pair.b])).toEqual([
      ['#ff0000', '#00ff00'],
      ['#ff0000', '#0000ff'],
      ['#00ff00', '#0000ff'],
    ])
    expect(result.confusablePairs).toBe(0)
  })

  it('leaves neutral colors on their own value', async () => {
    for (const type of ['protan', 'deutan', 'tritan']) {
      const result = await simulate({ colors: ['#ffffff', '#808080', '#000000'], type, severity: 1 })
      assertLossless(result)
      expect(hexes(result)).toEqual(['#ffffff', '#808080', '#000000'])
      expect(shifts(result)).toEqual([0, 0, 0])
      expect(result.clamped).toBe(false)
    }
  })

  it('flags clamping only when the displayable color actually changed', async () => {
    // #e53935 stays inside the gamut under deuteranopia, and leaves it under tritanopia.
    const deutan = await simulate({ colors: ['#e53935'], type: 'deutan', severity: 1 })
    expect(deutan.colors[0]?.hex).toBe('#98892e')
    expect(deutan.colors[0]?.clamped).toBe(false)
    const tritan = await simulate({ colors: ['#e53935'], type: 'tritan', severity: 1 })
    expect(tritan.colors[0]?.hex).toBe('#fc003a')
    expect(tritan.colors[0]?.clamped).toBe(true)
  })

  it('clamps severity into 0–1 and defaults to deuteranopia at full severity', async () => {
    const defaults = await simulate({ colors: ['#ff0000'] })
    assertLossless(defaults)
    expect(defaults.type).toBe('deutan')
    expect(defaults.severity).toBe(1)
    expect(defaults.threshold).toBe(2)
    expect(defaults.colors[0]?.hex).toBe('#a39000')

    const high = await simulate({ colors: ['#ff0000'], severity: 5 })
    expect(high.severity).toBe(1)
    expect(high.colors[0]?.hex).toBe('#a39000')

    const low = await simulate({ colors: ['#ff0000'], severity: -3 })
    expect(low.severity).toBe(0)
    expect(low.colors[0]?.hex).toBe('#ff0000')
  })

  it('rejects bad input without inventing a result', async () => {
    const empty = await simulate({ colors: [] })
    assertLossless(empty)
    expect(empty.ok).toBe(false)
    expect(empty.error).toBe('give at least one color')
    expect(empty.count).toBe(0)
    expect(empty.colors).toEqual([])
    expect(empty.note).toBeUndefined()

    const tooMany = await simulate({
      colors: ['#111111', '#222222', '#333333', '#444444', '#555555', '#666666', '#777777'],
      type: 'deutan',
    })
    expect(tooMany.ok).toBe(false)
    expect(tooMany.error).toBe('at most 6 colors per call (got 7)')

    const invalid = await simulate({ colors: ['#ff0000', 'notacolor'], type: 'deutan' })
    expect(invalid.ok).toBe(false)
    expect(invalid.error).toMatch(/^colors\[1\]: unrecognized color format/)
    expect(invalid.count).toBe(0)
  })

  it('rejects an unknown deficiency at the schema layer', async () => {
    await expect(simulate({ colors: ['#ff0000'], type: 'achromatopsia' })).rejects.toThrow(/type/)
  })

  it('renders a readable summary', async () => {
    const args = { colors: ['#e53935', '#2ca02c'], type: 'deutan', severity: 1 }
    const result = await simulate(args)
    const line = text(tools.cvd_simulate.output.render(args, result))
    expect(line).toContain('deutan severity 1 (2 colors)')
    expect(line).toContain('#e53935 → #98892e')
    expect(line).toContain('#2ca02c → #968838')
    expect(line).toContain('collapsed below 2')
  })
})
