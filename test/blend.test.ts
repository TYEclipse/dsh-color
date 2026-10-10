import { describe, expect, it } from 'vitest'
import { blendMix, blendOver, contrastRatio, ensureContrast, parseColorInput, rgbToHsl } from '../src/color.ts'
import { buildColorTools } from '../src/tools.ts'
import type { BlendResult, EnsureContrastResult } from '../src/tools.ts'
import { lookupNamed } from '../src/named.ts'

/**
 * ORACLE: test/oracle/anchors.py
 * Every numeric expectation in this file is printed by the in-repo oracle (an
 * independent Python implementation of the browser/WCAG/CSS rules; its `--check`
 * replays the published reference data). Never hand-edit an expectation: re-run
 * `python3 test/oracle/anchors.py` and copy the printed value.
 */

const tools = buildColorTools()
const executeBlend = tools.blend_colors.execute as (args: {
  foreground: string
  background: string
  mode?: string
  weight?: number
}) => Promise<BlendResult>
const executeEnsure = tools.ensure_contrast.execute as (args: {
  foreground: string
  background: string
  level?: string
  largeText?: boolean
  direction?: string
}) => Promise<EnsureContrastResult>

/**
 * Every expected value in this file comes from the in-repo oracle
 * (`test/oracle/anchors.py`, sections C–E, R42/R66), an independent Python
 * implementation written from the specs (CSS Compositing §9.1, CSS Color 4
 * color-mix, WCAG 2.x) — never from the TypeScript source. If a value here
 * changes, re-run the oracle before touching the expectation.
 */

/** Recursively assert no key anywhere holds `undefined` (lossless-JSON gate, R7/R18). */
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

async function blend(
  foreground: string,
  background: string,
  extra: { mode?: string; weight?: number } = {},
): Promise<BlendResult> {
  const args: { foreground: string; background: string; mode?: string; weight?: number } = { foreground, background }
  if (extra.mode !== undefined) args.mode = extra.mode
  if (extra.weight !== undefined) args.weight = extra.weight
  const result = await executeBlend(args)
  assertNoUndefined(result)
  return result
}

async function ensure(
  foreground: string,
  background: string,
  extra: { level?: string; largeText?: boolean; direction?: string } = {},
): Promise<EnsureContrastResult> {
  const args: { foreground: string; background: string; level?: string; largeText?: boolean; direction?: string } = {
    foreground,
    background,
  }
  if (extra.level !== undefined) args.level = extra.level
  if (extra.largeText !== undefined) args.largeText = extra.largeText
  if (extra.direction !== undefined) args.direction = extra.direction
  const result = await executeEnsure(args)
  assertNoUndefined(result)
  return result
}

describe('blendOver (source-over compositing)', () => {
  const rgba = (input: string) => {
    const parsed = parseColorInput(input, lookupNamed)
    if (!parsed.ok) throw new Error(parsed.error)
    return parsed.color.rgba
  }

  it('half-transparent red over white keeps the backdrop contribution', () => {
    const out = blendOver(rgba('rgba(255, 0, 0, 0.5)'), rgba('#ffffff'))
    expect(out).toEqual({ r: 255, g: 127.5, b: 127.5, a: 1 })
  })

  it('translucent over translucent accumulates alpha (0.5 over 0.5 = 0.75)', () => {
    const out = blendOver(rgba('rgba(0, 0, 255, 0.5)'), rgba('rgba(0, 0, 0, 0.5)'))
    expect(out.a).toBeCloseTo(0.75, 12)
    // premultiplied divide-back: 255 * 0.5 / 0.75 = 170 exactly
    expect(out.b).toBeCloseTo(170, 12)
  })

  it('fully transparent source vanishes; two transparents collapse to zero alpha', () => {
    const out = blendOver(rgba('transparent'), rgba('#336699'))
    expect(out.r).toBeCloseTo(51, 12)
    expect(out.a).toBeCloseTo(1, 12)
    const nothing = blendOver(rgba('transparent'), rgba('transparent'))
    expect(nothing).toEqual({ r: 0, g: 0, b: 0, a: 0 })
  })
})

