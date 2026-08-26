/**
 * Tool definitions for dsh-color: three pure-math color tools exposed to every
 * agent via defineTool. No network, no filesystem — everything is computed
 * locally from the input string.
 *
 * @module dsh-color/tools
 */

import { defineTool, type ToolDefinition } from '@deepseek-ai/dsh-tools'
import {
  adjustHsl,
  ADJUST_OPS,
  contrastRatio,
  harmonyHsl,
  HARMONY_TYPES,
  hslToRgb,
  parseColorInput,
  relativeLuminance,
  rgbaToHex,
  rgbaToHslString,
  rgbaToHwbString,
  rgbaToRgbString,
  rgbToHsl,
  round,
  wcagLevel,
  type AdjustOp,
  type HarmonyType,
  type Rgba,
} from './color.ts'
import { lookupNamed, NAMED_COLORS, namesByHex, searchNamed } from './named.ts'

export interface ToolSet {
  convert_color: ToolDefinition
  contrast_ratio: ToolDefinition
  color_info: ToolDefinition
  color_scheme: ToolDefinition
  adjust_color: ToolDefinition
}

/** Result of convert_color, kept flat and JsonValue-safe. */
export interface ConvertResult {
  input: string
  ok: boolean
  error?: string
  hex?: string
  rgb?: string
  hsl?: string
  hwb?: string
  alpha: number
  name?: string
}

/** Result of contrast_ratio. */
export interface ContrastResult {
  color1: string
  color2: string
  ok: boolean
  error?: string
  ratio?: number
  aa?: boolean
  aaa?: boolean
  level?: 'AAA' | 'AA' | 'fail'
  largeText: boolean
}

/** One row of color_info matches. */
export interface ColorMatch {
  name: string
  hex: string
  rgb: string
  hsl: string
  luminance: number
}

/** Result of color_info. */
export interface InfoResult {
  ok: boolean
  error?: string
  query: string
  by: 'name' | 'value'
  count: number
  total: number
  matches: ColorMatch[]
}

/** One color of a generated scheme. */
export interface SchemeColor {
  hex: string
  rgb: string
  hsl: string
}

/** Result of color_scheme. */
export interface SchemeResult {
  ok: boolean
  error?: string
  input: string
  type: string
  count: number
  colors: SchemeColor[]
}

/** Result of adjust_color. */
export interface AdjustResult {
  ok: boolean
  error?: string
  input: string
  op: string
  amount: number
  hex?: string
  rgb?: string
  hsl?: string
}

/** Turn an HSL triplet into the three string formats, keeping alpha. */
function hslToStrings(h: number, s: number, l: number, a: number): SchemeColor {
  const rgb = hslToRgb(h, s, l)
  const rgba: Rgba = { r: rgb.r, g: rgb.g, b: rgb.b, a }
  return { hex: rgbaToHex(rgba), rgb: rgbaToRgbString(rgba), hsl: rgbaToHslString(rgba) }
}

function matchRow(name: string, hex: string): ColorMatch {
  const rgba = parseHexStrict(hex)
  return {
    name,
    hex,
    rgb: rgbaToRgbString(rgba),
    hsl: rgbaToHslString(rgba),
    luminance: round(relativeLuminance(rgba), 4),
  }
}

/** Parse a hex string we know is valid (from the named table). */
function parseHexStrict(hex: string): Rgba {
  const parsed = parseColorInput(hex, () => undefined)
  if (!parsed.ok) return { r: 0, g: 0, b: 0, a: 1 }
  return parsed.color.rgba
}

