import { describe, expect, it } from 'vitest'
import {
  deltaE2000,
  deltaE76,
  differenceVerdict,
  labToRgba,
  parseColorInput,
  rgbaToLab,
  type LabColor,
  type Rgba,
} from '../src/color.ts'
import { lookupNamed } from '../src/named.ts'
import { buildColorTools } from '../src/tools.ts'
import type { DifferenceResult } from '../src/tools.ts'

/**
 * ORACLE: test/oracle/anchors.py
 * Every expected value in this file is printed by that oracle — an independent
 * Python implementation written from the published definitions (CSS Color 4 for
 * Lab and Oklab, Sharma/Wu/Dalal 2005 for CIEDE2000). Its `--check` replays the
 * published 34-pair CIEDE2000 reference table and Ottosson's Oklab XYZ table
 * before any anchor here is trusted. Never edit an expectation by hand: re-run
 * `python3 test/oracle/anchors.py` and copy the printed value.
 */

const tools = buildColorTools()
const executeDifference = tools.color_difference.execute as (
  args: { color1: string; color2: string; method?: string; threshold?: number },
) => Promise<DifferenceResult>

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

/** Assert a Lab triplet against oracle values, and that no value is a live `-0`. */
function expectLab(actual: LabColor, expected: [number, number, number]): void {
  expect(actual.l).toBeCloseTo(expected[0], 4)
  expect(actual.a).toBeCloseTo(expected[1], 4)
  expect(actual.b).toBeCloseTo(expected[2], 4)
  for (const value of [actual.l, actual.a, actual.b]) {
    expect(Object.is(value, -0)).toBe(false)
  }
}

describe('CIELAB conversion (D65)', () => {
  it('white is exactly neutral and black is the origin', () => {
    expectLab(rgbaToLab(rgba('#ffffff')), [100, 0, 0])
    expectLab(rgbaToLab(rgba('#000000')), [0, 0, 0])
  })

  it('neutral grays stay on the a = b = 0 axis', () => {
    expectLab(rgbaToLab(rgba('#808080')), [53.585, 0, 0])
  })

  it('sRGB primaries and mid-tones', () => {
    expectLab(rgbaToLab(rgba('#ff0000')), [53.2371, 80.0901, 67.2033])
    expectLab(rgbaToLab(rgba('#00ff00')), [87.7355, -86.1816, 83.1866])
    expectLab(rgbaToLab(rgba('#0000ff')), [32.3009, 79.1953, -107.8555])
    expectLab(rgbaToLab(rgba('#336699')), [42.0092, -0.1459, -32.8451])
    expectLab(rgbaToLab(rgba('#ff0080')), [54.8888, 84.5339, 4.0739])
  })

  it('round-trips back to the same sRGB channels', () => {
    for (const hex of ['#ff0000', '#336699', '#ff0080', '#000000', '#ffffff', '#0d2338']) {
      const source = rgba(hex)
      const back = labToRgba(rgbaToLab(source))
      expect(Math.abs(back.r - source.r)).toBeLessThan(1e-9)
      expect(Math.abs(back.g - source.g)).toBeLessThan(1e-9)
      expect(Math.abs(back.b - source.b)).toBeLessThan(1e-9)
    }
  })

  it('keeps the alpha it is given when converting back', () => {
    expect(labToRgba({ l: 50, a: 0, b: 0 }, 0.25).a).toBe(0.25)
  })
})

describe('deltaE2000 core (published reference table)', () => {
  // Lab pairs and their published ΔE00 values from Sharma, Wu & Dalal (2005);
  // the oracle replays all 34 on every run and prints these seven.
  const cases: Array<[LabColor, LabColor, number]> = [
    [{ l: 50, a: 0, b: 0 }, { l: 50, a: -1, b: 2 }, 2.3669],
    [{ l: 50, a: 2.49, b: -0.001 }, { l: 50, a: -2.49, b: 0.0009 }, 7.1792],
    [{ l: 50, a: 2.5, b: 0 }, { l: 50, a: 0, b: -2.5 }, 4.3065],
    [{ l: 50, a: 2.5, b: 0 }, { l: 73, a: 25, b: -18 }, 27.1492],
    [{ l: 50, a: 2.5, b: 0 }, { l: 61, a: -5, b: 29 }, 22.8977],
    [{ l: 60.2574, a: -34.0099, b: 36.2677 }, { l: 60.4626, a: -34.1751, b: 39.4387 }, 1.2644],
    [{ l: 2.0776, a: 0.0795, b: -1.135 }, { l: 0.9033, a: -0.0636, b: -0.5514 }, 0.9082],
  ]

  it('matches the published ΔE00 values', () => {
    for (const [first, second, expected] of cases) {
      expect(deltaE2000(first, second)).toBeCloseTo(expected, 4)
      // ΔE00 is symmetric; the reference table's pairs confirm it.
      expect(deltaE2000(second, first)).toBeCloseTo(expected, 4)
    }
  })

  it('is zero for identical colors and 100 for white against black', () => {
    expectLab(rgbaToLab(rgba('#ff0000')), [53.2371, 80.0901, 67.2033])
    expect(deltaE2000(rgbaToLab(rgba('#ff0000')), rgbaToLab(rgba('#ff0000')))).toBe(0)
    expect(deltaE2000(rgbaToLab(rgba('#ffffff')), rgbaToLab(rgba('#000000')))).toBe(100)
  })

  it('deltaE76 is the plain Lab distance', () => {
    const white = rgbaToLab(rgba('#ffffff'))
    const black = rgbaToLab(rgba('#000000'))
    expect(deltaE76(white, black)).toBeCloseTo(100, 6)
    expect(deltaE76(rgbaToLab(rgba('#336699')), rgbaToLab(rgba('#3366ff')))).toBeCloseTo(61.1101, 4)
  })
})

