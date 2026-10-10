import { describe, expect, it } from 'vitest'
import {
  adjustHsl,
  harmonyHsl,
  rgbToHsl,
} from '../src/color.ts'
import { buildColorTools } from '../src/tools.ts'
import type { AdjustResult, SchemeResult } from '../src/tools.ts'

/**
 * ORACLE: test/oracle/anchors.py
 * Every numeric expectation in this file is printed by the in-repo oracle (an
 * independent Python implementation of the browser/WCAG/CSS rules; its `--check`
 * replays the published reference data). Never hand-edit an expectation: re-run
 * `python3 test/oracle/anchors.py` and copy the printed value.
 */

const tools = buildColorTools()
// rc.6 ToolDefinition.execute is typed (args, exec); tests call it directly with
// one argument, so cast to the single-argument signature (R14 lesson).
const executeScheme = tools.color_scheme.execute as (
  args: { input: string; type?: string; count?: number },
) => Promise<SchemeResult>
const executeAdjust = tools.adjust_color.execute as (
  args: { input: string; op: string; amount: number },
) => Promise<AdjustResult>

/**
 * Recursively assert that no object key anywhere in the tree holds
 * `undefined` — the dsh-tools output gate rejects such trees as
 * "not lossless JSON" (R7/R18 discipline: unit tests must encode this).
 */
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

async function scheme(input: string, type?: string, count?: number): Promise<SchemeResult> {
  // dsh-tools validates the arguments object for lossless JSON too: a live
  // `type: undefined` key is rejected before execute runs. Assign keys only
  // when defined (same discipline as result objects).
  const args: { input: string; type?: string; count?: number } = { input }
  if (type !== undefined) args.type = type
  if (count !== undefined) args.count = count
  const result = await executeScheme(args)
  assertNoUndefined(result)
  return result
}

async function adjust(input: string, op: string, amount: number): Promise<AdjustResult> {
  const result = await executeAdjust({ input, op, amount })
  assertNoUndefined(result)
  return result
}

function hexes(result: SchemeResult): string[] {
  return result.colors.map((c) => c.hex)
}

describe('color_scheme tool (anchors from test/oracle/anchors.py, round-half-up)', () => {
  it('complementary: red gets its exact opposite', async () => {
    const result = await scheme('#ff0000', 'complementary')
    expect(result.ok).toBe(true)
    expect(result.count).toBe(2)
    expect(hexes(result)).toEqual(['#ff0000', '#00ffff'])
  })

  it('triadic / tetradic / square rotations', async () => {
    expect(hexes(await scheme('#ff0000', 'triadic'))).toEqual(['#ff0000', '#00ff00', '#0000ff'])
    expect(hexes(await scheme('#ff0000', 'tetradic'))).toEqual(['#ff0000', '#ffff00', '#00ffff', '#0000ff'])
    expect(hexes(await scheme('#ff0000', 'square'))).toEqual(['#ff0000', '#80ff00', '#00ffff', '#8000ff'])
  })

  it('split-complementary lands at ±150°', async () => {
    expect(hexes(await scheme('#ff0000', 'split-complementary'))).toEqual(['#ff0000', '#00ff80', '#0080ff'])
  })

  it('analogous: 3 colors centered on the base, 5 with ±60', async () => {
    expect(hexes(await scheme('#ff0000', 'analogous'))).toEqual(['#ff0080', '#ff0000', '#ff8000'])
    expect(hexes(await scheme('#ff0000', 'analogous', 5))).toEqual(['#ff00ff', '#ff0080', '#ff0000', '#ff8000', '#ffff00'])
  })

  it('monochromatic: lightness steps across [l−0.4, l+0.4]', async () => {
    expect(hexes(await scheme('#ff0000', 'monochromatic', 5))).toEqual(['#330000', '#990000', '#ff0000', '#ff6666', '#ffcccc'])
  })

  it('monochromatic on a mid-tone blue, count 4', async () => {
    expect(hexes(await scheme('#336699', 'monochromatic', 4))).toEqual(['#030508', '#24476b', '#4f8ac4', '#b3cce6'])
  })

  it('keeps alpha in every color', async () => {
    const result = await scheme('rgba(255, 0, 0, 0.5)', 'complementary')
    expect(result.colors[1]?.hex).toBe('#00ffff80')
    expect(result.colors[1]?.rgb).toBe('rgba(0, 255, 255, 0.5)')
    expect(result.colors[1]?.hsl).toBe('hsla(180, 100%, 50%, 0.5)')
  })

  it('accepts named and hsl base colors', async () => {
    const fromName = await scheme('rebeccapurple', 'complementary')
    const fromHsl = await scheme('hsl(270, 50%, 40%)', 'complementary')
    expect(fromName.colors[0]?.hex).toBe('#663399')
    expect(fromHsl.colors[0]?.hex).toBe('#663399')
  })

  it('gray bases stay gray (no hue to rotate)', async () => {
    const result = await scheme('#808080', 'triadic')
    expect(hexes(result)).toEqual(['#808080', '#808080', '#808080'])
  })

  it('rejects invalid analogous counts', async () => {
    const result = await scheme('#ff0000', 'analogous', 4)
    expect(result.ok).toBe(false)
    expect(result.error).toContain('3 or 5')
  })

  it('monochromatic count is clamped to 2–9', async () => {
    expect((await scheme('#ff0000', 'monochromatic', 1)).count).toBe(2)
    expect((await scheme('#ff0000', 'monochromatic', 42)).count).toBe(9)
  })

  it('reports unparseable colors', async () => {
    const result = await scheme('octarine', 'triadic')
    expect(result.ok).toBe(false)
    expect(result.colors).toEqual([])
  })
})

