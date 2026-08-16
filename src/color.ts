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
    const r = parseChannel(tokens[0] ?? '')
    const g = parseChannel(tokens[1] ?? '')
    const b = parseChannel(tokens[2] ?? '')
    if (r === undefined || g === undefined || b === undefined) return undefined
    return {
      r: clamp(r * 255, 0, 255),
      g: clamp(g * 255, 0, 255),
      b: clamp(b * 255, 0, 255),
      a: parseAlpha(alpha),
    }
  }

  const h = parseAngle(tokens[0] ?? '')
  const s = parseChannel(tokens[1] ?? '')
  const l = parseChannel(tokens[2] ?? '')
  if (h === undefined || s === undefined || l === undefined) return undefined

  if (kind === 'hsl') {
    const rgb = hslToRgb(normalizeHue(h), clamp(s, 0, 1), clamp(l, 0, 1))
    return { r: rgb.r, g: rgb.g, b: rgb.b, a: parseAlpha(alpha) }
  }

  // hwb: w and b are fractions of 0–100% (CSS requires percentages, but bare
  // numbers are accepted leniently and treated as percentages).
  const w = parseChannel(tokens[1] ?? '')
  const b = parseChannel(tokens[2] ?? '')
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

/** Convert RGBA (0–255) to a lowercase hex string, with alpha when < 1. */
export function rgbaToHex(rgba: Rgba): string {
  const to2 = (v: number): string => clamp(Math.round(v), 0, 255).toString(16).padStart(2, '0')
  let hex = `#${to2(rgba.r)}${to2(rgba.g)}${to2(rgba.b)}`
  if (rgba.a < 1) hex += to2(rgba.a * 255)
  return hex
}

/** Convert RGBA (0–255) to an rgb()/rgba() string. */
export function rgbaToRgbString(rgba: Rgba): string {
  const r = Math.round(rgba.r)
  const g = Math.round(rgba.g)
  const b = Math.round(rgba.b)
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
// Helpers
// ---------------------------------------------------------------------------

/** Round to `digits` decimals, trimming trailing zeros. */
export function round(value: number, digits: number): number {
  const factor = Math.pow(10, digits)
  return Math.round(value * factor) / factor
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