describe('difference verdict bands', () => {
  it('maps ΔE00 onto plain-language bands', () => {
    expect(differenceVerdict(0)).toBe('identical')
    expect(differenceVerdict(1)).toBe('identical')
    expect(differenceVerdict(1.5)).toBe('barely-perceptible')
    expect(differenceVerdict(2)).toBe('barely-perceptible')
    expect(differenceVerdict(2.5)).toBe('perceptible')
    expect(differenceVerdict(10)).toBe('perceptible')
    expect(differenceVerdict(25)).toBe('different')
    expect(differenceVerdict(49)).toBe('different')
    expect(differenceVerdict(50)).toBe('very-different')
    expect(differenceVerdict(100)).toBe('very-different')
  })
})

describe('color_difference tool', () => {
  it('reports ΔE00, ΔE76, both Lab colors and the verdict', async () => {
    const result = await executeDifference({ color1: '#336699', color2: '#3366ff' })
    assertNoUndefined(result)
    expect(result.ok).toBe(true)
    expect(result.deltaE2000).toBeCloseTo(11.7766, 4)
    expect(result.deltaE76).toBeCloseTo(61.1101, 4)
    expect(result.deltaE).toBeCloseTo(11.7766, 4)
    expect(result.method).toBe('de2000')
    expect(result.verdict).toBe('different')
    expect(result.threshold).toBe(2)
    expect(result.similar).toBe(false)
    expect(result.lab1.l).toBeCloseTo(42.0092, 4)
    expect(result.lab1.b).toBeCloseTo(-32.8451, 4)
    expect(result.lab2.l).toBeCloseTo(48.7917, 4)
    expect(result.lab2.b).toBeCloseTo(-80.521, 4)
  })

  it('calls two near-identical colors similar and rounds tiny hues to plain zero', async () => {
    const result = await executeDifference({ color1: '#000000', color2: '#010101' })
    assertNoUndefined(result)
    expect(result.deltaE2000).toBeCloseTo(0.1571, 4)
    expect(result.deltaE76).toBeCloseTo(0.2742, 4)
    expect(result.verdict).toBe('identical')
    expect(result.similar).toBe(true)
    // -0 would round-trip lossily through JSON, so neutral channels come back as 0.
    expect(Object.is(result.lab1.a, -0)).toBe(false)
    expect(result.lab1.a).toBe(0)
  })

  it('separates one 8-bit step on a mid gray', async () => {
    const result = await executeDifference({ color1: '#808080', color2: '#7f7f7f' })
    expect(result.deltaE2000).toBeCloseTo(0.3806, 4)
    expect(result.deltaE76).toBeCloseTo(0.3922, 4)
    expect(result.verdict).toBe('identical')
  })

  it('honors the requested method and tolerance', async () => {
    const de76 = await executeDifference({ color1: '#336699', color2: '#3366ff', method: 'de76' })
    expect(de76.method).toBe('de76')
    expect(de76.deltaE).toBeCloseTo(61.1101, 4)
    expect(de76.deltaE2000).toBeCloseTo(11.7766, 4)

    // The tolerance is inclusive, and it always compares the perceptual ΔE00 —
    // even when the reported figure was the CIE76 one.
    const boundary = await executeDifference({ color1: '#336699', color2: '#3366ff', method: 'de76', threshold: 11.7766 })
    expect(boundary.threshold).toBe(11.7766)
    expect(boundary.similar).toBe(true)

    const strict = await executeDifference({ color1: '#336699', color2: '#3366ff', threshold: 0 })
    expect(strict.similar).toBe(false)
  })

  it('reports which operand failed to parse', async () => {
    const badFirst = await executeDifference({ color1: 'octarine', color2: '#ffffff' })
    assertNoUndefined(badFirst)
    expect(badFirst.ok).toBe(false)
    expect(badFirst.error).toContain('color1')
    const badSecond = await executeDifference({ color1: '#ffffff', color2: 'octarine' })
    expect(badSecond.ok).toBe(false)
    expect(badSecond.error).toContain('color2')
  })

  it('rejects unknown methods at the schema layer', async () => {
    await expect(executeDifference({ color1: '#ffffff', color2: '#000000', method: 'de94' })).rejects
      .toThrow(/must be one of/)
  })

  it('renders a compact sentence', async () => {
    const result = await executeDifference({ color1: '#336699', color2: '#3366ff' })
    const rendered = text(tools.color_difference.output.render({ color1: '#336699', color2: '#3366ff' }, result))
    expect(rendered).toContain('ΔE00 11.7766')
    expect(rendered).toContain('ΔE76 61.1101')
    expect(rendered).toContain('different')
    expect(rendered).toContain('beyond 2')

    const failed = text(tools.color_difference.output.render(
      { color1: 'x', color2: 'y' },
      { ok: false, error: 'bad color' } as DifferenceResult,
    ))
    expect(failed).toBe('color_difference: bad color')
  })
})