describe('blend_colors tool', () => {
  it('over: rgba(255,0,0,0.5) on white renders #ff8080', async () => {
    const result = await blend('rgba(255, 0, 0, 0.5)', '#ffffff')
    expect(result.ok).toBe(true)
    expect(result.mode).toBe('over')
    expect(result.hex).toBe('#ff8080')
    expect(result.rgb).toBe('rgb(255, 128, 128)')
    expect(result.alpha).toBe(1)
    // "over" carries no weight in the result
    expect(result.weight).toBeUndefined()
  })

  it('over: translucent on translucent keeps the accumulated alpha in hex', async () => {
    const result = await blend('rgba(0, 0, 255, 0.5)', 'rgba(0, 0, 0, 0.5)')
    expect(result.hex).toBe('#0000aabf')
    expect(result.rgb).toBe('rgba(0, 0, 170, 0.75)')
    expect(result.alpha).toBe(0.75)
  })

  it('over: 25% green over #336699', async () => {
    const result = await blend('rgba(0, 128, 0, 0.25)', '#336699')
    expect(result.hex).toBe('#266d73')
    expect(result.rgb).toBe('rgb(38, 109, 115)')
  })

  it('over: an opaque source replaces the backdrop', async () => {
    const result = await blend('#000000', '#ffffff')
    expect(result.hex).toBe('#000000')
    expect(result.alpha).toBe(1)
  })

  it('mix: red + blue at 0.5 is purple, alpha-aware', async () => {
    const half = await blend('#ff0000', '#0000ff', { mode: 'mix', weight: 0.5 })
    expect(half.hex).toBe('#800080')
    expect(half.rgb).toBe('rgb(128, 0, 128)')
    expect(half.weight).toBe(0.5)

    const quarter = await blend('#ff0000', '#0000ff', { mode: 'mix', weight: 0.25 })
    expect(quarter.hex).toBe('#bf0040')
    expect(quarter.rgb).toBe('rgb(191, 0, 64)')
  })

  it('mix: premultiplied interpolation of a translucent first color', async () => {
    const result = await blend('rgba(255, 0, 0, 0.5)', '#0000ff', { mode: 'mix' })
    expect(result.hex).toBe('#5500aabf')
    expect(result.rgb).toBe('rgba(85, 0, 170, 0.75)')
    expect(result.weight).toBe(0.5)
  })

  it('mix: tints toward white without leaving sRGB', async () => {
    const result = await blend('#336699', '#ffffff', { mode: 'mix', weight: 0.8 })
    expect(result.hex).toBe('#d6e0eb')
    expect(result.rgb).toBe('rgb(214, 224, 235)')
  })

  it('clamps out-of-range weights instead of extrapolating', async () => {
    const over = await blend('#ff0000', '#0000ff', { mode: 'mix', weight: 1.5 })
    expect(over.hex).toBe('#0000ff')
    const under = await blend('#ff0000', '#0000ff', { mode: 'mix', weight: -1 })
    expect(under.hex).toBe('#ff0000')
  })

  it('rejects unknown modes at the schema layer (no silent fallback)', async () => {
    await expect(executeBlend({ foreground: '#ffffff', background: '#000000', mode: 'multiply' })).rejects
      .toThrow(/must be one of/)
    const result = await blend('rgba(255, 0, 0, 0.5)', '#ffffff')
    expect(result.mode).toBe('over')
  })

  it('reports which operand failed to parse', async () => {
    const badTop = await blend('octarine', '#ffffff')
    expect(badTop.ok).toBe(false)
    expect(badTop.error).toContain('foreground')
    const badBottom = await blend('#ffffff', 'octarine')
    expect(badBottom.ok).toBe(false)
    expect(badBottom.error).toContain('background')
  })

  it('round-trips hsl output back to the same color (within 1-decimal rounding)', async () => {
    const result = await blend('rgba(0, 0, 255, 0.5)', 'rgba(0, 0, 0, 0.5)')
    const reparsed = parseColorInput(result.hsl ?? '', lookupNamed)
    expect(reparsed.ok).toBe(true)
    if (reparsed.ok) {
      expect(Math.abs(reparsed.color.rgba.b - 170)).toBeLessThan(1)
      expect(Math.abs(reparsed.color.rgba.a - 0.75)).toBeLessThan(0.01)
    }
  })
})

