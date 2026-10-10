import { describe, expect, it } from 'vitest'
import {

/**
 * ORACLE: test/oracle/anchors.py
 * Every numeric expectation in this file is printed by the in-repo oracle (an
 * independent Python implementation of the browser/WCAG/CSS rules; its `--check`
 * replays the published reference data). Never hand-edit an expectation: re-run
 * `python3 test/oracle/anchors.py` and copy the printed value.
 */
  contrastRatio,
  hslToRgb,
  hwbToRgb,
  parseHex,
  parseColorInput,
  relativeLuminance,
  rgbaToHex,
  rgbaToHslString,
  rgbaToHwbString,
  rgbaToRgbString,
  rgbToHsl,
  wcagLevel,
} from '../src/color.ts'

const NAMED: (name: string) => string | undefined = (name) =>
  ({ rebeccapurple: '663399', tomato: 'ff6347', white: 'ffffff', black: '000000' })[name]

function parse(input: string) {
  const result = parseColorInput(input, NAMED)
  if (!result.ok) throw new Error(`parse failed: ${result.error}`)
  return result.color.rgba
}

describe('parseColorInput', () => {
  it('parses hex shorthand and full forms', () => {
    expect(parse('#f00')).toEqual({ r: 255, g: 0, b: 0, a: 1 })
    expect(parse('#ff0000')).toEqual({ r: 255, g: 0, b: 0, a: 1 })
    expect(parse('#FF0000')).toEqual({ r: 255, g: 0, b: 0, a: 1 })
    expect(parse('#0000ff80')).toEqual({ r: 0, g: 0, b: 255, a: 128 / 255 })
    expect(parse('#f008')).toEqual({ r: 255, g: 0, b: 0, a: 136 / 255 })
  })

  it('parses rgb() with commas, spaces, percentages and alpha', () => {
    expect(parse('rgb(255, 0, 0)')).toEqual({ r: 255, g: 0, b: 0, a: 1 })
    expect(parse('rgb(255 0 0)')).toEqual({ r: 255, g: 0, b: 0, a: 1 })
    expect(parse('rgb(100%, 0%, 0%)')).toEqual({ r: 255, g: 0, b: 0, a: 1 })
    expect(parse('rgba(0, 0, 255, 0.5)')).toEqual({ r: 0, g: 0, b: 255, a: 0.5 })
    expect(parse('rgb(255 0 0 / 50%)')).toEqual({ r: 255, g: 0, b: 0, a: 0.5 })
    expect(parse('rgb(300, 0, 0)')).toEqual({ r: 255, g: 0, b: 0, a: 1 }) // clamped
  })

  // R42 regression. The old parser multiplied every bare rgb() channel by 255,
  // which is invisible for 0/255 and catastrophic in between: rgb(51, 102, 153)
  // used to come back as #ffffff. Percentages stay shares of 255.
  it('keeps mid-range rgb() numbers on the 0–255 scale', () => {
    expect(parse('rgb(51, 102, 153)')).toEqual({ r: 51, g: 102, b: 153, a: 1 })
    expect(parse('rgb(0 128 0)')).toEqual({ r: 0, g: 128, b: 0, a: 1 })
    expect(parse('rgba(18, 52, 86, 0.25)')).toEqual({ r: 18, g: 52, b: 86, a: 0.25 })
    expect(parse('rgb(20%, 40%, 60%)')).toEqual({ r: 51, g: 102, b: 153, a: 1 })
  })

  // R42 regression: CSS Color 4 reads a bare number in s/l/w/b exactly like a
  // percentage, so hsl(210 100 50) must equal hsl(210, 100%, 50%).
  it('treats bare numbers in hsl()/hwb() as percentages', () => {
    expect(parse('hsl(120 100 25)')).toEqual(parse('hsl(120, 100%, 25%)'))
    expect(parse('hsl(210 100 50)')).toEqual(parse('hsl(210, 100%, 50%)'))
    expect(parse('hwb(0 40 40)')).toEqual(parse('hwb(0 40% 40%)'))
  })

  it('parses hsl() with angle units', () => {
    expect(parse('hsl(0, 100%, 50%)')).toEqual({ r: 255, g: 0, b: 0, a: 1 })
    expect(parse('hsl(120deg, 100%, 25%)')).toEqual({ r: 0, g: 127.5, b: 0, a: 1 })
    expect(parse('hsl(0.5turn, 100%, 50%)')).toEqual({ r: 0, g: 255, b: 255, a: 1 })
    expect(parse('hsla(240, 100%, 50%, 0.25)')).toEqual({ r: 0, g: 0, b: 255, a: 0.25 })
    expect(parse('hsl(-120, 100%, 50%)')).toEqual({ r: 0, g: 0, b: 255, a: 1 }) // negative → 240
  })

  it('parses hwb()', () => {
    expect(parse('hwb(0 0% 0%)')).toEqual({ r: 255, g: 0, b: 0, a: 1 })
    expect(parse('hwb(0 100% 0%)')).toEqual({ r: 255, g: 255, b: 255, a: 1 })
    expect(parse('hwb(0 0% 100%)')).toEqual({ r: 0, g: 0, b: 0, a: 1 })
    expect(parse('hwb(120 0% 0% / 0.5)')).toEqual({ r: 0, g: 255, b: 0, a: 0.5 })
    expect(parse('hwb(0 40% 40%)')).toEqual({ r: 153, g: 102, b: 102, a: 1 }) // w+b=80% → tinted gray
    expect(parse('hwb(0 40% 60%)')).toEqual({ r: 102, g: 102, b: 102, a: 1 }) // w+b=100% → gray
  })

  it('parses named colors and transparent', () => {
    expect(parse('rebeccapurple')).toEqual({ r: 102, g: 51, b: 153, a: 1 })
    expect(parse('REBECCAPURPLE')).toEqual({ r: 102, g: 51, b: 153, a: 1 })
    expect(parse('transparent')).toEqual({ r: 0, g: 0, b: 0, a: 0 })
  })

  it('rejects garbage', () => {
    expect(parseColorInput('', NAMED).ok).toBe(false)
    expect(parseColorInput('not-a-color', NAMED).ok).toBe(false)
    expect(parseColorInput('#12345', NAMED).ok).toBe(false)
    expect(parseColorInput('rgb(1, 2)', NAMED).ok).toBe(false)
    expect(parseColorInput('hsl(0, 100%)', NAMED).ok).toBe(false)
  })
})

