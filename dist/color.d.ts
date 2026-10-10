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
/**
 * Round for output while folding `-0` into `0`. JSON stringifies both as "0",
 * so a strict deep-equality round-trip gate (which is what dsh-tools applies to
 * tool output) reads `-0` as lossy — and rounding a tiny negative Lab channel
 * such as −4e-5 to 4 decimals lands on exactly `-0`.
 */
export declare function roundOut(value: number, digits: number): number;
/** The two blending modes blend_colors supports. */
export type BlendMode = 'over' | 'mix';
/** Canonical blend-mode list (drives the tool enum). */
export declare const BLEND_MODES: readonly BlendMode[];
/**
 * Composite `source` over `backdrop` — Porter-Duff source-over with
 * non-premultiplied channels in and out (CSS Compositing and Blending §9.1).
 * This is what a browser paints for a translucent overlay on a solid backdrop.
 */
export declare function blendOver(source: Rgba, backdrop: Rgba): Rgba;
/**
 * Premultiplied sRGB interpolation: `weight` is the weight of `second` in
 * [0, 1], so `first` carries the remaining 1 − weight. Identical to CSS
 * `color-mix(in srgb, first, second <weight × 100>%)`, alpha included: the
 * interpolation happens on premultiplied channels and is divided back out.
 */
export declare function blendMix(first: Rgba, second: Rgba, weight: number): Rgba;
/** Direction to move a foreground color while repairing contrast. */
export type ContrastDirection = 'auto' | 'darken' | 'lighten';
/** Canonical direction list (drives the tool enum). */
export declare const CONTRAST_DIRECTIONS: readonly ContrastDirection[];
/** Outcome of ensureContrast: either a passing color or the best achievable one. */
export interface ContrastFix {
    /** True when a color reaching `target` was found. */
    ok: boolean;
    /** True when the returned color differs from the input (lightness moved). */
    changed: boolean;
    /** The direction actually used (never 'auto'). */
    direction: 'darken' | 'lighten';
    /** The color that reaches the target (present when ok). */
    rgba?: Rgba;
    /** Contrast ratio of `rgba` against the background (present when ok). */
    ratio?: number;
    /** Signed lightness change in percentage points (present when ok). */
    lightnessShift?: number;
    /** Best color found when the target is unreachable (present when not ok). */
    bestRgba?: Rgba;
    /** Contrast ratio of `bestRgba` (present when not ok). */
    bestRatio?: number;
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
export declare function ensureContrast(foreground: Rgba, background: Rgba, target: number, direction?: ContrastDirection): ContrastFix;
/** A Lab-style triplet: lightness plus two opponent-color axes. */
export interface LabColor {
    l: number;
    a: number;
    b: number;
}
/** A 3×3 matrix as three row tuples. */
type Mat3 = readonly [readonly [number, number, number], readonly [number, number, number], readonly [number, number, number]];
/** Multiply two 3×3 matrices (a · b). */
export declare function multiplyMat3(a: Mat3, b: Mat3): Mat3;
/**
 * Invert a 3×3 matrix (adjugate / determinant). The Oklab matrices are
 * published in the forward direction only, so the inverse direction is derived
 * here rather than typed in from a second, differently rounded source.
 */
export declare function invertMat3(m: Mat3): Mat3;
/** sRGB gamma encoding: one channel in [0, 1] (linear) → [0, 255]. */
export declare function linearToSrgbChannel(value: number): number;
/** sRGB gamma decoding: one channel in [0, 255] → [0, 1] (linear). */
export declare function srgbToLinearChannel(value: number): number;
/** RGBA (sRGB, alpha ignored) → CIE XYZ with the D65 white point. */
export declare function rgbaToXyz(rgba: Rgba): [number, number, number];
/** CIE XYZ (D65) → CIELAB, L in [0, 100], a/b unbounded. */
export declare function xyzToLab(xyz: readonly [number, number, number]): LabColor;
/** CIELAB → CIE XYZ (D65). Inverse of {@link xyzToLab}. */
export declare function labToXyz(lab: LabColor): [number, number, number];
/** RGBA (sRGB) → CIELAB under the D65 white point (alpha ignored). */
export declare function rgbaToLab(rgba: Rgba): LabColor;
/** CIELAB → RGBA, channels clamped into the sRGB gamut and alpha passed through. */
export declare function labToRgba(lab: LabColor, alpha?: number): Rgba;
/** RGBA (sRGB) → Oklab (D65, L in [0, 1]). */
export declare function rgbaToOklab(rgba: Rgba): LabColor;
/** Oklab → RGBA, out-of-gamut results clamped to sRGB, alpha passed through. */
export declare function oklabToRgba(lab: LabColor, alpha?: number): Rgba;
/** CIE76 color difference: plain Euclidean distance in CIELAB. */
export declare function deltaE76(first: LabColor, second: LabColor): number;
/**
 * CIEDE2000 color difference (CIE 2000, kL = kC = kH = 1), the industry
 * standard for "how different do these two colors look". The implementation
 * follows Sharma, Wu & Dalal (2005) including the two hue-average special
 * cases (zero chroma and hue pairs more than 180° apart); the oracle replays
 * their published 34-pair reference table on every run.
 */
export declare function deltaE2000(first: LabColor, second: LabColor): number;
/** How different two colors look, as a word (ΔE00 bands, plain-language). */
export type DifferenceVerdict = 'identical' | 'barely-perceptible' | 'perceptible' | 'different' | 'very-different';
/** Canonical verdict list (drives nothing but documentation and tests). */
export declare const DIFFERENCE_VERDICTS: readonly DifferenceVerdict[];
/**
 * Map a ΔE00 value onto a verdict. Bands follow the widely used reading of
 * ΔE00: ≤1 is not perceptible, ≤2 is perceptible only on close inspection,
 * ≤10 is obvious at a glance, and past ~50 the colors read as opposites.
 */
export declare function differenceVerdict(delta: number): DifferenceVerdict;
/** The four ramp shapes color_scale can build. */
export type ScaleMode = 'tints' | 'shades' | 'both' | 'between';
/** Canonical ramp list (drives the tool enum). */
export declare const SCALE_MODES: readonly ScaleMode[];
/** Interpolation space: perceptual (Oklab) or plain sRGB channels. */
export type ScaleSpace = 'oklab' | 'srgb';
/** Canonical space list (drives the tool enum). */
export declare const SCALE_SPACES: readonly ScaleSpace[];
/** Ramp length bounds enforced by color_scale. */
export declare const SCALE_MIN_STEPS = 2;
/** Ramp length upper bound enforced by color_scale. */
export declare const SCALE_MAX_STEPS = 11;
/** Mix `second` into `first` with the given weight in the requested space. */
export declare function scaleMix(first: Rgba, second: Rgba, weight: number, space: ScaleSpace): Rgba;
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
export declare function colorScale(base: Rgba, target: Rgba | undefined, mode: ScaleMode, steps: number, space: ScaleSpace): Rgba[];
/** Convenience: parse a user color string, resolving named colors first. */
export declare function parseColorInput(input: string, namedLookup: (name: string) => string | undefined): ParseResult;
export {};
//# sourceMappingURL=color.d.ts.map