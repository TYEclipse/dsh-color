import { describe, expect, it } from 'vitest'
import { parseColorInput, rgbaToOklab, type Rgba } from '../src/color.ts'
import { lookupNamed } from '../src/named.ts'
import { buildColorTools } from '../src/tools.ts'
import type { ScaleResult } from '../src/tools.ts'

/**
 * ORACLE: test/oracle/anchors.py
 * Every expected value in this file is printed by that oracle — an independent
 * Python implementation written from the published definitions (Oklab per
 * Ottosson 2020 / CSS Color 4 §13, ΔE00 per Sharma/Wu/Dalal 2005). Its `--check`
 * replays the published CIEDE2000 and Oklab reference tables before any anchor
 * here is trusted. Never edit an expectation by hand: re-run the oracle and copy.
 */

const tools = buildColorTools()
const executeScale = tools.color_scale.execute as (
  args: { input: string; mode?: string; steps?: number; to?: string; space?: string },
) => Promise<ScaleResult>

function rgba(input: string): Rgba {
  const parsed = parseColorInput(input, lookupNamed)
  if (!parsed.ok) throw new Error(parsed.error)
  return parsed.color.rgba
}

/** First text block of a render result (what the agent actually sees). */
function text(block: unknown): string {
  return ((block as { text: string }[])[0]?.text) ?? ''
}

/** Recursively assert no key anywhere holds `undefined` (lossless-JSON gate). */
function assertNoUndefined(value: unknown, path = 'root'): void {
  if (value === undefined) throw new Error(`undefined value at ${path}`)
  if (value === null || typeof value !== 'object') return
  if (Array.isArray(value)) {
    value.forEach((item, i) => assertNoUndefined(item, `${path}[${i}]`))
    return
  }
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    assertNoUndefined(child, `${path}.${key}`)
  }
}

function hexes(result: ScaleResult): string[] {
  return result.colors.map((color) => color.hex)
}

function deltas(result: ScaleResult): number[] {
  return result.colors.map((color) => color.deltaE00)
}

