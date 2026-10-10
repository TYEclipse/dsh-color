/**
 * Core color math for dsh-color: CSS color parsing, format conversion and
 * WCAG contrast evaluation. Pure functions, no I/O, zero dependencies.
 *
 * All internal channels are floats: r/g/b in [0, 255], h in degrees
 * [0, 360), s/l/w/b in [0, 1] (percent fractions), alpha in [0, 1].
 *
 * @module dsh-color/color
 */

/** RGBA color with channels in [0, 255] and alpha in [0, 1]. */
export interface Rgba {
  r: number
  g: number
  b: number
  a: number
}

/** Parsed representation of a CSS color input. */
export interface ParsedColor {
  /** The format family the input was written in (named colors count as 'name'). */
  format: 'hex' | 'rgb' | 'hsl' | 'hwb' | 'name'
  /** CSS color name if the input was a named color (or 'transparent'). */
  name?: string
  /** Normalized RGBA channels. */
  rgba: Rgba
}

export type ParseResult = { ok: true; color: ParsedColor } | { ok: false; error: string }

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

const HEX_RE = /^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/
const FUNCTION_RE = /^(rgba?|hsla?|hwb)\(([\s\S]*)\)$/

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

/** Parse a numeric channel token: number, percentage, or angle with unit. */
function parseChannel(token: string): number | undefined {
  const trimmed = token.trim()
  if (trimmed === '') return undefined
  const value = Number.parseFloat(trimmed)
  if (!Number.isFinite(value)) return undefined
  if (trimmed.endsWith('%')) return value / 100
  return value
}

/**
 * rgb() channel: a percentage is a share of 255 (`50%` → 127.5) while a bare
 * number is already on the 0–255 scale, because CSS Color 4 lets `rgb(51 102 153)`
 * mean #336699. The two scales must not be confused: multiplying a bare number
 * by 255 turned every mid-range `rgb(...)` input into pure 255 (fixed in R42 —
 * the old tests only ever used 0 and 255 channels, where clamping hid it).
 */
function parseRgbChannel(token: string): number | undefined {
  const value = parseChannel(token)
  if (value === undefined) return undefined
  return token.trim().endsWith('%') ? value * 255 : value
}

/**
 * hsl()/hwb() percentage channel as a 0–1 fraction: `50%` and the bare number
 * `50` both mean 50% (CSS Color 4 interprets a number in s/l/w/b exactly like a
 * percentage), so `hsl(210 100 50)` is the same as `hsl(210, 100%, 50%)`.
 */
function parsePercentChannel(token: string): number | undefined {
  const value = parseChannel(token)
  if (value === undefined) return undefined
  return token.trim().endsWith('%') ? value : value / 100
}

/** Parse an angle token into degrees (deg | rad | grad | turn | unitless). */
function parseAngle(token: string): number | undefined {
  const trimmed = token.trim()
  if (trimmed === '') return undefined
  const match = /^(-?\d*\.?\d+)(deg|rad|grad|turn)?$/.exec(trimmed)
  if (match === null) return undefined
  const value = Number.parseFloat(match[1] ?? '')
  if (!Number.isFinite(value)) return undefined
  const unit = match[2]
  switch (unit) {
    case 'rad':
      return (value * 180) / Math.PI
    case 'grad':
      return value * 0.9
    case 'turn':
      return value * 360
    default:
      return value
  }
}

/** Normalize an angle to [0, 360). */
function normalizeHue(degrees: number): number {
  const mod = degrees % 360
  return mod < 0 ? mod + 360 : mod
}

/** Parse a hex string (#rgb/#rgba/#rrggbb/#rrggbbaa) into RGBA. */
export function parseHex(input: string): Rgba | undefined {
  const match = HEX_RE.exec(input.trim().toLowerCase())
  if (match === null) return undefined
  const digits = match[1] ?? ''
  let r = ''
  let g = ''
  let b = ''
  let a = 'ff'
  if (digits.length === 3 || digits.length === 4) {
    r = digits.slice(0, 1) + digits.slice(0, 1)
    g = digits.slice(1, 2) + digits.slice(1, 2)
    b = digits.slice(2, 3) + digits.slice(2, 3)
    if (digits.length === 4) a = digits.slice(3, 4) + digits.slice(3, 4)
  } else {
    r = digits.slice(0, 2)
    g = digits.slice(2, 4)
    b = digits.slice(4, 6)
    if (digits.length === 8) a = digits.slice(6, 8)
  }
  const to255 = (hex: string): number => Number.parseInt(hex, 16)
  return { r: to255(r), g: to255(g), b: to255(b), a: to255(a) / 255 }
}

/**
 * Parse a functional color — rgb()/rgba(), hsl()/hsla(), hwb() — supporting
 * both legacy comma syntax and modern space syntax (rgb(255 0 0 / 0.5)).
 */