describe('parseHex', () => {
  it('expands 3/4-digit forms', () => {
    expect(parseHex('#abc')).toEqual({ r: 170, g: 187, b: 204, a: 1 })
    expect(parseHex('#abcd')).toEqual({ r: 170, g: 187, b: 204, a: 221 / 255 })
  })
})

describe('formatting', () => {
  it('renders hex with alpha when needed', () => {
    expect(rgbaToHex({ r: 255, g: 0, b: 0, a: 1 })).toBe('#ff0000')
    expect(rgbaToHex({ r: 255, g: 0, b: 0, a: 0.5 })).toBe('#ff000080')
    expect(rgbaToHex({ r: 102, g: 51, b: 153, a: 1 })).toBe('#663399')
  })

  it('renders rgb/rgba strings', () => {
    expect(rgbaToRgbString({ r: 255, g: 0, b: 0, a: 1 })).toBe('rgb(255, 0, 0)')
    expect(rgbaToRgbString({ r: 0, g: 0, b: 255, a: 0.5 })).toBe('rgba(0, 0, 255, 0.5)')
  })

  it('renders hsl strings with rounded channels', () => {
    expect(rgbaToHslString({ r: 255, g: 0, b: 0, a: 1 })).toBe('hsl(0, 100%, 50%)')
    expect(rgbaToHslString({ r: 0, g: 128, b: 0, a: 1 })).toBe('hsl(120, 100%, 25.1%)')
    expect(rgbaToHslString({ r: 0, g: 0, b: 255, a: 0.25 })).toBe('hsla(240, 100%, 50%, 0.25)')
  })

  it('renders hwb strings', () => {
    expect(rgbaToHwbString({ r: 255, g: 0, b: 0, a: 1 })).toBe('hwb(0 0% 0%)')
    expect(rgbaToHwbString({ r: 0, g: 255, b: 0, a: 0.5 })).toBe('hwb(120 0% 0% / 0.5)')
  })
})

describe('round trips', () => {
  it('hex → hsl → hex stays stable', () => {
    const original = parse('#ff7f50')
    const { h, s, l } = rgbToHsl(original.r, original.g, original.b)
    const back = hslToRgb(h, s, l)
    const hex = rgbaToHex({ r: back.r, g: back.g, b: back.b, a: 1 })
    expect(hex).toBe('#ff7f50')
  })

  it('hwb → rgb matches the CSS definition', () => {
    expect(hwbToRgb(0, 0.2, 0.3)).toEqual({ r: 178.5, g: 51, b: 51 })
  })

  it('rgbToHsl anchors', () => {
    expect(rgbToHsl(255, 0, 0)).toEqual({ h: 0, s: 1, l: 0.5 })
    expect(rgbToHsl(0, 255, 0)).toEqual({ h: 120, s: 1, l: 0.5 })
    expect(rgbToHsl(0, 0, 255)).toEqual({ h: 240, s: 1, l: 0.5 })
    expect(rgbToHsl(128, 128, 128)).toEqual({ h: 0, s: 0, l: 0.5019607843137255 })
    expect(rgbToHsl(255, 255, 255)).toEqual({ h: 0, s: 0, l: 1 })
  })
})

describe('WCAG contrast', () => {
  it('black vs white is 21:1', () => {
    expect(contrastRatio(parse('#000000'), parse('#ffffff'))).toBeCloseTo(21, 5)
  })

  it('same colors are 1:1', () => {
    expect(contrastRatio(parse('#123456'), parse('#123456'))).toBeCloseTo(1, 5)
  })

  it('#777777 on white is ~4.48:1 (fails AA normal, passes large)', () => {
    const ratio = contrastRatio(parse('#777777'), parse('#ffffff'))
    expect(ratio).toBeCloseTo(4.48, 2)
    expect(wcagLevel(ratio, false)).toBe('fail')
    expect(wcagLevel(ratio, true)).toBe('AA')
  })

  it('red on white is ~4.0:1', () => {
    expect(contrastRatio(parse('#ff0000'), parse('#ffffff'))).toBeCloseTo(4.0, 2)
  })

  it('luminance anchors', () => {
    expect(relativeLuminance(parse('#ffffff'))).toBeCloseTo(1, 5)
    expect(relativeLuminance(parse('#000000'))).toBeCloseTo(0, 5)
    // Pure red: linearized 1.0 * 0.2126
    expect(relativeLuminance(parse('#ff0000'))).toBeCloseTo(0.2126, 4)
  })

  it('level thresholds (WCAG 1.4.3)', () => {
    expect(wcagLevel(4.5, false)).toBe('AA')
    expect(wcagLevel(7, false)).toBe('AAA')
    expect(wcagLevel(3, true)).toBe('AA')
    expect(wcagLevel(4.5, true)).toBe('AAA')
    expect(wcagLevel(4.49, false)).toBe('fail')
  })

  it('is symmetric', () => {
    const a = contrastRatio(parse('#ffffff'), parse('#000000'))
    const b = contrastRatio(parse('#000000'), parse('#ffffff'))
    expect(a).toBeCloseTo(b, 10)
  })
})
