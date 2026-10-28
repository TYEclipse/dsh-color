/**
 * Tool definitions for dsh-color: three pure-math color tools exposed to every
 * agent via defineTool. No network, no filesystem — everything is computed
 * locally from the input string.
 *
 * @module dsh-color/tools
 */
import { defineTool } from '@deepseek-ai/dsh-tools';
import { adjustHsl, ADJUST_OPS, blendMix, blendOver, BLEND_MODES, CONTRAST_DIRECTIONS, colorScale, contrastRatio, CVD_MAX_SEVERITY, CVD_MIN_SEVERITY, CVD_TYPES, deltaE2000, deltaE76, differenceVerdict, ensureContrast, harmonyHsl, HARMONY_TYPES, hslToRgb, parseColorInput, relativeLuminance, rgbaToHex, rgbaToHslString, rgbaToHwbString, rgbaToLab, rgbaToRgbString, rgbToHsl, round, roundOut, SCALE_MAX_STEPS, SCALE_MIN_STEPS, SCALE_MODES, SCALE_SPACES, simulateCvd, wcagLevel, } from "./color.js";
import { lookupNamed, NAMED_COLORS, namesByHex, searchNamed } from "./named.js";
/** Upper bound on colors per cvd_simulate call (keeps the pair list readable). */
export const CVD_MAX_COLORS = 6;
/** Turn an HSL triplet into the three string formats, keeping alpha. */
function hslToStrings(h, s, l, a) {
    const rgb = hslToRgb(h, s, l);
    const rgba = { r: rgb.r, g: rgb.g, b: rgb.b, a };
    return { hex: rgbaToHex(rgba), rgb: rgbaToRgbString(rgba), hsl: rgbaToHslString(rgba) };
}
function matchRow(name, hex) {
    const rgba = parseHexStrict(hex);
    return {
        name,
        hex,
        rgb: rgbaToRgbString(rgba),
        hsl: rgbaToHslString(rgba),
        luminance: round(relativeLuminance(rgba), 4),
    };
}
/** Parse a hex string we know is valid (from the named table). */
function parseHexStrict(hex) {
    const parsed = parseColorInput(hex, () => undefined);
    if (!parsed.ok)
        return { r: 0, g: 0, b: 0, a: 1 };
    return parsed.color.rgba;
}
/** Build all three tool definitions. */
export function buildColorTools() {
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
            render: (_args, value) => {
                const result = value;
                if (!result.ok)
                    return [{ type: 'text', text: `convert_color: ${result.error ?? 'invalid color'}` }];
                const parts = [`${result.input} =`];
                if (result.name !== undefined)
                    parts.push(`named "${result.name}",`);
                if (result.hex !== undefined)
                    parts.push(result.hex);
                if (result.rgb !== undefined)
                    parts.push(result.rgb);
                if (result.hsl !== undefined)
                    parts.push(result.hsl);
                if (result.hwb !== undefined)
                    parts.push(result.hwb);
                if (result.alpha < 1)
                    parts.push(`alpha ${result.alpha}`);
                return [{ type: 'text', text: parts.join(' ') }];
            },
        },
        async execute(args) {
            const format = args.format ?? 'all';
            const parsed = parseColorInput(args.input, lookupNamed);
            if (!parsed.ok)
                return { input: args.input, ok: false, error: parsed.error, alpha: 1 };
            const { rgba, name } = parsed.color;
            // Assign keys only when present: JSON round-trips are lossy when a key
            // holds `undefined` (dsh-tools output gate rejects "not lossless JSON").
            const result = { input: args.input, ok: true, alpha: round(rgba.a, 3) };
            if (name !== undefined)
                result.name = name;
            if (format === 'all' || format === 'hex')
                result.hex = rgbaToHex(rgba);
            if (format === 'all' || format === 'rgb')
                result.rgb = rgbaToRgbString(rgba);
            if (format === 'all' || format === 'hsl')
                result.hsl = rgbaToHslString(rgba);
            if (format === 'all' || format === 'hwb')
                result.hwb = rgbaToHwbString(rgba);
            return result;
        },
    });
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
            render: (_args, value) => {
                const result = value;
                if (!result.ok)
                    return [{ type: 'text', text: `contrast_ratio: ${result.error ?? 'invalid color'}` }];
                const size = result.largeText ? 'large' : 'normal';
                return [{
                        type: 'text',
                        text: `contrast ${result.color1} vs ${result.color2} = ${result.ratio}:1 — ${result.level} for ${size} text (AA ${result.aa === true ? 'pass' : 'fail'}, AAA ${result.aaa === true ? 'pass' : 'fail'})`,
                    }];
            },
        },
        async execute(args) {
            const largeText = args.textSize === 'large';
            const first = parseColorInput(args.color1, lookupNamed);
            if (!first.ok)
                return { color1: args.color1, color2: args.color2, ok: false, error: first.error, largeText };
            const second = parseColorInput(args.color2, lookupNamed);
            if (!second.ok)
                return { color1: args.color1, color2: args.color2, ok: false, error: second.error, largeText };
            const ratio = round(contrastRatio(first.color.rgba, second.color.rgba), 2);
            const level = wcagLevel(ratio, largeText);
            return {
                color1: args.color1,
                color2: args.color2,
                ok: true,
                ratio,
                aa: ratio >= (largeText ? 3 : 4.5),
                aaa: ratio >= (largeText ? 4.5 : 7),
                level,
                largeText,
            };
        },
    });
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
            render: (_args, value) => {
                const result = value;
                if (!result.ok)
                    return [{ type: 'text', text: `color_info: ${result.error ?? 'no matches'}` }];
                if (result.count === 0) {
                    return [{ type: 'text', text: `no CSS color names match "${result.query}" (of ${result.total})` }];
                }
                const lines = result.matches.map((m) => `  ${m.name.padEnd(20)} ${m.hex.padEnd(9)} ${m.rgb.padEnd(16)} ${m.hsl.padEnd(20)} luminance ${m.luminance}`);
                return [{ type: 'text', text: `${result.count} of ${result.total} colors matching "${result.query}":\n${lines.join('\n')}` }];
            },
        },
        async execute(args) {
            const by = args.by === 'value' ? 'value' : 'name';
            const limit = Math.min(50, Math.max(1, args.limit ?? 10));
            const query = args.query?.trim() ?? '';
            let matched = [];
            if (by === 'value' && query !== '') {
                const parsed = parseColorInput(query, lookupNamed);
                if (!parsed.ok) {
                    return { ok: false, error: parsed.error, query, by, count: 0, total: 0, matches: [] };
                }
                const hex = rgbaToHex({ ...parsed.color.rgba, a: 1 });
                matched = namesByHex(hex.replace(/^#/, '')).map((name) => ({ name, hex }));
            }
            else if (query !== '') {
                matched = searchNamed(query);
            }
            else {
                matched = Object.keys(NAMED_COLORS).map((name) => ({ name, hex: `#${lookupNamed(name) ?? ''}` }));
            }
            const rows = matched.slice(0, limit).map((m) => matchRow(m.name, m.hex));
            return { ok: true, query, by, count: matched.length, total: rows.length, matches: rows };
        },
    });
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
            render: (_args, value) => {
                const result = value;
                if (!result.ok)
                    return [{ type: 'text', text: `color_scheme: ${result.error ?? 'invalid color'}` }];
                const lines = result.colors.map((c) => `  ${c.hex}  ${c.rgb.padEnd(20)}  ${c.hsl}`);
                return [{
                        type: 'text',
                        text: `${result.type} palette from ${result.input} (${result.count} colors):\n${lines.join('\n')}`,
                    }];
            },
        },
        async execute(args) {
            // The enum is validated at the schema layer before execute runs; the
            // fallback here only guards direct programmatic calls.
            const requested = args.type ?? 'complementary';
            const type = HARMONY_TYPES.includes(requested)
                ? requested
                : 'complementary';
            const parsed = parseColorInput(args.input, lookupNamed);
            if (!parsed.ok) {
                return { input: args.input, type, count: 0, ok: false, error: parsed.error, colors: [] };
            }
            const count = args.count;
            if (type === 'analogous' && count !== undefined && count !== 3 && count !== 5) {
                return {
                    input: args.input,
                    type,
                    count: 0,
                    ok: false,
                    error: `analogous palettes support 3 or 5 colors, got ${count}`,
                    colors: [],
                };
            }
            const { rgba } = parsed.color;
            const { h, s, l } = rgbToHsl(rgba.r, rgba.g, rgba.b);
            const triplets = harmonyHsl(h, s, l, type, count);
            const colors = triplets.map((t) => hslToStrings(t.h, t.s, t.l, rgba.a));
            return { input: args.input, type, count: colors.length, ok: true, colors };
        },
    });
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
            render: (_args, value) => {
                const result = value;
                if (!result.ok)
                    return [{ type: 'text', text: `adjust_color: ${result.error ?? 'invalid color'}` }];
                const pieces = [`${result.input} ${result.op} ${result.amount} =`];
                if (result.hex !== undefined)
                    pieces.push(result.hex);
                if (result.rgb !== undefined)
                    pieces.push(result.rgb);
                if (result.hsl !== undefined)
                    pieces.push(result.hsl);
                return [{ type: 'text', text: pieces.join(' ') }];
            },
        },
        async execute(args) {
            // The enum is validated at the schema layer; fallback guards direct calls.
            const op = ADJUST_OPS.includes(args.op) ? args.op : 'lighten';
            const amount = args.amount;
            const parsed = parseColorInput(args.input, lookupNamed);
            if (!parsed.ok)
                return { input: args.input, op, amount, ok: false, error: parsed.error };
            const { rgba } = parsed.color;
            const { h, s, l } = rgbToHsl(rgba.r, rgba.g, rgba.b);
            const adjusted = adjustHsl(h, s, l, op, amount);
            const strings = hslToStrings(adjusted.h, adjusted.s, adjusted.l, rgba.a);
            return { input: args.input, op, amount, ok: true, hex: strings.hex, rgb: strings.rgb, hsl: strings.hsl };
        },
    });
    const blend_colors = defineTool({
        name: 'blend_colors',
        description: 'Blend two colors. Mode "over" paints the first color on top of the second with proper alpha '
            + 'compositing (what a browser shows for a translucent overlay over a backdrop) and returns the visible color; '
            + 'mode "mix" interpolates the two colors in premultiplied sRGB, the same math as CSS color-mix(in srgb, …), '
            + 'with "weight" setting how much of the second color goes in. Useful for hover tints, semi-transparent panels, '
            + 'gradient midpoints and checking what a 12% white overlay actually looks like. Pure local math, read-only.',
        parameters: {
            foreground: { type: 'string', required: true, description: 'Top color for "over" (the source), first color for "mix". Any CSS format.' },
            background: { type: 'string', required: true, description: 'Backdrop for "over", second color for "mix". Any CSS format.' },
            mode: {
                type: 'string',
                enum: ['over', 'mix'],
                description: 'Blend mode: "over" (default) = alpha compositing with the first color on top, "mix" = premultiplied interpolation.',
            },
            weight: {
                type: 'number',
                description: 'For "mix" only: weight of the background color, 0–1 (default 0.5). Ignored by "over".',
            },
        },
        output: {
            schema: {
                type: 'object',
                additionalProperties: false,
                properties: {
                    ok: { type: 'boolean', required: true },
                    error: { type: 'string' },
                    foreground: { type: 'string', required: true },
                    background: { type: 'string', required: true },
                    mode: { type: 'string', required: true },
                    weight: { type: 'number' },
                    hex: { type: 'string' },
                    rgb: { type: 'string' },
                    hsl: { type: 'string' },
                    alpha: { type: 'number' },
                },
            },
            render: (_args, value) => {
                const result = value;
                if (!result.ok)
                    return [{ type: 'text', text: `blend_colors: ${result.error ?? 'invalid color'}` }];
                const head = result.mode === 'mix'
                    ? `${result.foreground} mix ${result.weight ?? 0.5} ${result.background} =`
                    : `${result.foreground} over ${result.background} =`;
                const parts = [head];
                if (result.hex !== undefined)
                    parts.push(result.hex);
                if (result.rgb !== undefined)
                    parts.push(result.rgb);
                if (result.hsl !== undefined)
                    parts.push(result.hsl);
                if (result.alpha !== undefined && result.alpha < 1)
                    parts.push(`alpha ${result.alpha}`);
                return [{ type: 'text', text: parts.join(' ') }];
            },
        },
        async execute(args) {
            // The enum is validated at the schema layer; the guard covers direct calls.
            const mode = BLEND_MODES.includes(args.mode) ? args.mode : 'over';
            const weight = typeof args.weight === 'number' ? Math.min(1, Math.max(0, args.weight)) : 0.5;
            const top = parseColorInput(args.foreground, lookupNamed);
            if (!top.ok)
                return { foreground: args.foreground, background: args.background, mode, ok: false, error: `foreground: ${top.error}` };
            const bottom = parseColorInput(args.background, lookupNamed);
            if (!bottom.ok)
                return { foreground: args.foreground, background: args.background, mode, ok: false, error: `background: ${bottom.error}` };
            const blended = mode === 'mix'
                ? blendMix(top.color.rgba, bottom.color.rgba, weight)
                : blendOver(top.color.rgba, bottom.color.rgba);
            const result = {
                foreground: args.foreground,
                background: args.background,
                mode,
                ok: true,
                hex: rgbaToHex(blended),
                rgb: rgbaToRgbString(blended),
                hsl: rgbaToHslString(blended),
                alpha: round(blended.a, 3),
            };
            if (mode === 'mix')
                result.weight = weight;
            return result;
        },
    });
    const ensure_contrast = defineTool({
        name: 'ensure_contrast',
        description: 'Make text readable: return the color closest to the given foreground that reaches a WCAG contrast '
            + 'target on the given background. Hue and saturation are kept and only lightness moves, toward black or white '
            + '(auto-picked by which direction can gain the most contrast). Reports the ratio before and after and how far '
            + 'lightness had to move. When the target is impossible on that background, it says so and gives the best '
            + 'achievable ratio instead of guessing. Pure local math, read-only.',
        parameters: {
            foreground: { type: 'string', required: true, description: 'The text color to fix, in any supported CSS format.' },
            background: { type: 'string', required: true, description: 'The background it sits on, in any supported CSS format.' },
            level: {
                type: 'string',
                enum: ['AA', 'AAA'],
                description: 'WCAG level to reach: AA (default) = 4.5:1, AAA = 7:1; large text lowers both to 3:1 / 4.5:1.',
            },
            largeText: { type: 'boolean', description: 'Set true for large text (≥18pt, or ≥14pt bold), which requires less contrast.' },
            direction: {
                type: 'string',
                enum: ['auto', 'darken', 'lighten'],
                description: 'Which way to move lightness: "auto" (default) picks the direction with the higher achievable contrast.',
            },
        },
        output: {
            schema: {
                type: 'object',
                additionalProperties: false,
                properties: {
                    ok: { type: 'boolean', required: true },
                    error: { type: 'string' },
                    foreground: { type: 'string', required: true },
                    background: { type: 'string', required: true },
                    level: { type: 'string', required: true },
                    largeText: { type: 'boolean', required: true },
                    target: { type: 'number', required: true },
                    direction: { type: 'string', required: true },
                    inputRatio: { type: 'number' },
                    changed: { type: 'boolean' },
                    hex: { type: 'string' },
                    rgb: { type: 'string' },
                    hsl: { type: 'string' },
                    ratio: { type: 'number' },
                    lightnessShift: { type: 'number' },
                    bestHex: { type: 'string' },
                    bestRatio: { type: 'number' },
                },
            },
            render: (_args, value) => {
                const result = value;
                if (result.hex === undefined && result.bestHex === undefined) {
                    return [{ type: 'text', text: `ensure_contrast: ${result.error ?? 'invalid color'}` }];
                }
                const head = `${result.foreground} on ${result.background} (${result.level}${result.largeText ? ' large' : ''} ${result.target}:1)`;
                if (result.bestHex !== undefined) {
                    return [{
                            type: 'text',
                            text: `${head}: ${result.error ?? 'target unreachable'} — best ${result.bestHex} at ${result.bestRatio ?? 0}:1`,
                        }];
                }
                if (result.changed === false) {
                    return [{ type: 'text', text: `${head}: ${result.hex} already reaches ${result.ratio ?? 0}:1, no change needed` }];
                }
                return [{
                        type: 'text',
                        text: `${head}: ${result.hex} reaches ${result.ratio ?? 0}:1 (${result.direction} ${round(result.lightnessShift ?? 0, 1)}pp)`,
                    }];
            },
        },
        async execute(args) {
            const level = args.level === 'AAA' ? 'AAA' : 'AA';
            const largeText = args.largeText === true;
            const direction = CONTRAST_DIRECTIONS.includes(args.direction)
                ? args.direction
                : 'auto';
            const target = level === 'AAA' ? (largeText ? 4.5 : 7) : (largeText ? 3 : 4.5);
            const base = {
                ok: false,
                foreground: args.foreground,
                background: args.background,
                level,
                largeText,
                target,
                direction: direction === 'auto' ? 'auto' : direction,
            };
            const text = parseColorInput(args.foreground, lookupNamed);
            if (!text.ok)
                return { ...base, error: `foreground: ${text.error}` };
            const plate = parseColorInput(args.background, lookupNamed);
            if (!plate.ok)
                return { ...base, error: `background: ${plate.error}` };
            const fix = ensureContrast(text.color.rgba, plate.color.rgba, target, direction);
            base.direction = fix.direction;
            base.inputRatio = round(contrastRatio(text.color.rgba, plate.color.rgba), 2);
            if (!fix.ok) {
                const best = fix.bestRgba ?? plate.color.rgba;
                return {
                    ...base,
                    error: `target ${target}:1 unreachable on ${args.background} — best ${round(fix.bestRatio ?? 1, 2)}:1 by ${fix.direction}`,
                    bestHex: rgbaToHex(best),
                    bestRatio: round(fix.bestRatio ?? 1, 2),
                };
            }
            const fixed = fix.rgba ?? text.color.rgba;
            return {
                ...base,
                ok: true,
                changed: fix.changed,
                hex: rgbaToHex(fixed),
                rgb: rgbaToRgbString(fixed),
                hsl: rgbaToHslString(fixed),
                ratio: round(fix.ratio ?? base.inputRatio ?? 1, 2),
                lightnessShift: round(fix.lightnessShift ?? 0, 2),
            };
        },
    });
    const color_difference = defineTool({
        name: 'color_difference',
        description: 'Say how different two colors look, numerically and in plain words. Returns the CIEDE2000 '
            + 'difference (the industry standard perceptual metric used by print, paint and brand-guide QA) plus the '
            + 'older CIE76 Euclidean difference, both colors\' CIELAB coordinates, a plain-language verdict '
            + '(identical / barely-perceptible / perceptible / different / very-different) and whether the pair stays '
            + 'within a tolerance you set. Use it to check "is this really the same brand color?", to compare a '
            + 'screenshot against a spec, or to pick the nearest match from a palette. Lab uses the D65 white point '
            + 'and alpha is ignored (the visible channels are compared). Pure local math, read-only.',
        parameters: {
            color1: { type: 'string', required: true, description: 'First color, in any supported CSS format.' },
            color2: { type: 'string', required: true, description: 'Second color, in any supported CSS format.' },
            method: {
                type: 'string',
                enum: ['de2000', 'de76'],
                description: 'Which difference to report as "deltaE": "de2000" (default, perceptual) or "de76" (plain Lab distance). Both are always returned.',
            },
            threshold: {
                type: 'number',
                description: 'Tolerance for the "similar" flag, in ΔE00 units (0–100, default 2 = the usual "same color" tolerance for print and UI).',
            },
        },
        output: {
            schema: {
                type: 'object',
                additionalProperties: false,
                properties: {
                    ok: { type: 'boolean', required: true },
                    error: { type: 'string' },
                    color1: { type: 'string', required: true },
                    color2: { type: 'string', required: true },
                    method: { type: 'string', required: true, enum: ['de2000', 'de76'] },
                    deltaE: { type: 'number', required: true },
                    deltaE2000: { type: 'number', required: true },
                    deltaE76: { type: 'number', required: true },
                    lab1: {
                        type: 'object',
                        required: true,
                        additionalProperties: false,
                        properties: {
                            l: { type: 'number', required: true },
                            a: { type: 'number', required: true },
                            b: { type: 'number', required: true },
                        },
                    },
                    lab2: {
                        type: 'object',
                        required: true,
                        additionalProperties: false,
                        properties: {
                            l: { type: 'number', required: true },
                            a: { type: 'number', required: true },
                            b: { type: 'number', required: true },
                        },
                    },
                    threshold: { type: 'number', required: true },
                    similar: { type: 'boolean', required: true },
                    verdict: { type: 'string', required: true },
                },
            },
            render: (_args, value) => {
                const result = value;
                if (!result.ok)
                    return [{ type: 'text', text: `color_difference: ${result.error ?? 'invalid color'}` }];
                const head = `${result.color1} vs ${result.color2}: ΔE00 ${result.deltaE2000} (ΔE76 ${result.deltaE76}) — ${result.verdict}`;
                return [{
                        type: 'text',
                        text: result.similar ? `${head}, within ${result.threshold}` : `${head}, beyond ${result.threshold}`,
                    }];
            },
        },
        async execute(args) {
            // The enum is validated at the schema layer; the guard covers direct calls.
            const method = args.method === 'de76' ? 'de76' : 'de2000';
            const threshold = typeof args.threshold === 'number' ? roundOut(Math.min(100, Math.max(0, args.threshold)), 4) : 2;
            const first = parseColorInput(args.color1, lookupNamed);
            if (!first.ok) {
                return {
                    ok: false,
                    error: `color1: ${first.error}`,
                    color1: args.color1,
                    color2: args.color2,
                    method,
                    deltaE: 0,
                    deltaE2000: 0,
                    deltaE76: 0,
                    lab1: { l: 0, a: 0, b: 0 },
                    lab2: { l: 0, a: 0, b: 0 },
                    threshold,
                    similar: false,
                    verdict: 'unknown',
                };
            }
            const second = parseColorInput(args.color2, lookupNamed);
            if (!second.ok) {
                return {
                    ok: false,
                    error: `color2: ${second.error}`,
                    color1: args.color1,
                    color2: args.color2,
                    method,
                    deltaE: 0,
                    deltaE2000: 0,
                    deltaE76: 0,
                    lab1: { l: 0, a: 0, b: 0 },
                    lab2: { l: 0, a: 0, b: 0 },
                    threshold,
                    similar: false,
                    verdict: 'unknown',
                };
            }
            const lab1 = rgbaToLab(first.color.rgba);
            const lab2 = rgbaToLab(second.color.rgba);
            const de2000 = roundOut(deltaE2000(lab1, lab2), 4);
            const de76 = roundOut(deltaE76(lab1, lab2), 4);
            return {
                ok: true,
                color1: args.color1,
                color2: args.color2,
                method,
                deltaE: method === 'de76' ? de76 : de2000,
                deltaE2000: de2000,
                deltaE76: de76,
                lab1: { l: roundOut(lab1.l, 4), a: roundOut(lab1.a, 4), b: roundOut(lab1.b, 4) },
                lab2: { l: roundOut(lab2.l, 4), a: roundOut(lab2.a, 4), b: roundOut(lab2.b, 4) },
                threshold,
                similar: de2000 <= threshold,
                verdict: differenceVerdict(de2000),
            };
        },
    });
    const color_scale = defineTool({
        name: 'color_scale',
        description: 'Build an evenly spaced color ramp from a base color — the tint/shade scale a design system needs. '
            + 'Modes: "tints" (base → white), "shades" (base → black), "both" (black → base → white) and "between" '
            + '(base → a second color). By default the steps are interpolated in Oklab, so the ramp is even to the eye '
            + 'instead of bunched up in the shadows; pass space "srgb" for plain channel interpolation (what CSS '
            + 'gradients and color-mix(in srgb) do). Each step comes back as hex, rgb() and hsl() plus its ΔE00 distance '
            + 'from the base, so you can see how far the ramp has travelled. Pure local math, read-only.',
        parameters: {
            input: { type: 'string', required: true, description: 'Base color, in any supported CSS format.' },
            mode: {
                type: 'string',
                enum: ['tints', 'shades', 'both', 'between'],
                description: 'Ramp shape: "tints" (default), "shades", "both" (black → base → white) or "between" (needs the `to` color).',
            },
            steps: {
                type: 'number',
                description: `Number of colors in the ramp (${SCALE_MIN_STEPS}–${SCALE_MAX_STEPS}, default 5). The base color is the first step for tints/shades/between; for "both" an odd count puts it exactly in the middle.`,
            },
            to: { type: 'string', description: 'Second color, required by mode "between". Ignored by the other modes.' },
            space: {
                type: 'string',
                enum: ['oklab', 'srgb'],
                description: 'Interpolation space: "oklab" (default) is perceptually even, "srgb" interpolates raw channel values.',
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
                    to: { type: 'string' },
                    mode: { type: 'string', required: true },
                    space: { type: 'string', required: true },
                    steps: { type: 'number', required: true },
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
                                deltaE00: { type: 'number', required: true },
                            },
                        },
                    },
                },
            },
            render: (_args, value) => {
                const result = value;
                if (!result.ok)
                    return [{ type: 'text', text: `color_scale: ${result.error ?? 'invalid color'}` }];
                const lines = result.colors.map((c) => `  ${c.hex}  ${c.rgb.padEnd(20)}  ${c.hsl.padEnd(26)}  ΔE00 ${c.deltaE00}`);
                const target = result.to === undefined ? '' : ` → ${result.to}`;
                return [{
                        type: 'text',
                        text: `${result.mode} scale from ${result.input}${target} in ${result.space} (${result.count} colors):\n${lines.join('\n')}`,
                    }];
            },
        },
        async execute(args) {
            // The enums are validated at the schema layer; the guards cover direct calls.
            const mode = SCALE_MODES.includes(args.mode) ? args.mode : 'tints';
            const space = SCALE_SPACES.includes(args.space) ? args.space : 'oklab';
            const steps = typeof args.steps === 'number'
                ? Math.min(SCALE_MAX_STEPS, Math.max(SCALE_MIN_STEPS, Math.trunc(args.steps)))
                : 5;
            const base = { ok: false, input: args.input, mode, space, steps, count: 0, colors: [] };
            const from = parseColorInput(args.input, lookupNamed);
            if (!from.ok)
                return { ...base, ok: false, error: from.error };
            let target;
            if (mode === 'between') {
                if (args.to === undefined || args.to.trim() === '') {
                    return { ...base, ok: false, error: 'mode "between" needs the `to` color' };
                }
                const parsed = parseColorInput(args.to, lookupNamed);
                if (!parsed.ok)
                    return { ...base, ok: false, error: `to: ${parsed.error}` };
                target = parsed.color.rgba;
                base.to = args.to;
            }
            const baseLab = rgbaToLab(from.color.rgba);
            const colors = colorScale(from.color.rgba, target, mode, steps, space).map((rgba) => ({
                hex: rgbaToHex(rgba),
                rgb: rgbaToRgbString(rgba),
                hsl: rgbaToHslString(rgba),
                deltaE00: roundOut(deltaE2000(baseLab, rgbaToLab(rgba)), 4),
            }));
            return { ...base, ok: true, count: colors.length, colors };
        },
    });
    const cvd_simulate = defineTool({
        name: 'cvd_simulate',
        description: 'Show how colors look to someone with color-vision deficiency (CVD), and whether a palette '
            + 'survives it. Simulates protan / deutan / tritan vision with the Machado, Oliveira & Fernandes (2009) '
            + 'model, whose published severity table runs from 0 (normal vision) to 1 (dichromacy); severities in '
            + 'between are interpolated between the two nearest published matrices. Each input color comes back as the '
            + 'simulated hex, rgb() and its ΔE00 shift, and when you pass several colors the tool also reports every '
            + 'pair\'s ΔE00 before and after — flagging the pairs that become indistinguishable (below your threshold), '
            + 'which is the question a chart legend or a status palette actually has to answer. Alpha is ignored '
            + '(simulation is about hue/chroma, not transparency) and out-of-gamut results are clamped with a flag, '
            + 'since the clamped color is what a screen shows. Pure local math, read-only.',
        parameters: {
            colors: {
                type: 'array',
                required: true,
                items: { type: 'string' },
                description: `The colors to simulate, in any supported CSS format (1–${CVD_MAX_COLORS}). Pass a whole `
                    + 'palette to get the pairwise collapse analysis.',
            },
            type: {
                type: 'string',
                enum: ['deutan', 'protan', 'tritan'],
                description: 'Deficiency class: "deutan" (default — the most common, red/green M-cone), "protan" (red/green L-cone) or "tritan" (blue/yellow S-cone).',
            },
            severity: {
                type: 'number',
                description: 'How severe, 0–1 (default 1 = dichromacy, the complete form; 0.5 ≈ moderate anomalous trichromacy).',
            },
            threshold: {
                type: 'number',
                description: 'ΔE00 below which two colors count as indistinguishable (0–100, default 2 — the usual "same color" tolerance).',
            },
        },
        output: {
            schema: {
                type: 'object',
                additionalProperties: false,
                properties: {
                    ok: { type: 'boolean', required: true },
                    error: { type: 'string' },
                    type: { type: 'string', required: true, enum: ['deutan', 'protan', 'tritan'] },
                    severity: { type: 'number', required: true },
                    threshold: { type: 'number', required: true },
                    count: { type: 'number', required: true },
                    clamped: { type: 'boolean', required: true },
                    confusablePairs: { type: 'number', required: true },
                    note: { type: 'string' },
                    colors: {
                        type: 'array',
                        required: true,
                        items: {
                            type: 'object',
                            additionalProperties: false,
                            properties: {
                                input: { type: 'string', required: true },
                                hex: { type: 'string', required: true },
                                rgb: { type: 'string', required: true },
                                deltaE00: { type: 'number', required: true },
                                clamped: { type: 'boolean', required: true },
                            },
                        },
                    },
                    pairs: {
                        type: 'array',
                        required: true,
                        items: {
                            type: 'object',
                            additionalProperties: false,
                            properties: {
                                a: { type: 'string', required: true },
                                b: { type: 'string', required: true },
                                before: { type: 'number', required: true },
                                after: { type: 'number', required: true },
                                collapse: { type: 'boolean', required: true },
                            },
                        },
                    },
                    worstPair: {
                        type: 'object',
                        additionalProperties: false,
                        properties: {
                            a: { type: 'string', required: true },
                            b: { type: 'string', required: true },
                            after: { type: 'number', required: true },
                        },
                    },
                },
            },
            render: (_args, value) => {
                const result = value;
                if (!result.ok)
                    return [{ type: 'text', text: `cvd_simulate: ${result.error ?? 'invalid color'}` }];
                const lines = result.colors.map((c) => `  ${c.input} → ${c.hex}  ${c.rgb.padEnd(20)}  ΔE00 ${c.deltaE00}${c.clamped ? '  (clamped)' : ''}`);
                const pairLines = result.pairs.map((p) => {
                    const tail = p.collapse ? `collapsed below ${result.threshold}` : 'still distinguishable';
                    return `  ${p.a} vs ${p.b}: ΔE00 ${p.before} → ${p.after} — ${tail}`;
                });
                const head = `${result.type} severity ${result.severity} (${result.count} color${result.count === 1 ? '' : 's'})`;
                const tail = pairLines.length === 0 ? [] : ['', ...pairLines];
                return [{ type: 'text', text: `${head}:\n${lines.join('\n')}${tail.length === 0 ? '' : `\n${tail.join('\n')}`}` }];
            },
        },
        async execute(args) {
            // The enums are validated at the schema layer; the guards cover direct calls.
            const type = CVD_TYPES.includes(args.type) ? args.type : 'deutan';
            const severity = typeof args.severity === 'number'
                ? roundOut(Math.min(CVD_MAX_SEVERITY, Math.max(CVD_MIN_SEVERITY, args.severity)), 4)
                : 1;
            const threshold = typeof args.threshold === 'number' ? roundOut(Math.min(100, Math.max(0, args.threshold)), 4) : 2;
            const inputs = Array.isArray(args.colors) ? args.colors : [];
            const base = {
                ok: false,
                type,
                severity,
                threshold,
                count: 0,
                colors: [],
                pairs: [],
                confusablePairs: 0,
                clamped: false,
            };
            if (inputs.length === 0)
                return { ...base, error: 'give at least one color' };
            if (inputs.length > CVD_MAX_COLORS) {
                return { ...base, error: `at most ${CVD_MAX_COLORS} colors per call (got ${inputs.length})` };
            }
            const parsed = [];
            let invalid;
            for (const [index, input] of inputs.entries()) {
                const result = parseColorInput(input, lookupNamed);
                if (!result.ok) {
                    invalid = `colors[${index}]: ${result.error}`;
                    break;
                }
                parsed.push({ input, rgba: result.color.rgba });
            }
            if (invalid !== undefined)
                return { ...base, error: invalid };
            const rows = parsed.map((entry) => ({ entry, sim: simulateCvd(entry.rgba, type, severity) }));
            const colors = rows.map(({ entry, sim }) => ({
                input: entry.input,
                hex: rgbaToHex(sim.rgba),
                rgb: rgbaToRgbString(sim.rgba),
                deltaE00: roundOut(deltaE2000(rgbaToLab(entry.rgba), rgbaToLab(sim.rgba)), 4),
                clamped: sim.clamped,
            }));
            const pairs = [];
            for (const [index, first] of rows.entries()) {
                for (const second of rows.slice(index + 1)) {
                    const before = roundOut(deltaE2000(rgbaToLab(first.entry.rgba), rgbaToLab(second.entry.rgba)), 4);
                    const after = roundOut(deltaE2000(rgbaToLab(first.sim.rgba), rgbaToLab(second.sim.rgba)), 4);
                    pairs.push({
                        a: first.entry.input,
                        b: second.entry.input,
                        before,
                        after,
                        // "Collapse" is the regression that matters: distinguishable before, not after.
                        collapse: before >= threshold && after < threshold,
                    });
                }
            }
            const confusablePairs = pairs.filter((pair) => pair.collapse).length;
            let worstPair;
            for (const pair of pairs) {
                if (pair.before < threshold)
                    continue;
                if (worstPair === undefined || pair.after < worstPair.after) {
                    worstPair = { a: pair.a, b: pair.b, after: pair.after };
                }
            }
            const clamped = rows.some((row) => row.sim.clamped);
            let note;
            if (confusablePairs > 0) {
                note = `${confusablePairs} of ${pairs.length} pair${pairs.length === 1 ? '' : 's'} drop below ΔE00 ${threshold} under this simulation`;
            }
            else if (pairs.length > 0) {
                note = `every pair stays at or above ΔE00 ${threshold} under this simulation`;
            }
            else {
                note = 'one color only — pass a palette to get the pairwise collapse check';
            }
            return {
                ...base,
                ok: true,
                count: colors.length,
                colors,
                pairs,
                confusablePairs,
                ...(worstPair === undefined ? {} : { worstPair }),
                clamped,
                note,
            };
        },
    });
    return {
        convert_color,
        contrast_ratio,
        color_info,
        color_scheme,
        adjust_color,
        blend_colors,
        ensure_contrast,
        color_difference,
        color_scale,
        cvd_simulate,
    };
}
//# sourceMappingURL=tools.js.map