/** Build all three tool definitions. */
export function buildColorTools(): ToolSet {
  const convert_color = defineTool({
    name: 'convert_color',
    description: 'Parse any CSS color (hex #rgb/#rgba/#rrggbb/#rrggbbaa, rgb()/rgba(), hsl()/hsla(), hwb(), '
      + 'or a CSS color name like "rebeccapurple") and convert it to the requested format. '
      + 'Useful for CSS/design work: translating between hex, rgb, hsl and hwb, normalizing shorthand, '
      + 'and resolving named colors to their numeric value. Pure local math, read-only.',
    parameters: {
      input: { type: 'string', required: true, description: 'The color to parse, in any supported CSS format.' },
      format: {
        type: 'string',
        enum: ['all', 'hex', 'rgb', 'hsl', 'hwb'],
        description: 'Output format: "all" returns every format (default), otherwise only the requested one.',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          input: { type: 'string', required: true },
          ok: { type: 'boolean', required: true },
          error: { type: 'string' },
          hex: { type: 'string' },
          rgb: { type: 'string' },
          hsl: { type: 'string' },
          hwb: { type: 'string' },
          alpha: { type: 'number', required: true },
          name: { type: 'string' },
        },
      },
      render: (_args: { input: string; format?: string }, value: unknown) => {
        const result = value as ConvertResult
        if (!result.ok) return [{ type: 'text', text: `convert_color: ${result.error ?? 'invalid color'}` }]
        const parts = [`${result.input} =`]
        if (result.name !== undefined) parts.push(`named "${result.name}",`)
        if (result.hex !== undefined) parts.push(result.hex)
        if (result.rgb !== undefined) parts.push(result.rgb)
        if (result.hsl !== undefined) parts.push(result.hsl)
        if (result.hwb !== undefined) parts.push(result.hwb)
        if (result.alpha < 1) parts.push(`alpha ${result.alpha}`)
        return [{ type: 'text', text: parts.join(' ') }]
      },
    },
    async execute(args: { input: string; format?: string }): Promise<ConvertResult> {
      const format = args.format ?? 'all'
      const parsed = parseColorInput(args.input, lookupNamed)
      if (!parsed.ok) return { input: args.input, ok: false, error: parsed.error, alpha: 1 }
      const { rgba, name } = parsed.color
      // Assign keys only when present: JSON round-trips are lossy when a key
      // holds `undefined` (dsh-tools output gate rejects "not lossless JSON").
      const result: ConvertResult = { input: args.input, ok: true, alpha: round(rgba.a, 3) }
      if (name !== undefined) result.name = name
      if (format === 'all' || format === 'hex') result.hex = rgbaToHex(rgba)
      if (format === 'all' || format === 'rgb') result.rgb = rgbaToRgbString(rgba)
      if (format === 'all' || format === 'hsl') result.hsl = rgbaToHslString(rgba)
      if (format === 'all' || format === 'hwb') result.hwb = rgbaToHwbString(rgba)
      return result
    },
  })

  const contrast_ratio = defineTool({
    name: 'contrast_ratio',
    description: 'Compute the WCAG 2.x contrast ratio between two colors (any CSS format) and judge whether the '
      + 'pair passes AA/AAA accessibility requirements for normal or large text. Ratio ranges 1 (same color) to '
      + '21 (black on white). Useful when picking text/background pairs or checking an existing design.',
    parameters: {
      color1: { type: 'string', required: true, description: 'First color (e.g. the text color).' },
      color2: { type: 'string', required: true, description: 'Second color (e.g. the background color).' },
      textSize: {
        type: 'string',
        enum: ['normal', 'large'],
        description: 'Text size class: "large" = ≥18pt or ≥14pt bold (WCAG 1.4.3). Default normal.',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          color1: { type: 'string', required: true },
          color2: { type: 'string', required: true },
          ok: { type: 'boolean', required: true },
          error: { type: 'string' },
          ratio: { type: 'number' },
          aa: { type: 'boolean' },
          aaa: { type: 'boolean' },
          level: { type: 'string', enum: ['AAA', 'AA', 'fail'] },
          largeText: { type: 'boolean', required: true },
        },
      },
      render: (_args: { color1: string; color2: string }, value: unknown) => {
        const result = value as ContrastResult
        if (!result.ok) return [{ type: 'text', text: `contrast_ratio: ${result.error ?? 'invalid color'}` }]
        const size = result.largeText ? 'large' : 'normal'
        return [{
          type: 'text',
          text: `contrast ${result.color1} vs ${result.color2} = ${result.ratio}:1 — ${result.level} for ${size} text (AA ${result.aa === true ? 'pass' : 'fail'}, AAA ${result.aaa === true ? 'pass' : 'fail'})`,
        }]
      },
    },
    async execute(args: { color1: string; color2: string; textSize?: string }): Promise<ContrastResult> {
      const largeText = args.textSize === 'large'
      const first = parseColorInput(args.color1, lookupNamed)
      if (!first.ok) return { color1: args.color1, color2: args.color2, ok: false, error: first.error, largeText }
      const second = parseColorInput(args.color2, lookupNamed)
      if (!second.ok) return { color1: args.color1, color2: args.color2, ok: false, error: second.error, largeText }
      const ratio = round(contrastRatio(first.color.rgba, second.color.rgba), 2)
      const level = wcagLevel(ratio, largeText)
      return {
        color1: args.color1,
        color2: args.color2,
        ok: true,
        ratio,
        aa: ratio >= (largeText ? 3 : 4.5),
        aaa: ratio >= (largeText ? 4.5 : 7),
        level,
        largeText,
      }
    },
  })

  const color_info = defineTool({
    name: 'color_info',
    description: 'Look up CSS named colors: search by name substring (e.g. "blue" matches blue, blueviolet, '
      + 'lightblue, …) or by value (a hex/rgb/hsl/hwb color, returning every name that maps to that exact color, '
      + 'e.g. aqua and cyan). Returns name, hex, rgb, hsl and relative luminance for each match. '
      + 'With no query, lists the first colors alphabetically.',
    parameters: {
      query: { type: 'string', description: 'Name substring or color value to search for. Omit to list colors.' },
      by: {
        type: 'string',
        enum: ['name', 'value'],
        description: 'How to interpret query: "name" (default) searches CSS color names, "value" matches the exact color value.',
      },
      limit: { type: 'number', description: 'Maximum matches to return (1–50, default 10).' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          ok: { type: 'boolean', required: true },
          error: { type: 'string' },
          query: { type: 'string', required: true },
          by: { type: 'string', required: true, enum: ['name', 'value'] },
          count: { type: 'number', required: true },
          total: { type: 'number', required: true },
          matches: {
            type: 'array',
            required: true,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                name: { type: 'string', required: true },
                hex: { type: 'string', required: true },
                rgb: { type: 'string', required: true },
                hsl: { type: 'string', required: true },
                luminance: { type: 'number', required: true },
              },
            },
          },
        },
      },
      render: (_args: { query?: string; by?: string }, value: unknown) => {
        const result = value as InfoResult
        if (!result.ok) return [{ type: 'text', text: `color_info: ${result.error ?? 'no matches'}` }]
        if (result.count === 0) {
          return [{ type: 'text', text: `no CSS color names match "${result.query}" (of ${result.total})` }]
        }
        const lines = result.matches.map((m) => `  ${m.name.padEnd(20)} ${m.hex.padEnd(9)} ${m.rgb.padEnd(16)} ${m.hsl.padEnd(20)} luminance ${m.luminance}`)
        return [{ type: 'text', text: `${result.count} of ${result.total} colors matching "${result.query}":\n${lines.join('\n')}` }]
      },
    },
    async execute(args: { query?: string; by?: string; limit?: number }): Promise<InfoResult> {
      const by = args.by === 'value' ? 'value' : 'name'
      const limit = Math.min(50, Math.max(1, args.limit ?? 10))
      const query = args.query?.trim() ?? ''

      let matched: { name: string; hex: string }[] = []
      if (by === 'value' && query !== '') {
        const parsed = parseColorInput(query, lookupNamed)
        if (!parsed.ok) {
          return { ok: false, error: parsed.error, query, by, count: 0, total: 0, matches: [] }
        }
        const hex = rgbaToHex({ ...parsed.color.rgba, a: 1 })
        matched = namesByHex(hex.replace(/^#/, '')).map((name) => ({ name, hex }))
      } else if (query !== '') {
        matched = searchNamed(query)
      } else {
        matched = Object.keys(NAMED_COLORS).map((name) => ({ name, hex: `#${lookupNamed(name) ?? ''}` }))
      }

      const rows = matched.slice(0, limit).map((m) => matchRow(m.name, m.hex))
      return { ok: true, query, by, count: matched.length, total: rows.length, matches: rows }
    },
  })

  const color_scheme = defineTool({
    name: 'color_scheme',
    description: 'Generate a harmonious color palette from a base color (any CSS format): complementary, analogous (3 or 5), '
      + 'triadic, split-complementary, tetradic, square, or monochromatic (2–9 shades). Every color is returned as hex, '
      + 'rgb() and hsl(). Rotation harmonies keep the base saturation/lightness and rotate the hue; monochromatic steps '
      + 'lightness around the base. Pure local math, read-only.',
    parameters: {
      input: { type: 'string', required: true, description: 'Base color, in any supported CSS format (hex, rgb(), hsl(), hwb(), or a CSS name).' },
      type: {
        type: 'string',
        enum: ['complementary', 'analogous', 'triadic', 'split-complementary', 'tetradic', 'square', 'monochromatic'],
        description: 'Palette type. Default complementary.',
      },
      count: {
        type: 'number',
        description: 'Number of colors. Only used by analogous (3 or 5, default 3) and monochromatic (2–9, default 5). Ignored by the other types.',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          ok: { type: 'boolean', required: true },
          error: { type: 'string' },
          input: { type: 'string', required: true },
          type: { type: 'string', required: true },
          count: { type: 'number', required: true },
          colors: {
            type: 'array',
            required: true,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                hex: { type: 'string', required: true },
                rgb: { type: 'string', required: true },
                hsl: { type: 'string', required: true },
              },
            },
          },
        },
      },
      render: (_args: { input: string; type?: string; count?: number }, value: unknown) => {
        const result = value as SchemeResult
        if (!result.ok) return [{ type: 'text', text: `color_scheme: ${result.error ?? 'invalid color'}` }]
        const lines = result.colors.map((c) => `  ${c.hex}  ${c.rgb.padEnd(20)}  ${c.hsl}`)
        return [{
          type: 'text',
          text: `${result.type} palette from ${result.input} (${result.count} colors):\n${lines.join('\n')}`,
        }]
      },
    },
    async execute(args: { input: string; type?: string; count?: number }): Promise<SchemeResult> {
      // The enum is validated at the schema layer before execute runs; the
      // fallback here only guards direct programmatic calls.
      const requested = args.type ?? 'complementary'
      const type: HarmonyType = HARMONY_TYPES.includes(requested as HarmonyType)
        ? (requested as HarmonyType)
        : 'complementary'
      const parsed = parseColorInput(args.input, lookupNamed)
      if (!parsed.ok) {
        return { input: args.input, type, count: 0, ok: false, error: parsed.error, colors: [] }
      }
      const count = args.count
      if (type === 'analogous' && count !== undefined && count !== 3 && count !== 5) {
        return {
          input: args.input,
          type,
          count: 0,
          ok: false,
          error: `analogous palettes support 3 or 5 colors, got ${count}`,
          colors: [],
        }
      }
      const { rgba } = parsed.color
      const { h, s, l } = rgbToHsl(rgba.r, rgba.g, rgba.b)
      const triplets = harmonyHsl(h, s, l, type, count)
      const colors = triplets.map((t) => hslToStrings(t.h, t.s, t.l, rgba.a))
      return { input: args.input, type, count: colors.length, ok: true, colors }
    },
  })

  const adjust_color = defineTool({
    name: 'adjust_color',
    description: 'Adjust a color: lighten or darken by N percentage points, saturate or desaturate by N percentage points, '
      + 'or rotate the hue by N degrees. Returns the adjusted color as hex, rgb() and hsl(). Saturating an achromatic '
      + 'color (gray) is a no-op, matching CSS filter semantics. Pure local math, read-only.',
    parameters: {
      input: { type: 'string', required: true, description: 'The color to adjust, in any supported CSS format.' },
      op: {
        type: 'string',
        required: true,
        enum: ['lighten', 'darken', 'saturate', 'desaturate', 'hue'],
        description: 'Operation to apply. "hue" rotates the hue; the others shift lightness/saturation.',
      },
      amount: {
        type: 'number',
        required: true,
        description: 'For lighten/darken/saturate/desaturate: percentage points (0–100). For hue: rotation degrees (negative ok, normalized).',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          ok: { type: 'boolean', required: true },
          error: { type: 'string' },
          input: { type: 'string', required: true },
          op: { type: 'string', required: true },
          amount: { type: 'number', required: true },
          hex: { type: 'string' },
          rgb: { type: 'string' },
          hsl: { type: 'string' },
        },
      },
      render: (_args: { input: string; op: string; amount: number }, value: unknown) => {
        const result = value as AdjustResult
        if (!result.ok) return [{ type: 'text', text: `adjust_color: ${result.error ?? 'invalid color'}` }]
        const pieces = [`${result.input} ${result.op} ${result.amount} =`]
        if (result.hex !== undefined) pieces.push(result.hex)
        if (result.rgb !== undefined) pieces.push(result.rgb)
        if (result.hsl !== undefined) pieces.push(result.hsl)
        return [{ type: 'text', text: pieces.join(' ') }]
      },
    },
    async execute(args: { input: string; op: string; amount: number }): Promise<AdjustResult> {
      // The enum is validated at the schema layer; fallback guards direct calls.
      const op: AdjustOp = ADJUST_OPS.includes(args.op as AdjustOp) ? (args.op as AdjustOp) : 'lighten'
      const amount = args.amount
      const parsed = parseColorInput(args.input, lookupNamed)
      if (!parsed.ok) return { input: args.input, op, amount, ok: false, error: parsed.error }
      const { rgba } = parsed.color
      const { h, s, l } = rgbToHsl(rgba.r, rgba.g, rgba.b)
      const adjusted = adjustHsl(h, s, l, op, amount)
      const strings = hslToStrings(adjusted.h, adjusted.s, adjusted.l, rgba.a)
      return { input: args.input, op, amount, ok: true, hex: strings.hex, rgb: strings.rgb, hsl: strings.hsl }
    },
  })

  return { convert_color, contrast_ratio, color_info, color_scheme, adjust_color }
}