describe('ensure_contrast tool', () => {
  it('#777777 on white misses AA by a hair and darkens to #767676', async () => {
    const result = await ensure('#777777', '#ffffff')
    expect(result.ok).toBe(true)
    expect(result.changed).toBe(true)
    expect(result.direction).toBe('darken')
    expect(result.target).toBe(4.5)
    expect(result.inputRatio).toBe(4.48)
    expect(result.hex).toBe('#767676')
    expect(result.ratio).toBe(4.54)
    expect(result.lightnessShift).toBe(-0.2)
  })

  it('leaves a color that already passes untouched', async () => {
    const barely = await ensure('#767676', '#ffffff')
    expect(barely.ok).toBe(true)
    expect(barely.changed).toBe(false)
    expect(barely.hex).toBe('#767676')
    expect(barely.ratio).toBe(4.54)
    expect(barely.lightnessShift).toBe(0)

    const strong = await ensure('#ffffff', '#000000')
    expect(strong.changed).toBe(false)
    expect(strong.ratio).toBe(21)
  })

  it('lightens dark text on a dark background for AAA', async () => {
    const result = await ensure('#555555', '#000000', { level: 'AAA' })
    expect(result.direction).toBe('lighten')
    expect(result.hex).toBe('#959595')
    expect(result.ratio).toBe(7.01)
    expect(result.lightnessShift).toBe(24.9)
  })

  it('large text lowers the target: orange passes AA-large with a smaller shift', async () => {
    const normal = await ensure('#ff9900', '#ffffff')
    expect(normal.hex).toBe('#ab6600')
    expect(normal.ratio).toBe(4.53)
    expect(normal.lightnessShift).toBe(-16.5)

    const large = await ensure('#ff9900', '#ffffff', { largeText: true })
    expect(large.target).toBe(3)
    expect(large.hex).toBe('#d68100')
    expect(large.ratio).toBe(3)
    expect(large.lightnessShift).toBe(-7.94)
  })

  it('AAA-large asks for 4.5 — the same as AA normal', async () => {
    const result = await ensure('#ff9900', '#ffffff', { level: 'AAA', largeText: true })
    expect(result.target).toBe(4.5)
    expect(result.hex).toBe('#ab6600')
  })

  it('reports the best achievable color when the target is impossible', async () => {
    const result = await ensure('#8080ff', '#808080', { level: 'AAA' })
    expect(result.ok).toBe(false)
    expect(result.error).toContain('unreachable')
    expect(result.bestHex).toBe('#000000')
    expect(result.bestRatio).toBe(5.32)
    expect(result.direction).toBe('darken')
    expect(result.inputRatio).toBe(1.21)
    expect(result.hex).toBeUndefined()
  })

  it('honors a forced direction even when the other one would go further', async () => {
    const darken = await ensure('#336699', '#ffffff', { level: 'AAA', direction: 'darken' })
    expect(darken.hex).toBe('#2e5b89')
    expect(darken.ratio).toBe(7.06)
    expect(darken.lightnessShift).toBe(-4.12)

    // lighten cannot help a color that already passes: nothing to do
    const lighten = await ensure('#336699', '#ffffff', { direction: 'lighten' })
    expect(lighten.changed).toBe(false)
    expect(lighten.hex).toBe('#336699')
  })

  it('preserves hue and saturation while moving lightness', async () => {
    const result = await ensure('#ff9900', '#ffffff')
    const before = parseColorInput('#ff9900', lookupNamed)
    const after = parseColorInput(result.hex ?? '', lookupNamed)
    expect(before.ok && after.ok).toBe(true)
    if (before.ok && after.ok) {
      const b = before.color.rgba
      const a = after.color.rgba
      const hslBefore = rgbToHsl(b.r, b.g, b.b)
      const hslAfter = rgbToHsl(a.r, a.g, a.b)
      expect(Math.abs(hslAfter.h - hslBefore.h)).toBeLessThan(1)
      expect(Math.abs(hslAfter.s - hslBefore.s)).toBeLessThan(0.01)
      expect(hslAfter.l).toBeLessThan(hslBefore.l)
    }
  })

  it('defaults to AA/normal and reports the resolved direction for auto', async () => {
    const result = await ensure('#ff9900', '#ffffff', { direction: 'auto' })
    expect(result.level).toBe('AA')
    expect(result.largeText).toBe(false)
    expect(result.direction).toBe('darken')

    const dark = await ensure('#336699', '#111111', { direction: 'auto' })
    expect(dark.direction).toBe('lighten')
  })

  it('rejects unknown enum values at the schema layer (no silent fallback)', async () => {
    await expect(executeEnsure({ foreground: '#ff9900', background: '#ffffff', level: 'BB' })).rejects
      .toThrow(/must be one of/)
    await expect(executeEnsure({ foreground: '#ff9900', background: '#ffffff', direction: 'sideways' })).rejects
      .toThrow(/must be one of/)
    const defaults = await ensure('#ff9900', '#ffffff')
    expect(defaults.level).toBe('AA')
    expect(defaults.target).toBe(4.5)
    expect(defaults.largeText).toBe(false)
  })

  it('reports parse failures for either operand', async () => {
    const badTop = await ensure('octarine', '#ffffff')
    expect(badTop.ok).toBe(false)
    expect(badTop.error).toContain('foreground')
    const badBottom = await ensure('#ffffff', 'octarine')
    expect(badBottom.error).toContain('background')
  })
})