export function parseFunctional(input: string): Rgba | undefined {
  const match = FUNCTION_RE.exec(input.trim().toLowerCase())
  if (match === null) return undefined
  const fn = match[1] ?? ''
  const body = match[2] ?? ''
  const kind = fn.startsWith('rgb') ? 'rgb' : fn.startsWith('hsl') ? 'hsl' : 'hwb'

  // Split off the optional alpha component after '/'.
  const slashParts = body.split('/')
  if (slashParts.length > 2) return undefined
  const channelText = slashParts[0] ?? ''
  const alphaText = slashParts[1]

  const tokens = channelText.split(/[\s,]+/).filter((t) => t !== '')
  const isComma = channelText.includes(',')
  if (tokens.length !== 3 && tokens.length !== 4) return undefined
  // Legacy comma syntax carries alpha as a 4th token (rgba(0, 0, 0, 0.5)).
  const legacyAlpha = isComma && tokens.length === 4 ? tokens[3] : undefined
  if (legacyAlpha !== undefined && alphaText !== undefined) return undefined
  const alpha = alphaText ?? legacyAlpha

  if (kind === 'rgb') {
    const r = parseRgbChannel(tokens[0] ?? '')
    const g = parseRgbChannel(tokens[1] ?? '')
    const b = parseRgbChannel(tokens[2] ?? '')
    if (r === undefined || g === undefined || b === undefined) return undefined
    return {
      r: clamp(r, 0, 255),
      g: clamp(g, 0, 255),
      b: clamp(b, 0, 255),
      a: parseAlpha(alpha),
    }
  }

  const h = parseAngle(tokens[0] ?? '')
  const s = parsePercentChannel(tokens[1] ?? '')
  const l = parsePercentChannel(tokens[2] ?? '')
  if (h === undefined || s === undefined || l === undefined) return undefined

  if (kind === 'hsl') {
    const rgb = hslToRgb(normalizeHue(h), clamp(s, 0, 1), clamp(l, 0, 1))
    return { r: rgb.r, g: rgb.g, b: rgb.b, a: parseAlpha(alpha) }
  }

  // hwb: w and b are fractions of 0–100% (CSS requires percentages, but bare
  // numbers are accepted leniently and treated as percentages).
  const w = parsePercentChannel(tokens[1] ?? '')
  const b = parsePercentChannel(tokens[2] ?? '')
  if (w === undefined || b === undefined) return undefined
  const rgb = hwbToRgb(normalizeHue(h), clamp(w, 0, 1), clamp(b, 0, 1))
  return { r: rgb.r, g: rgb.g, b: rgb.b, a: parseAlpha(alpha) }
}

function parseAlpha(token: string | undefined): number {
  if (token === undefined) return 1
  const value = parseChannel(token)
  if (value === undefined) return 1
  return clamp(value, 0, 1)
}

// ---------------------------------------------------------------------------
// Conversions
// ---------------------------------------------------------------------------

/**
 * Round a channel float to the nearest integer, ties rounding up, with a tiny
 * epsilon to absorb FP dust at exact .5 boundaries: hsl(210, 100%, 50%) has a
 * green channel of exactly 127.5 mathematically, but IEEE double evaluates the
 * sextant interpolation to 127.4999…9 — CSS serialization rounds half up
 * (spec example: hsl(120deg 100% 25%) = rgb(0 128 0)), so the guard recovers
 * 128. The bias is 1e-7, far larger than FP dust (~1e-13) and far smaller than
 * any rounding decision a real color value could hinge on.
 */
export function roundChannel(value: number): number {
  return Math.round(value + 1e-7)
}

/** Convert RGBA (0–255) to a lowercase hex string, with alpha when < 1. */
export function rgbaToHex(rgba: Rgba): string {
  const to2 = (v: number): string => clamp(roundChannel(v), 0, 255).toString(16).padStart(2, '0')
  let hex = `#${to2(rgba.r)}${to2(rgba.g)}${to2(rgba.b)}`
  if (rgba.a < 1) hex += to2(rgba.a * 255)
  return hex
}

/** Convert RGBA (0–255) to an rgb()/rgba() string. */
export function rgbaToRgbString(rgba: Rgba): string {
  const r = roundChannel(rgba.r)
  const g = roundChannel(rgba.g)
  const b = roundChannel(rgba.b)
  if (rgba.a >= 1) return `rgb(${r}, ${g}, ${b})`
  return `rgba(${r}, ${g}, ${b}, ${round(rgba.a, 3)})`
}

/** Convert RGBA (0–255) to an hsl()/hsla() string (h 1dp, s/l in %). */
export function rgbaToHslString(rgba: Rgba): string {
  const { h, s, l } = rgbToHsl(rgba.r, rgba.g, rgba.b)
  const hText = round(h, 1)
  const sText = round(s * 100, 1)
  const lText = round(l * 100, 1)
  if (rgba.a >= 1) return `hsl(${hText}, ${sText}%, ${lText}%)`
  return `hsla(${hText}, ${sText}%, ${lText}%, ${round(rgba.a, 3)})`
}

/** Convert RGBA (0–255) to an hwb() string (h 1dp, w/b in %). */
export function rgbaToHwbString(rgba: Rgba): string {
  const h = rgbToHsl(rgba.r, rgba.g, rgba.b).h
  const w = (Math.min(rgba.r, rgba.g, rgba.b) / 255) * 100
  const b = (1 - Math.max(rgba.r, rgba.g, rgba.b) / 255) * 100
  const alpha = rgba.a >= 1 ? '' : ` / ${round(rgba.a, 3)}`
  return `hwb(${round(h, 1)} ${round(w, 1)}% ${round(b, 1)}%${alpha})`
}

/** Convert RGBA (0–255) to { h, s, l } with h in degrees, s/l in [0, 1]. */
export function rgbToHsl(r: number, g: number, b: number): { h: number; s: number; l: number } {
  const rn = r / 255
  const gn = g / 255
  const bn = b / 255
  const max = Math.max(rn, gn, bn)
  const min = Math.min(rn, gn, bn)
  const l = (max + min) / 2
  if (max === min) return { h: 0, s: 0, l }
  const d = max - min
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
  let h: number
  if (max === rn) {
    h = (gn - bn) / d + (gn < bn ? 6 : 0)
  } else if (max === gn) {
    h = (bn - rn) / d + 2
  } else {
    h = (rn - gn) / d + 4
  }
  return { h: h * 60, s, l }
}