describe('color_scale tool', () => {
  it('builds an Oklab tint ramp from the base to white', async () => {
    const result = await executeScale({ input: '#336699', mode: 'tints', steps: 5 })
    assertNoUndefined(result)
    expect(result.ok).toBe(true)
    expect(result.mode).toBe('tints')
    expect(result.space).toBe('oklab')
    expect(result.steps).toBe(5)
    expect(result.count).toBe(5)
    expect(hexes(result)).toEqual(['#336699', '#658bb3', '#97b1cd', '#cad7e6', '#ffffff'])
    expect(result.colors[1]?.rgb).toBe('rgb(101, 139, 179)')
    expect(result.colors[4]?.rgb).toBe('rgb(255, 255, 255)')
    expect(deltas(result).map((value) => Number(value.toFixed(4)))).toEqual([0, 14.7494, 27.6067, 38.2167, 48.186])
  })

  it('builds an Oklab shade ramp from the base to black', async () => {
    const result = await executeScale({ input: '#336699', mode: 'shades', steps: 5 })
    expect(hexes(result)).toEqual(['#336699', '#1f4367', '#0d2338', '#020710', '#000000'])
    expect(deltas(result).map((value) => Number(value.toFixed(4)))).toEqual([0, 12.4205, 23.1429, 32.465, 34.9275])
  })

  it('"both" spans black → base → white with the base in the middle', async () => {
    const five = await executeScale({ input: '#336699', mode: 'both', steps: 5 })
    expect(hexes(five)).toEqual(['#000000', '#0d2338', '#336699', '#97b1cd', '#ffffff'])
    expect(five.colors[2]?.deltaE00).toBe(0)

    // An even count has no exact base step, but the ramp stays symmetric in ΔE00.
    const four = await executeScale({ input: '#336699', mode: 'both', steps: 4 })
    expect(hexes(four)).toEqual(['#000000', '#193857', '#7698bc', '#ffffff'])
    expect(deltas(four).map((value) => Number(value.toFixed(4)))).toEqual([34.9275, 16.1489, 19.5536, 48.186])
  })

  it('"between" interpolates toward a second color', async () => {
    const result = await executeScale({ input: '#336699', to: '#ff0080', mode: 'between', steps: 4 })
    expect(result.ok).toBe(true)
    expect(result.to).toBe('#ff0080')
    expect(hexes(result)).toEqual(['#336699', '#866092', '#c44e8a', '#ff0080'])
    expect(deltas(result).map((value) => Number(value.toFixed(4)))).toEqual([0, 23.8951, 38.1887, 46.1622])
  })

  it('interpolates raw channels in sRGB space when asked', async () => {
    const five = await executeScale({ input: '#336699', mode: 'tints', steps: 5, space: 'srgb' })
    expect(five.space).toBe('srgb')
    expect(hexes(five)).toEqual(['#336699', '#668cb3', '#99b3cc', '#ccd9e6', '#ffffff'])
    expect(deltas(five).map((value) => Number(value.toFixed(4)))).toEqual([0, 15.1871, 28.1532, 38.6646, 48.186])

    const three = await executeScale({ input: '#336699', mode: 'tints', steps: 3, space: 'srgb' })
    expect(hexes(three)).toEqual(['#336699', '#99b3cc', '#ffffff'])
  })

  it('Oklab and sRGB ramps really do differ in the middle steps', async () => {
    const perceptual = await executeScale({ input: '#336699', mode: 'tints', steps: 5 })
    const plain = await executeScale({ input: '#336699', mode: 'tints', steps: 5, space: 'srgb' })
    expect(perceptual.colors[1]?.hex).toBe('#658bb3')
    expect(plain.colors[1]?.hex).toBe('#668cb3')
    // The endpoints are shared; the difference is entirely in between.
    expect(perceptual.colors[0]?.hex).toBe(plain.colors[0]?.hex)
    expect(perceptual.colors[4]?.hex).toBe(plain.colors[4]?.hex)
  })

  it('Oklab steps are equally far apart in Oklab (that is the whole point)', async () => {
    const gapSpread = async (space: string) => {
      const ramp = await executeScale({ input: '#336699', mode: 'tints', steps: 5, space })
      const points = ramp.colors.map((color) => rgbaToOklab(rgba(color.hex)))
      const gaps = points.slice(1).map((point, index) => {
        const previous = points[index] as { l: number; a: number; b: number }
        return Math.hypot(point.l - previous.l, point.a - previous.a, point.b - previous.b)
      })
      return { ratio: Math.max(...gaps) / Math.min(...gaps), gaps }
    }
    const perceptual = await gapSpread('oklab')
    const plain = await gapSpread('srgb')
    // Steps come back as 8-bit colors, so even a perfectly even ramp spreads a
    // few percent; the claim is that Oklab is measurably tighter than sRGB.
    expect(perceptual.ratio).toBeLessThan(1.05)
    expect(perceptual.ratio).toBeLessThan(plain.ratio)
    for (const gap of perceptual.gaps) expect(gap).toBeCloseTo(perceptual.gaps[0] ?? 0, 2)
  })

  it('clamps the step count instead of extrapolating', async () => {
    const tooFew = await executeScale({ input: '#336699', mode: 'tints', steps: 1 })
    expect(tooFew.steps).toBe(2)
    expect(tooFew.count).toBe(2)
    const tooMany = await executeScale({ input: '#336699', mode: 'tints', steps: 42 })
    expect(tooMany.steps).toBe(11)
    expect(tooMany.count).toBe(11)
    const defaulted = await executeScale({ input: '#336699' })
    expect(defaulted.steps).toBe(5)
    expect(defaulted.mode).toBe('tints')
    expect(defaulted.space).toBe('oklab')
  })

  it('carries alpha along the ramp', async () => {
    const result = await executeScale({ input: 'rgba(51, 102, 153, 0.5)', mode: 'tints', steps: 3 })
    expect(hexes(result)).toEqual(['#33669980', '#97b1cdbf', '#ffffff'])
    expect(result.colors[0]?.rgb).toBe('rgba(51, 102, 153, 0.5)')
    expect(result.colors[1]?.rgb).toBe('rgba(151, 177, 205, 0.75)')
    expect(result.colors[2]?.rgb).toBe('rgb(255, 255, 255)')

    const both = await executeScale({ input: 'rgba(51, 102, 153, 0.5)', mode: 'both', steps: 3 })
    expect(hexes(both)).toEqual(['#000000', '#33669980', '#ffffff'])
  })

  it('reports a missing or unparseable target for "between"', async () => {
    const missing = await executeScale({ input: '#336699', mode: 'between' })
    assertNoUndefined(missing)
    expect(missing.ok).toBe(false)
    expect(missing.error).toContain('needs the `to` color')
    const badTarget = await executeScale({ input: '#336699', mode: 'between', to: 'octarine' })
    expect(badTarget.ok).toBe(false)
    expect(badTarget.error).toContain('to:')
    const badBase = await executeScale({ input: 'octarine', mode: 'tints' })
    expect(badBase.ok).toBe(false)
    expect(badBase.error).toContain('unrecognized')
  })

  it('handles the shortest possible ramp (2 colors)', async () => {
    const twice = await executeScale({ input: '#336699', mode: 'shades', steps: 2 })
    expect(hexes(twice)).toEqual(['#336699', '#000000'])
    expect(twice.colors[1]?.deltaE00).toBe(34.9275)
  })

  it('rejects unknown modes and spaces at the schema layer', async () => {
    await expect(executeScale({ input: '#336699', mode: 'spiral' })).rejects.toThrow(/must be one of/)
    await expect(executeScale({ input: '#336699', space: 'lab' })).rejects.toThrow(/must be one of/)
  })

  it('renders the ramp as a readable list', async () => {
    const result = await executeScale({ input: '#336699', to: '#ff0080', mode: 'between', steps: 4 })
    const rendered = text(tools.color_scale.output.render({ input: '#336699', to: '#ff0080', mode: 'between' }, result))
    expect(rendered).toContain('between scale from #336699 → #ff0080 in oklab (4 colors)')
    expect(rendered).toContain('#866092')
    expect(rendered).toContain('ΔE00 23.8951')

    const failed = text(tools.color_scale.output.render(
      { input: 'x' },
      { ok: false, error: 'bad color' } as ScaleResult,
    ))
    expect(failed).toBe('color_scale: bad color')
  })
})