describe('adjust_color tool (anchors from test/oracle/anchors.py, round-half-up)', () => {
  it('lightens and darkens in percentage points', async () => {
    expect((await adjust('#000000', 'lighten', 50)).hex).toBe('#808080')
    expect((await adjust('#ffffff', 'darken', 20)).hex).toBe('#cccccc')
    expect((await adjust('#ff0000', 'lighten', 50)).hex).toBe('#ffffff')
    expect((await adjust('#ff0000', 'darken', 50)).hex).toBe('#000000')
  })

  it('saturates and desaturates', async () => {
    expect((await adjust('#bf4040', 'saturate', 50)).hex).toBe('#ff0000')
    expect((await adjust('#ff0000', 'desaturate', 100)).hex).toBe('#808080')
  })

  it('rotates hue by degrees, negative allowed, wraps at 360', async () => {
    expect((await adjust('#ff0000', 'hue', 120)).hex).toBe('#00ff00')
    expect((await adjust('#ff0000', 'hue', -120)).hex).toBe('#0000ff')
    expect((await adjust('#ff0000', 'hue', 360)).hex).toBe('#ff0000')
    expect((await adjust('#ff0000', 'hue', -30)).hex).toBe('#ff0080')
  })

  it('saturating a gray is a no-op (CSS filter semantics)', async () => {
    expect((await adjust('#808080', 'saturate', 100)).hex).toBe('#808080')
  })

  it('works on mid-tone colors', async () => {
    expect((await adjust('#336699', 'lighten', 25)).hex).toBe('#79a6d2')
    expect((await adjust('#336699', 'darken', 30)).hex).toBe('#0d1a26')
    expect((await adjust('#336699', 'desaturate', 60)).hex).toBe('#666666')
  })

  it('clamps out-of-range amounts for saturation/lightness ops', async () => {
    expect((await adjust('#ff0000', 'lighten', 500)).hex).toBe('#ffffff')
    expect((await adjust('#ff0000', 'darken', -50)).hex).toBe('#ff0000')
  })

  it('keeps alpha through the adjustment', async () => {
    const result = await adjust('rgba(255, 0, 0, 0.5)', 'hue', 180)
    expect(result.hex).toBe('#00ffff80')
    expect(result.rgb).toBe('rgba(0, 255, 255, 0.5)')
  })

  it('reports unparseable colors', async () => {
    const result = await adjust('octarine', 'hue', 30)
    expect(result.ok).toBe(false)
    expect(result.hex).toBeUndefined()
  })
})

describe('harmonyHsl core (white-box invariants)', () => {
  it('base hue is always first for rotation harmonies', () => {
    const { h, s, l } = rgbToHsl(255, 0, 0)
    for (const type of ['complementary', 'triadic', 'split-complementary', 'tetradic', 'square'] as const) {
      const palette = harmonyHsl(h, s, l, type)
      expect(palette[0]?.h).toBeCloseTo(0, 9)
    }
  })

  it('all hues are normalized to [0, 360)', () => {
    const palette = harmonyHsl(350, 0.8, 0.5, 'analogous', 5)
    for (const t of palette) {
      expect(t.h).toBeGreaterThanOrEqual(0)
      expect(t.h).toBeLessThan(360)
    }
  })

  it('analogous offsets are centered on the base', () => {
    const three = harmonyHsl(200, 0.8, 0.5, 'analogous')
    expect(three.map((t) => t.h)).toEqual([170, 200, 230])
    const five = harmonyHsl(200, 0.8, 0.5, 'analogous', 5)
    expect(five.map((t) => t.h)).toEqual([140, 170, 200, 230, 260])
  })

  it('monochromatic keeps hue/saturation, only lightness varies', () => {
    const palette = harmonyHsl(210, 0.5, 0.4, 'monochromatic', 6)
    for (const t of palette) {
      expect(t.h).toBeCloseTo(210, 9)
      expect(t.s).toBeCloseTo(0.5, 9)
    }
    expect(palette[0]?.l).toBeCloseTo(0.02, 9)
    expect(palette[5]?.l).toBeCloseTo(0.8, 9)
  })
})

describe('adjustHsl core (white-box invariants)', () => {
  it('lighten/darken are exact inverses within bounds', () => {
    const up = adjustHsl(210, 0.5, 0.4, 'lighten', 30)
    const down = adjustHsl(up.h, up.s, up.l, 'darken', 30)
    expect(down.l).toBeCloseTo(0.4, 9)
  })

  it('desaturate to 0 removes all hue dependence', () => {
    const flat = adjustHsl(123, 0.9, 0.6, 'desaturate', 100)
    expect(flat.s).toBe(0)
  })

  it('hue op normalizes negative and oversized amounts', () => {
    expect(adjustHsl(10, 1, 0.5, 'hue', -30).h).toBeCloseTo(340, 9)
    expect(adjustHsl(350, 1, 0.5, 'hue', 400).h).toBeCloseTo(30, 9)
  })
})