function hueToRgb(p: number, q: number, t: number): number {
  let tt = t
  if (tt < 0) tt += 1
  if (tt > 1) tt -= 1
  let value: number
  if (tt < 1 / 6) value = p + (q - p) * 6 * tt
  else if (tt < 1 / 2) value = q
  else if (tt < 2 / 3) value = p + (q - p) * (2 / 3 - tt) * 6
  else value = p
  // Snap to [p, q] with an epsilon to absorb floating-point dust at sextant
  // boundaries (e.g. (2/3 - 0.5) * 6 evaluates to 0.9999999999999998 instead
  // of 1). Without this, hsl(180) would round-trip to 254.99999999999994.
  if (value > q - 1e-12) return q
  if (value < p + 1e-12) return p
  return Math.min(q, Math.max(p, value))
}

/** Convert HSL (h degrees, s/l in [0, 1]) to RGB in [0, 255]. */
export function hslToRgb(h: number, s: number, l: number): { r: number; g: number; b: number } {
  if (s === 0) {
    const gray = l * 255
    return { r: gray, g: gray, b: gray }
  }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s
  const p = 2 * l - q
  const hn = h / 360
  return {
    r: hueToRgb(p, q, hn + 1 / 3) * 255,
    g: hueToRgb(p, q, hn) * 255,
    b: hueToRgb(p, q, hn - 1 / 3) * 255,
  }
}

/** Convert HWB (h degrees, w/b in [0, 1]) to RGB in [0, 255]. */
export function hwbToRgb(h: number, w: number, b: number): { r: number; g: number; b: number } {
  if (w + b >= 1) {
    const gray = (w / (w + b)) * 255
    return { r: gray, g: gray, b: gray }
  }
  const rgb = hslToRgb(h, 1, 0.5)
  const factor = 1 - w - b
  return {
    r: (rgb.r * factor + w * 255),
    g: (rgb.g * factor + w * 255),
    b: (rgb.b * factor + w * 255),
  }
}

// ---------------------------------------------------------------------------
// WCAG contrast
// ---------------------------------------------------------------------------

/** sRGB relative luminance of an RGBA color (alpha ignored), in [0, 1]. */
export function relativeLuminance(rgba: Rgba): number {
  const linearize = (v: number): number => {
    const c = v / 255
    return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)
  }
  return (
    0.2126 * linearize(rgba.r) + 0.7152 * linearize(rgba.g) + 0.0722 * linearize(rgba.b)
  )
}

/**
 * WCAG 2.x contrast ratio between two colors: (L1 + 0.05) / (L2 + 0.05) with
 * L1 the lighter luminance. Ranges from 1 (identical) to 21 (black vs white).
 */
export function contrastRatio(first: Rgba, second: Rgba): number {
  const l1 = relativeLuminance(first)
  const l2 = relativeLuminance(second)
  const lighter = Math.max(l1, l2)
  const darker = Math.min(l1, l2)
  return (lighter + 0.05) / (darker + 0.05)
}

/** WCAG level verdict for a ratio, given the text size class. */
export function wcagLevel(ratio: number, largeText: boolean): 'AAA' | 'AA' | 'fail' {
  const aa = largeText ? 3 : 4.5
  const aaa = largeText ? 4.5 : 7
  if (ratio >= aaa) return 'AAA'
  if (ratio >= aa) return 'AA'
  return 'fail'
}

// ---------------------------------------------------------------------------
// Color harmonies and adjustments
// ---------------------------------------------------------------------------

/** The seven palette types color_scheme can generate. */
export type HarmonyType =
  | 'complementary'
  | 'analogous'
  | 'triadic'
  | 'split-complementary'
  | 'tetradic'
  | 'square'
  | 'monochromatic'

/**
 * Canonical hue offsets (degrees) for the hue-rotation harmonies. The base
 * hue comes first for every type except analogous, whose offsets are centered
 * on the base ([-30, 0, 30] for 3 colors, [-60, -30, 0, 30, 60] for 5).
 */
const HUE_ROTATION_OFFSETS: Record<
  'complementary' | 'triadic' | 'split-complementary' | 'tetradic' | 'square',
  number[]
> = {
  complementary: [0, 180],
  triadic: [0, 120, 240],
  'split-complementary': [0, 150, 210],
  tetradic: [0, 60, 180, 240],
  square: [0, 90, 180, 270],
}

/** All valid harmony types, for runtime validation in the tool layer. */
export const HARMONY_TYPES: readonly HarmonyType[] = [
  'complementary',
  'analogous',
  'triadic',
  'split-complementary',
  'tetradic',
  'square',
  'monochromatic',
]

/**
 * Generate the HSL triplets of a color harmony.
 *
 * - hue-rotation types keep the base saturation/lightness and rotate the hue.
 * - analogous uses 3 offsets (default) or 5 (count = 5), centered on the base.
 * - monochromatic keeps hue/saturation and steps lightness `count` times
 *   (clamped to 2–9, default 5), evenly spaced in [max(0.02, l−0.4),
 *   min(0.98, l+0.4)] so the base lightness always sits inside the range.
 *
 * `count` is ignored for the other four types.
 */
export function harmonyHsl(
  h: number,
  s: number,
  l: number,
  type: HarmonyType,
  count?: number,
): Array<{ h: number; s: number; l: number }> {
  if (type === 'analogous') {
    const offsets = count === 5 ? [-60, -30, 0, 30, 60] : [-30, 0, 30]
    return offsets.map((offset) => ({ h: normalizeHue(h + offset), s, l }))
  }
  if (type === 'monochromatic') {
    const n = clamp(Math.trunc(count ?? 5), 2, 9)
    const lower = Math.max(0.02, l - 0.4)
    const upper = Math.min(0.98, l + 0.4)
    const step = n > 1 ? (upper - lower) / (n - 1) : 0
    return Array.from({ length: n }, (_unused, i) => ({ h, s, l: lower + step * i }))
  }
  const offsets = HUE_ROTATION_OFFSETS[type]
  return offsets.map((offset) => ({ h: normalizeHue(h + offset), s, l }))
}

