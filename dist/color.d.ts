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
/**
 * Round a channel float to the nearest integer, ties rounding up, with a tiny
 * epsilon to absorb FP dust at exact .5 boundaries: hsl(210, 100%, 50%) has a
 * green channel of exactly 127.5 mathematically, but IEEE double evaluates the
 * sextant interpolation to 127.4999…9 — CSS serialization rounds half up
 * (spec example: hsl(120deg 100% 25%) = rgb(0 128 0)), so the guard recovers
 * 128. The bias is 1e-7, far larger than FP dust (~1e-13) and far smaller than
 * any rounding decision a real color value could hinge on.
 */
export declare function roundChannel(value: number): number;
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
/** The seven palette types color_scheme can generate. */
export type HarmonyType = 'complementary' | 'analogous' | 'triadic' | 'split-complementary' | 'tetradic' | 'square' | 'monochromatic';
/** All valid harmony types, for runtime validation in the tool layer. */
export declare const HARMONY_TYPES: readonly HarmonyType[];
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
export declare function harmonyHsl(h: number, s: number, l: number, type: HarmonyType, count?: number): Array<{
    h: number;
    s: number;
    l: number;
}>;
/** The five operations adjust_color can apply. */
export type AdjustOp = 'lighten' | 'darken' | 'saturate' | 'desaturate' | 'hue';
/** All valid adjustment operations, for runtime validation in the tool layer. */
export declare const ADJUST_OPS: readonly AdjustOp[];
/**
 * Apply one adjustment to an HSL triplet.
 *
 * `amount` semantics: for lighten/darken/saturate/desaturate it is percentage
 * points in [0, 100] (clamped); for hue it is degrees to rotate (any sign,
 * normalized to [0, 360)). Saturating an achromatic color (s = 0) is a no-op,
 * matching CSS filter saturate() — a gray has no hue to intensify.
 */
export declare function adjustHsl(h: number, s: number, l: number, op: AdjustOp, amount: number): {
    h: number;
    s: number;
    l: number;
};
/** Round to `digits` decimals, trimming trailing zeros. */
export declare function round(value: number, digits: number): number;
/** Convenience: parse a user color string, resolving named colors first. */
export declare function parseColorInput(input: string, namedLookup: (name: string) => string | undefined): ParseResult;
//# sourceMappingURL=color.d.ts.map