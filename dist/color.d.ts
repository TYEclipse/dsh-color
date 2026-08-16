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
    r: number;
    g: number;
    b: number;
    a: number;
}
/** Parsed representation of a CSS color input. */
export interface ParsedColor {
    /** The format family the input was written in (named colors count as 'name'). */
    format: 'hex' | 'rgb' | 'hsl' | 'hwb' | 'name';
    /** CSS color name if the input was a named color (or 'transparent'). */
    name?: string;
    /** Normalized RGBA channels. */
    rgba: Rgba;
}
export type ParseResult = {
    ok: true;
    color: ParsedColor;
} | {
    ok: false;
    error: string;
};
/** Parse a hex string (#rgb/#rgba/#rrggbb/#rrggbbaa) into RGBA. */
export declare function parseHex(input: string): Rgba | undefined;
/**
 * Parse a functional color — rgb()/rgba(), hsl()/hsla(), hwb() — supporting
 * both legacy comma syntax and modern space syntax (rgb(255 0 0 / 0.5)).
 */
export declare function parseFunctional(input: string): Rgba | undefined;
/** Convert RGBA (0–255) to a lowercase hex string, with alpha when < 1. */
export declare function rgbaToHex(rgba: Rgba): string;
/** Convert RGBA (0–255) to an rgb()/rgba() string. */
export declare function rgbaToRgbString(rgba: Rgba): string;
/** Convert RGBA (0–255) to an hsl()/hsla() string (h 1dp, s/l in %). */
export declare function rgbaToHslString(rgba: Rgba): string;
/** Convert RGBA (0–255) to an hwb() string (h 1dp, w/b in %). */
export declare function rgbaToHwbString(rgba: Rgba): string;
/** Convert RGBA (0–255) to { h, s, l } with h in degrees, s/l in [0, 1]. */
export declare function rgbToHsl(r: number, g: number, b: number): {
    h: number;
    s: number;
    l: number;
};
/** Convert HSL (h degrees, s/l in [0, 1]) to RGB in [0, 255]. */
export declare function hslToRgb(h: number, s: number, l: number): {
    r: number;
    g: number;
    b: number;
};
/** Convert HWB (h degrees, w/b in [0, 1]) to RGB in [0, 255]. */
export declare function hwbToRgb(h: number, w: number, b: number): {
    r: number;
    g: number;
    b: number;
};
/** sRGB relative luminance of an RGBA color (alpha ignored), in [0, 1]. */
export declare function relativeLuminance(rgba: Rgba): number;
/**
 * WCAG 2.x contrast ratio between two colors: (L1 + 0.05) / (L2 + 0.05) with
 * L1 the lighter luminance. Ranges from 1 (identical) to 21 (black vs white).
 */
export declare function contrastRatio(first: Rgba, second: Rgba): number;
/** WCAG level verdict for a ratio, given the text size class. */
export declare function wcagLevel(ratio: number, largeText: boolean): 'AAA' | 'AA' | 'fail';
/** Round to `digits` decimals, trimming trailing zeros. */
export declare function round(value: number, digits: number): number;
/** Convenience: parse a user color string, resolving named colors first. */
export declare function parseColorInput(input: string, namedLookup: (name: string) => string | undefined): ParseResult;
//# sourceMappingURL=color.d.ts.map