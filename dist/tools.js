/**
 * Tool definitions for dsh-color: three pure-math color tools exposed to every
 * agent via defineTool. No network, no filesystem — everything is computed
 * locally from the input string.
 *
 * @module dsh-color/tools
 */
import { defineTool } from '@deepseek-ai/dsh-tools';
import { contrastRatio, parseColorInput, relativeLuminance, rgbaToHex, rgbaToHslString, rgbaToHwbString, rgbaToRgbString, round, wcagLevel, } from "./color.js";
import { lookupNamed, NAMED_COLORS, namesByHex, searchNamed } from "./named.js";
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
    return { convert_color, contrast_ratio, color_info };
}
//# sourceMappingURL=tools.js.map