describe('ensureContrast (core math)', () => {
  const rgba = (input: string) => {
    const parsed = parseColorInput(input, lookupNamed)
    if (!parsed.ok) throw new Error(parsed.error)
    return parsed.color.rgba
  }

  it('is deterministic across repeated calls', () => {
    const first = ensureContrast(rgba('#777777'), rgba('#ffffff'), 4.5)
    const second = ensureContrast(rgba('#777777'), rgba('#ffffff'), 4.5)
    expect(first).toEqual(second)
    expect(first.rgba?.r).toBe(0x76)
  })

  it('moves as little as possible: one 8-bit step lighter fails, the returned one passes', () => {
    const fix = ensureContrast(rgba('#777777'), rgba('#ffffff'), 4.5)
    expect(fix.rgba?.r).toBe(0x76)
    const stepDown = { r: 0x76, g: 0x76, b: 0x76, a: 1 }
    const stepUp = { r: 0x77, g: 0x77, b: 0x77, a: 1 }
    expect(contrastRatio(stepDown, rgba('#ffffff'))).toBeGreaterThanOrEqual(4.5)
    expect(contrastRatio(stepUp, rgba('#ffffff'))).toBeLessThan(4.5)
    expect(fix.ratio).toBeCloseTo(contrastRatio(stepDown, rgba('#ffffff')), 12)
  })

  it('keeps the input alpha on the repaired color', () => {
    const fix = ensureContrast(rgba('rgba(119, 119, 119, 0.5)'), rgba('#ffffff'), 4.5)
    expect(fix.rgba?.a).toBe(0.5)
  })

  it('mix/over keep working when blend weights are exactly at the bounds', () => {
    expect(blendMix(rgba('#ff0000'), rgba('#0000ff'), 0).r).toBeCloseTo(255, 9)
    expect(blendMix(rgba('#ff0000'), rgba('#0000ff'), 1).b).toBeCloseTo(255, 9)
  })
})

describe('renderers (text the agent actually sees)', () => {
  const text = (block: unknown): string => (block as { text: string }[])[0]?.text ?? ''

  it('renders an "over" result and a "mix" result', async () => {
    const over = await blend('rgba(255, 0, 0, 0.5)', '#ffffff')
    const overText = text(tools.blend_colors.output.render({ foreground: 'rgba(255, 0, 0, 0.5)', background: '#ffffff' }, over))
    expect(overText).toContain('over #ffffff =')
    expect(overText).toContain('#ff8080')
    expect(overText).not.toContain('alpha')

    const mixed = await blend('rgba(0, 0, 255, 0.5)', 'rgba(0, 0, 0, 0.5)', { mode: 'mix' })
    const mixText = text(tools.blend_colors.output.render({ foreground: 'x', background: 'y', mode: 'mix' }, mixed))
    expect(mixText).toContain('mix 0.5')
    expect(mixText).toContain('alpha 0.5')
  })

  it('renders blend failures and tolerates a result without a weight', () => {
    const failed = text(tools.blend_colors.output.render({ foreground: 'x', background: 'y' }, { ok: false, error: 'nope' }))
    expect(failed).toBe('blend_colors: nope')
    const bare = text(tools.blend_colors.output.render(
      { foreground: '#ff0000', background: '#0000ff' },
      { ok: true, foreground: '#ff0000', background: '#0000ff', mode: 'mix' } as BlendResult,
    ))
    expect(bare).toContain('mix 0.5')
  })

  it('renders the changed, unchanged, unreachable and failed ensure_contrast cases', async () => {
    const changed = await ensure('#777777', '#ffffff')
    const changedText = text(tools.ensure_contrast.output.render({ foreground: '#777777', background: '#ffffff' }, changed))
    expect(changedText).toContain('#767676')
    expect(changedText).toContain('darken')
    expect(changedText).toContain('pp)')

    const unchanged = await ensure('#767676', '#ffffff')
    const unchangedText = text(tools.ensure_contrast.output.render({ foreground: '#767676', background: '#ffffff' }, unchanged))
    expect(unchangedText).toContain('no change needed')

    const unreachable = await ensure('#8080ff', '#808080', { level: 'AAA' })
    const unreachableText = text(
      tools.ensure_contrast.output.render({ foreground: '#8080ff', background: '#808080', level: 'AAA' }, unreachable),
    )
    expect(unreachableText).toContain('best #000000 at 5.32:1')

    const failed = text(tools.ensure_contrast.output.render(
      { foreground: 'x', background: 'y' },
      { ok: false, error: 'bad color', foreground: 'x', background: 'y', level: 'AA', largeText: false, target: 4.5, direction: 'auto' },
    ))
    expect(failed).toBe('ensure_contrast: bad color')
  })
})