/** The five operations adjust_color can apply. */
export type AdjustOp = 'lighten' | 'darken' | 'saturate' | 'desaturate' | 'hue'

/** All valid adjustment operations, for runtime validation in the tool layer. */
export const ADJUST_OPS: readonly AdjustOp[] = ['lighten', 'darken', 'saturate', 'desaturate', 'hue']

/**
 * Apply one adjustment to an HSL triplet.
 *
 * `amount` semantics: for lighten/darken/saturate/desaturate it is percentage
 * points in [0, 100] (clamped); for hue it is degrees to rotate (any sign,
 * normalized to [0, 360)). Saturating an achromatic color (s = 0) is a no-op,
 * matching CSS filter saturate() — a gray has no hue to intensify.
 */
export function adjustHsl(
  h: number,
  s: number,
  l: number,
  op: AdjustOp,
  amount: number,
): { h: number; s: number; l: number } {
  switch (op) {
    case 'lighten':
      return { h, s, l: clamp(l + clamp(amount, 0, 100) / 100, 0, 1) }
    case 'darken':
      return { h, s, l: clamp(l - clamp(amount, 0, 100) / 100, 0, 1) }
    case 'saturate':
      return s === 0 ? { h, s, l } : { h, s: clamp(s + clamp(amount, 0, 100) / 100, 0, 1), l }
    case 'desaturate':
      return { h, s: clamp(s - clamp(amount, 0, 100) / 100, 0, 1), l }
    case 'hue':
      return { h: normalizeHue(h + amount), s, l }
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Round to `digits` decimals, trimming trailing zeros. */
export function round(value: number, digits: number): number {
  const factor = Math.pow(10, digits)
  return Math.round(value * factor) / factor
}

/**
 * Round for output while folding `-0` into `0`. JSON stringifies both as "0",
 * so a strict deep-equality round-trip gate (which is what dsh-tools applies to
 * tool output) reads `-0` as lossy — and rounding a tiny negative Lab channel
 * such as −4e-5 to 4 decimals lands on exactly `-0`.
 */
export function roundOut(value: number, digits: number): number {
  const rounded = round(value, digits)
  return rounded === 0 ? 0 : rounded
}

// ---------------------------------------------------------------------------
// Compositing and contrast repair
// ---------------------------------------------------------------------------

/** The two blending modes blend_colors supports. */
export type BlendMode = 'over' | 'mix'

/** Canonical blend-mode list (drives the tool enum). */
export const BLEND_MODES: readonly BlendMode[] = ['over', 'mix']

/**
 * Composite `source` over `backdrop` — Porter-Duff source-over with
 * non-premultiplied channels in and out (CSS Compositing and Blending §9.1).
 * This is what a browser paints for a translucent overlay on a solid backdrop.
 */
export function blendOver(source: Rgba, backdrop: Rgba): Rgba {
  const alpha = source.a + backdrop.a * (1 - source.a)
  if (alpha === 0) return { r: 0, g: 0, b: 0, a: 0 }
  const channel = (s: number, b: number): number =>
    (s * source.a + b * backdrop.a * (1 - source.a)) / alpha
  return {
    r: channel(source.r, backdrop.r),
    g: channel(source.g, backdrop.g),
    b: channel(source.b, backdrop.b),
    a: alpha,
  }
}

/**
 * Premultiplied sRGB interpolation: `weight` is the weight of `second` in
 * [0, 1], so `first` carries the remaining 1 − weight. Identical to CSS
 * `color-mix(in srgb, first, second <weight × 100>%)`, alpha included: the
 * interpolation happens on premultiplied channels and is divided back out.
 */
export function blendMix(first: Rgba, second: Rgba, weight: number): Rgba {
  const w2 = clamp(weight, 0, 1)
  const w1 = 1 - w2
  const alpha = first.a * w1 + second.a * w2
  if (alpha === 0) return { r: 0, g: 0, b: 0, a: 0 }
  const channel = (c1: number, c2: number): number =>
    (c1 * first.a * w1 + c2 * second.a * w2) / alpha
  return {
    r: channel(first.r, second.r),
    g: channel(first.g, second.g),
    b: channel(first.b, second.b),
    a: alpha,
  }
}

/** Direction to move a foreground color while repairing contrast. */
export type ContrastDirection = 'auto' | 'darken' | 'lighten'

/** Canonical direction list (drives the tool enum). */
export const CONTRAST_DIRECTIONS: readonly ContrastDirection[] = ['auto', 'darken', 'lighten']

/** Outcome of ensureContrast: either a passing color or the best achievable one. */
export interface ContrastFix {
  /** True when a color reaching `target` was found. */
  ok: boolean
  /** True when the returned color differs from the input (lightness moved). */
  changed: boolean
  /** The direction actually used (never 'auto'). */
  direction: 'darken' | 'lighten'
  /** The color that reaches the target (present when ok). */
  rgba?: Rgba
  /** Contrast ratio of `rgba` against the background (present when ok). */
  ratio?: number
  /** Signed lightness change in percentage points (present when ok). */
  lightnessShift?: number
  /** Best color found when the target is unreachable (present when not ok). */
  bestRgba?: Rgba
  /** Contrast ratio of `bestRgba` (present when not ok). */
  bestRatio?: number
}

/** Lightness scan resolution of ensureContrast (1/1000 of the trip to the extreme). */
const CONTRAST_SCAN_STEPS = 1000
/** Bisection count used to shave the scan's last step down. */
const CONTRAST_REFINE_STEPS = 20

const BLACK: Rgba = { r: 0, g: 0, b: 0, a: 1 }
const WHITE: Rgba = { r: 255, g: 255, b: 255, a: 1 }

/** 8-bit serialization of a float channel — the color a renderer actually shows. */
function serializeChannel(value: number): number {
  return clamp(roundChannel(value), 0, 255)
}

/**
 * Move `foreground` toward black or white until it reaches `target` WCAG
 * contrast on `background`, preserving hue and saturation. Deterministic and
 * reproducible by design:
 *
 *  1. `direction` 'auto' picks the extreme (black or white) with the higher
 *     contrast against the background; ties resolve to 'darken'.
 *  2. Scan 1000 lightness steps from the input toward that extreme and take the
 *     first step whose **8-bit rounded** color passes — rounding happens before
 *     the test, so what passes is what the user will literally see.
 *  3. Bisect the bracketing interval 20 times so the color moves as little as
 *     possible (only ever shrinking toward a color already known to pass).
 *
 * Returns `changed: false` when the input already passes, and
 * `ok: false` plus the best achievable color when the target is out of reach on
 * that background (e.g. AAA on mid-gray, where even black scores ~5.3).
 */
export function ensureContrast(
  foreground: Rgba,
  background: Rgba,
  target: number,
  direction: ContrastDirection = 'auto',
): ContrastFix {
  const base = contrastRatio(foreground, background)
  const resolved: 'darken' | 'lighten' = direction === 'auto'
    ? (contrastRatio(WHITE, background) > contrastRatio(BLACK, background) ? 'lighten' : 'darken')
    : direction
  if (base >= target) {
    return {
      ok: true,
      changed: false,
      direction: resolved,
      rgba: foreground,
      ratio: base,
      lightnessShift: 0,
    }
  }

  const { h, s, l } = rgbToHsl(foreground.r, foreground.g, foreground.b)
  const extreme = resolved === 'darken' ? 0 : 1
  const at = (t: number): Rgba => {
    const rgb = hslToRgb(h, s, l + (extreme - l) * t)
    return {
      r: serializeChannel(rgb.r),
      g: serializeChannel(rgb.g),
      b: serializeChannel(rgb.b),
      a: foreground.a,
    }
  }

  let low = 0
  let high = 0
  let passing: Rgba | undefined
  for (let i = 1; i <= CONTRAST_SCAN_STEPS; i += 1) {
    const t = i / CONTRAST_SCAN_STEPS
    const candidate = at(t)
    if (contrastRatio(candidate, background) >= target) {
      low = (i - 1) / CONTRAST_SCAN_STEPS
      high = t
      passing = candidate
      break
    }
  }

  if (passing === undefined) {
    const best = at(1)
    return {
      ok: false,
      changed: false,
      direction: resolved,
      bestRgba: best,
      bestRatio: contrastRatio(best, background),
    }
  }

  for (let i = 0; i < CONTRAST_REFINE_STEPS; i += 1) {
    const mid = (low + high) / 2
    const candidate = at(mid)
    if (contrastRatio(candidate, background) >= target) {
      high = mid
      passing = candidate
    } else {
      low = mid
    }
  }

  return {
    ok: true,
    changed: true,
    direction: resolved,
    rgba: passing,
    ratio: contrastRatio(passing, background),
    lightnessShift: (extreme - l) * high * 100,
  }
}

// ---------------------------------------------------------------------------
// CIELAB, Oklab and perceptual color difference
// ---------------------------------------------------------------------------

/** A Lab-style triplet: lightness plus two opponent-color axes. */
export interface LabColor {
  l: number
  a: number
  b: number
}

/**
 * D65 reference white, derived from its 4-figure CIE chromaticity coordinates
 * (x = 0.3127, y = 0.3290) exactly the way CSS Color 4 defines it. Deriving it
 * from the chromaticities instead of hard-coding a rounded triplet keeps the
 * white point consistent with the sRGB→XYZ matrix below: white must land on
 * a = b = 0 exactly (the oracle checks that invariant on every run).
 */
const D65_WHITE: readonly [number, number, number] = [
  0.3127 / 0.3290,
  1,
  (1 - 0.3127 - 0.3290) / 0.3290,
]

/** CIE Lab constants as the exact rationals CIE 15 / CSS Color 4 use. */
const LAB_EPSILON = 216 / 24389
const LAB_KAPPA = 24389 / 27

/** A 3×3 matrix as three row tuples. */
type Mat3 = readonly [readonly [number, number, number], readonly [number, number, number], readonly [number, number, number]]

function applyMatrix(m: Mat3, v: readonly [number, number, number]): [number, number, number] {
  return [
    m[0][0] * v[0] + m[0][1] * v[1] + m[0][2] * v[2],
    m[1][0] * v[0] + m[1][1] * v[1] + m[1][2] * v[2],
    m[2][0] * v[0] + m[2][1] * v[1] + m[2][2] * v[2],
  ]
}

/** Multiply two 3×3 matrices (a · b). */
export function multiplyMat3(a: Mat3, b: Mat3): Mat3 {
  const [b00, b01, b02] = b[0]
  const [b10, b11, b12] = b[1]
  const [b20, b21, b22] = b[2]
  const row = (r: readonly [number, number, number]): [number, number, number] => [
    r[0] * b00 + r[1] * b10 + r[2] * b20,
    r[0] * b01 + r[1] * b11 + r[2] * b21,
    r[0] * b02 + r[1] * b12 + r[2] * b22,
  ]
  return [row(a[0]), row(a[1]), row(a[2])]
}

/**
 * Invert a 3×3 matrix (adjugate / determinant). The Oklab matrices are
 * published in the forward direction only, so the inverse direction is derived
 * here rather than typed in from a second, differently rounded source.
 */
export function invertMat3(m: Mat3): Mat3 {
  const [a, b, c] = m[0]
  const [d, e, f] = m[1]
  const [g, h, i] = m[2]
  const A = e * i - f * h
  const B = -(d * i - f * g)
  const C = d * h - e * g
  const D = -(b * i - c * h)
  const E = a * i - c * g
  const F = -(a * h - b * g)
  const G = b * f - c * e
  const H = -(a * f - c * d)
  const I = a * e - b * d
  const det = a * A + b * B + c * C
  return [
    [A / det, D / det, G / det],
    [B / det, E / det, H / det],
    [C / det, F / det, I / det],
  ]
}

/** linear-light sRGB (D65, white = Y 1) → CIE XYZ — rational form, CSS Color 4 §8. */
const LINEAR_SRGB_TO_XYZ: Mat3 = [
  [506752 / 1228815, 87881 / 245763, 12673 / 70218],
  [87098 / 409605, 175762 / 245763, 12673 / 175545],
  [7918 / 409605, 87881 / 737289, 1001167 / 1053270],
]

/** CIE XYZ → linear-light sRGB — rational form, CSS Color 4 §8. */
const XYZ_TO_LINEAR_SRGB: Mat3 = [
  [12831 / 3959, -329 / 214, -1974 / 3959],
  [-851781 / 878810, 1648619 / 878810, 36519 / 878810],
  [705 / 12673, -2585 / 12673, 705 / 667],
]

/**
 * CIE XYZ (D65, Y = 1 for white) → cone responses (Oklab M₁). These are the
 * 2021-recalculated 64-bit constants from CSS Color 4 §13, which pair exactly
 * with the rational sRGB→XYZ matrix above: white lands on Oklab (1, 0, 0) to
 * machine precision (the oracle asserts it). Ottosson's original constants are
 * rounded differently and drift ~1e-4 from the modern sRGB white.
 */
const XYZ_TO_LMS: Mat3 = [
  [0.8190224379967030, 0.3619062600528904, -0.1288737815209879],
  [0.0329836539323885, 0.9292868615863434, 0.0361446663506424],
  [0.0481771893596242, 0.2642395317527308, 0.6335478284694309],
]

/** Cone responses → Oklab (Oklab M₂, 64-bit CSS Color 4 form). */
const LMS_TO_OKLAB: Mat3 = [
  [0.2104542683093140, 0.7936177747023054, -0.0040720430116193],
  [1.9779985324311684, -2.4285922420485799, 0.4505937096174110],
  [0.0259040424655478, 0.7827717124575296, -0.8086757549230774],
]

/** Inverse of the published M₂ (derived, not typed in). */
const OKLAB_TO_LMS = invertMat3(LMS_TO_OKLAB)
/** Inverse of the published M₁ (derived, not typed in). */
const LMS_TO_XYZ = invertMat3(XYZ_TO_LMS)
/** Oklab → linear-light sRGB, composed once from the two published halves. */
const OKLAB_TO_LINEAR_SRGB = multiplyMat3(XYZ_TO_LINEAR_SRGB, LMS_TO_XYZ)

/** sRGB gamma encoding: one channel in [0, 1] (linear) → [0, 255]. */
export function linearToSrgbChannel(value: number): number {
  const sign = value < 0 ? -1 : 1
  const abs = Math.abs(value)
  const encoded = abs > 0.0031308 ? sign * (1.055 * Math.pow(abs, 1 / 2.4) - 0.055) : 12.92 * value
  return encoded * 255
}

/** sRGB gamma decoding: one channel in [0, 255] → [0, 1] (linear). */
export function srgbToLinearChannel(value: number): number {
  const c = value / 255
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)
}

/** RGBA (sRGB, alpha ignored) → CIE XYZ with the D65 white point. */
export function rgbaToXyz(rgba: Rgba): [number, number, number] {
  return applyMatrix(LINEAR_SRGB_TO_XYZ, [
    srgbToLinearChannel(rgba.r),
    srgbToLinearChannel(rgba.g),
    srgbToLinearChannel(rgba.b),
  ])
}

/** CIE XYZ (D65) → CIELAB, L in [0, 100], a/b unbounded. */
export function xyzToLab(xyz: readonly [number, number, number]): LabColor {
  const f = (value: number, white: number): number => {
    const t = value / white
    return t > LAB_EPSILON ? Math.cbrt(t) : (LAB_KAPPA * t + 16) / 116
  }
  const fx = f(xyz[0], D65_WHITE[0])
  const fy = f(xyz[1], D65_WHITE[1])
  const fz = f(xyz[2], D65_WHITE[2])
  return { l: 116 * fy - 16, a: 500 * (fx - fy), b: 200 * (fy - fz) }
}

/** CIELAB → CIE XYZ (D65). Inverse of {@link xyzToLab}. */
export function labToXyz(lab: LabColor): [number, number, number] {
  const fy = (lab.l + 16) / 116
  const fx = fy + lab.a / 500
  const fz = fy - lab.b / 200
  const back = (f: number): number => {
    const cube = f * f * f
    return cube > LAB_EPSILON ? cube : (116 * f - 16) / LAB_KAPPA
  }
  return [back(fx) * D65_WHITE[0], back(fy) * D65_WHITE[1], back(fz) * D65_WHITE[2]]
}

/** RGBA (sRGB) → CIELAB under the D65 white point (alpha ignored). */
export function rgbaToLab(rgba: Rgba): LabColor {
  return xyzToLab(rgbaToXyz(rgba))
}

/** CIELAB → RGBA, channels clamped into the sRGB gamut and alpha passed through. */
export function labToRgba(lab: LabColor, alpha = 1): Rgba {
  const linear = applyMatrix(XYZ_TO_LINEAR_SRGB, labToXyz(lab))
  return {
    r: clamp(linearToSrgbChannel(linear[0]), 0, 255),
    g: clamp(linearToSrgbChannel(linear[1]), 0, 255),
    b: clamp(linearToSrgbChannel(linear[2]), 0, 255),
    a: alpha,
  }
}

/** RGBA (sRGB) → Oklab (D65, L in [0, 1]). */
export function rgbaToOklab(rgba: Rgba): LabColor {
  const lms = applyMatrix(XYZ_TO_LMS, rgbaToXyz(rgba))
  const root: [number, number, number] = [Math.cbrt(lms[0]), Math.cbrt(lms[1]), Math.cbrt(lms[2])]
  const lab = applyMatrix(LMS_TO_OKLAB, root)
  return { l: lab[0], a: lab[1], b: lab[2] }
}

/** Oklab → RGBA, out-of-gamut results clamped to sRGB, alpha passed through. */
export function oklabToRgba(lab: LabColor, alpha = 1): Rgba {
  const root: [number, number, number] = [lab.l, lab.a, lab.b]
  const lms = applyMatrix(OKLAB_TO_LMS, root)
  const linear = applyMatrix(OKLAB_TO_LINEAR_SRGB, [lms[0] ** 3, lms[1] ** 3, lms[2] ** 3])
  return {
    r: clamp(linearToSrgbChannel(linear[0]), 0, 255),
    g: clamp(linearToSrgbChannel(linear[1]), 0, 255),
    b: clamp(linearToSrgbChannel(linear[2]), 0, 255),
    a: alpha,
  }
}

/** CIE76 color difference: plain Euclidean distance in CIELAB. */
export function deltaE76(first: LabColor, second: LabColor): number {
  const dl = first.l - second.l
  const da = first.a - second.a
  const db = first.b - second.b
  return Math.sqrt(dl * dl + da * da + db * db)
}

const DEG = 180 / Math.PI
const RAD = Math.PI / 180

/** Hue angle h′ = atan2(b, a) in degrees, normalized to [0, 360). */
function hueAngle(a: number, b: number): number {
  const angle = Math.atan2(b, a) * DEG
  return angle < 0 ? angle + 360 : angle
}

/**
 * CIEDE2000 color difference (CIE 2000, kL = kC = kH = 1), the industry
 * standard for "how different do these two colors look". The implementation
 * follows Sharma, Wu & Dalal (2005) including the two hue-average special
 * cases (zero chroma and hue pairs more than 180° apart); the oracle replays
 * their published 34-pair reference table on every run.
 */
export function deltaE2000(first: LabColor, second: LabColor): number {
  const c1 = Math.sqrt(first.a * first.a + first.b * first.b)
  const c2 = Math.sqrt(second.a * second.a + second.b * second.b)
  const cBar = (c1 + c2) / 2
  const cBar7 = cBar ** 7
  const g = 0.5 * (1 - Math.sqrt(cBar7 / (cBar7 + 25 ** 7)))
  const a1p = (1 + g) * first.a
  const a2p = (1 + g) * second.a
  const c1p = Math.sqrt(a1p * a1p + first.b * first.b)
  const c2p = Math.sqrt(a2p * a2p + second.b * second.b)
  const h1p = hueAngle(a1p, first.b)
  const h2p = hueAngle(a2p, second.b)

  const dLp = second.l - first.l
  const dCp = c2p - c1p
  let dhp = 0
  if (c1p * c2p !== 0) {
    const diff = h2p - h1p
    if (Math.abs(diff) <= 180) dhp = diff
    else dhp = diff > 180 ? diff - 360 : diff + 360
  }
  const dHp = 2 * Math.sqrt(c1p * c2p) * Math.sin((dhp / 2) * RAD)

  const lBarP = (first.l + second.l) / 2
  const cBarP = (c1p + c2p) / 2
  let hBarP = h1p + h2p
  if (c1p * c2p !== 0) {
    const sum = h1p + h2p
    if (Math.abs(h1p - h2p) <= 180) hBarP = sum / 2
    else if (sum < 360) hBarP = (sum + 360) / 2
    else hBarP = (sum - 360) / 2
  }

  const t = 1
    - 0.17 * Math.cos((hBarP - 30) * RAD)
    + 0.24 * Math.cos(2 * hBarP * RAD)
    + 0.32 * Math.cos((3 * hBarP + 6) * RAD)
    - 0.2 * Math.cos((4 * hBarP - 63) * RAD)
  const dTheta = 30 * Math.exp(-(((hBarP - 275) / 25) ** 2))
  const cBarP7 = cBarP ** 7
  const rc = 2 * Math.sqrt(cBarP7 / (cBarP7 + 25 ** 7))
  const lShift = (lBarP - 50) ** 2
  const sl = 1 + (0.015 * lShift) / Math.sqrt(20 + lShift)
  const sc = 1 + 0.045 * cBarP
  const sh = 1 + 0.015 * cBarP * t
  const rt = -Math.sin(2 * dTheta * RAD) * rc

  const termL = dLp / sl
  const termC = dCp / sc
  const termH = dHp / sh
  return Math.sqrt(termL * termL + termC * termC + termH * termH + rt * termC * termH)
}

/** How different two colors look, as a word (ΔE00 bands, plain-language). */
export type DifferenceVerdict = 'identical' | 'barely-perceptible' | 'perceptible' | 'different' | 'very-different'

/** Canonical verdict list (drives nothing but documentation and tests). */
export const DIFFERENCE_VERDICTS: readonly DifferenceVerdict[] = [
  'identical',
  'barely-perceptible',
  'perceptible',
  'different',
  'very-different',
]

/**
 * Map a ΔE00 value onto a verdict. Bands follow the widely used reading of
 * ΔE00: ≤1 is not perceptible, ≤2 is perceptible only on close inspection,
 * ≤10 is obvious at a glance, and past ~50 the colors read as opposites.
 */
export function differenceVerdict(delta: number): DifferenceVerdict {
  if (delta <= 1) return 'identical'
  if (delta <= 2) return 'barely-perceptible'
  if (delta <= 10) return 'perceptible'
  if (delta <= 49) return 'different'
  return 'very-different'
}

// ---------------------------------------------------------------------------
// Perceptually even scales (tints / shades / gradients)
// ---------------------------------------------------------------------------

/** The four ramp shapes color_scale can build. */
export type ScaleMode = 'tints' | 'shades' | 'both' | 'between'

/** Canonical ramp list (drives the tool enum). */
export const SCALE_MODES: readonly ScaleMode[] = ['tints', 'shades', 'both', 'between']

/** Interpolation space: perceptual (Oklab) or plain sRGB channels. */
export type ScaleSpace = 'oklab' | 'srgb'

/** Canonical space list (drives the tool enum). */
export const SCALE_SPACES: readonly ScaleSpace[] = ['oklab', 'srgb']

/** Ramp length bounds enforced by color_scale. */
export const SCALE_MIN_STEPS = 2
/** Ramp length upper bound enforced by color_scale. */
export const SCALE_MAX_STEPS = 11

function lerp(from: number, to: number, t: number): number {
  return from + (to - from) * t
}

/** Mix `second` into `first` with the given weight in the requested space. */
export function scaleMix(first: Rgba, second: Rgba, weight: number, space: ScaleSpace): Rgba {
  const t = clamp(weight, 0, 1)
  const alpha = lerp(first.a, second.a, t)
  if (space === 'oklab') {
    const from = rgbaToOklab(first)
    const to = rgbaToOklab(second)
    return oklabToRgba(
      { l: lerp(from.l, to.l, t), a: lerp(from.a, to.a, t), b: lerp(from.b, to.b, t) },
      alpha,
    )
  }
  return {
    r: lerp(first.r, second.r, t),
    g: lerp(first.g, second.g, t),
    b: lerp(first.b, second.b, t),
    a: alpha,
  }
}

/** The white and black endpoints a tint/shade ramp mixes toward. */
const SCALE_WHITE: Rgba = { r: 255, g: 255, b: 255, a: 1 }
const SCALE_BLACK: Rgba = { r: 0, g: 0, b: 0, a: 1 }

/**
 * Build the ramp between a base color and (depending on `mode`) white, black,
 * both, or a second color.
 *
 *  - `tints`   — base → white, `steps` colors, base first
 *  - `shades`  — base → black, base first
 *  - `both`    — black → base → white, evenly weighted, base in the middle
 *                when `steps` is odd (an even count simply has no exact base)
 *  - `between` — base → `target`, evenly spaced
 *
 * With `space = 'oklab'` the endpoints are interpolated in Oklab, so the steps
 * are evenly spaced in perceived color rather than in sRGB channel values; any
 * step that falls outside the sRGB gamut is clamped back into it. Alpha is
 * interpolated linearly in both spaces.
 */
export function colorScale(
  base: Rgba,
  target: Rgba | undefined,
  mode: ScaleMode,
  steps: number,
  space: ScaleSpace,
): Rgba[] {
  const n = clamp(Math.trunc(steps), SCALE_MIN_STEPS, SCALE_MAX_STEPS)
  const out: Rgba[] = []
  for (let i = 0; i < n; i += 1) {
    const t = n > 1 ? i / (n - 1) : 0
    if (mode === 'tints') out.push(scaleMix(base, SCALE_WHITE, t, space))
    else if (mode === 'shades') out.push(scaleMix(base, SCALE_BLACK, t, space))
    else if (mode === 'both') {
      const w = -1 + 2 * t
      out.push(w < 0 ? scaleMix(base, SCALE_BLACK, -w, space) : scaleMix(base, SCALE_WHITE, w, space))
    } else {
      out.push(scaleMix(base, target ?? base, t, space))
    }
  }
  return out
}

/** Convenience: parse a user color string, resolving named colors first. */
export function parseColorInput(input: string, namedLookup: (name: string) => string | undefined): ParseResult {
  const trimmed = input.trim()
  if (trimmed === '') return { ok: false, error: 'empty color input' }
  const lowered = trimmed.toLowerCase()

  if (lowered === 'transparent') {
    return { ok: true, color: { format: 'name', name: 'transparent', rgba: { r: 0, g: 0, b: 0, a: 0 } } }
  }

  const named = namedLookup(lowered)
  if (named !== undefined) {
    const rgba = parseHex(`#${named}`)
    if (rgba !== undefined) {
      return { ok: true, color: { format: 'name', name: lowered, rgba } }
    }
  }

  const hex = parseHex(lowered)
  if (hex !== undefined) return { ok: true, color: { format: 'hex', rgba: hex } }

  const functional = parseFunctional(lowered)
  if (functional !== undefined) {
    const format = lowered.startsWith('hwb') ? 'hwb' : lowered.startsWith('hsl') ? 'hsl' : 'rgb'
    return { ok: true, color: { format, rgba: functional } }
  }

  return { ok: false, error: `unrecognized color format: "${input}" (expected hex, rgb(), hsl(), hwb(), or a CSS color name)` }
}
