/**
 * Core color math for dsh-color: CSS color parsing, format conversion and
 * WCAG contrast evaluation. Pure functions, no I/O, zero dependencies.
 *
 * All internal channels are floats: r/g/b in [0, 255], h in degrees
 * [0, 360), s/l/w/b in [0, 1] (percent fractions), alpha in [0, 1].
 *
 * @module dsh-color/color
 */
// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------
const HEX_RE = /^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/;
const FUNCTION_RE = /^(rgba?|hsla?|hwb)\(([\s\S]*)\)$/;
function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
}
/** Parse a numeric channel token: number, percentage, or angle with unit. */
function parseChannel(token) {
    const trimmed = token.trim();
    if (trimmed === '')
        return undefined;
    const value = Number.parseFloat(trimmed);
    if (!Number.isFinite(value))
        return undefined;
    if (trimmed.endsWith('%'))
        return value / 100;
    return value;
}
/**
 * rgb() channel: a percentage is a share of 255 (`50%` → 127.5) while a bare
 * number is already on the 0–255 scale, because CSS Color 4 lets `rgb(51 102 153)`
 * mean #336699. The two scales must not be confused: multiplying a bare number
 * by 255 turned every mid-range `rgb(...)` input into pure 255 (fixed in R42 —
 * the old tests only ever used 0 and 255 channels, where clamping hid it).
 */
function parseRgbChannel(token) {
    const value = parseChannel(token);
    if (value === undefined)
        return undefined;
    return token.trim().endsWith('%') ? value * 255 : value;
}
/**
 * hsl()/hwb() percentage channel as a 0–1 fraction: `50%` and the bare number
 * `50` both mean 50% (CSS Color 4 interprets a number in s/l/w/b exactly like a
 * percentage), so `hsl(210 100 50)` is the same as `hsl(210, 100%, 50%)`.
 */
function parsePercentChannel(token) {
    const value = parseChannel(token);
    if (value === undefined)
        return undefined;
    return token.trim().endsWith('%') ? value : value / 100;
}
/** Parse an angle token into degrees (deg | rad | grad | turn | unitless). */
function parseAngle(token) {
    const trimmed = token.trim();
    if (trimmed === '')
        return undefined;
    const match = /^(-?\d*\.?\d+)(deg|rad|grad|turn)?$/.exec(trimmed);
    if (match === null)
        return undefined;
    const value = Number.parseFloat(match[1] ?? '');
    if (!Number.isFinite(value))
        return undefined;
    const unit = match[2];
    switch (unit) {
        case 'rad':
            return (value * 180) / Math.PI;
        case 'grad':
            return value * 0.9;
        case 'turn':
            return value * 360;
        default:
            return value;
    }
}
/** Normalize an angle to [0, 360). */
function normalizeHue(degrees) {
    const mod = degrees % 360;
    return mod < 0 ? mod + 360 : mod;
}
/** Parse a hex string (#rgb/#rgba/#rrggbb/#rrggbbaa) into RGBA. */
export function parseHex(input) {
    const match = HEX_RE.exec(input.trim().toLowerCase());
    if (match === null)
        return undefined;
    const digits = match[1] ?? '';
    let r = '';
    let g = '';
    let b = '';
    let a = 'ff';
    if (digits.length === 3 || digits.length === 4) {
        r = digits.slice(0, 1) + digits.slice(0, 1);
        g = digits.slice(1, 2) + digits.slice(1, 2);
        b = digits.slice(2, 3) + digits.slice(2, 3);
        if (digits.length === 4)
            a = digits.slice(3, 4) + digits.slice(3, 4);
    }
    else {
        r = digits.slice(0, 2);
        g = digits.slice(2, 4);
        b = digits.slice(4, 6);
        if (digits.length === 8)
            a = digits.slice(6, 8);
    }
    const to255 = (hex) => Number.parseInt(hex, 16);
    return { r: to255(r), g: to255(g), b: to255(b), a: to255(a) / 255 };
}
/**
 * Parse a functional color — rgb()/rgba(), hsl()/hsla(), hwb() — supporting
 * both legacy comma syntax and modern space syntax (rgb(255 0 0 / 0.5)).
 */
export function parseFunctional(input) {
    const match = FUNCTION_RE.exec(input.trim().toLowerCase());
    if (match === null)
        return undefined;
    const fn = match[1] ?? '';
    const body = match[2] ?? '';
    const kind = fn.startsWith('rgb') ? 'rgb' : fn.startsWith('hsl') ? 'hsl' : 'hwb';
    // Split off the optional alpha component after '/'.
    const slashParts = body.split('/');
    if (slashParts.length > 2)
        return undefined;
    const channelText = slashParts[0] ?? '';
    const alphaText = slashParts[1];
    const tokens = channelText.split(/[\s,]+/).filter((t) => t !== '');
    const isComma = channelText.includes(',');
    if (tokens.length !== 3 && tokens.length !== 4)
        return undefined;
    // Legacy comma syntax carries alpha as a 4th token (rgba(0, 0, 0, 0.5)).
    const legacyAlpha = isComma && tokens.length === 4 ? tokens[3] : undefined;
    if (legacyAlpha !== undefined && alphaText !== undefined)
        return undefined;
    const alpha = alphaText ?? legacyAlpha;
    if (kind === 'rgb') {
        const r = parseRgbChannel(tokens[0] ?? '');
        const g = parseRgbChannel(tokens[1] ?? '');
        const b = parseRgbChannel(tokens[2] ?? '');
        if (r === undefined || g === undefined || b === undefined)
            return undefined;
        return {
            r: clamp(r, 0, 255),
            g: clamp(g, 0, 255),
            b: clamp(b, 0, 255),
            a: parseAlpha(alpha),
        };
    }
    const h = parseAngle(tokens[0] ?? '');
    const s = parsePercentChannel(tokens[1] ?? '');
    const l = parsePercentChannel(tokens[2] ?? '');
    if (h === undefined || s === undefined || l === undefined)
        return undefined;
    if (kind === 'hsl') {
        const rgb = hslToRgb(normalizeHue(h), clamp(s, 0, 1), clamp(l, 0, 1));
        return { r: rgb.r, g: rgb.g, b: rgb.b, a: parseAlpha(alpha) };
    }
    // hwb: w and b are fractions of 0–100% (CSS requires percentages, but bare
    // numbers are accepted leniently and treated as percentages).
    const w = parsePercentChannel(tokens[1] ?? '');
    const b = parsePercentChannel(tokens[2] ?? '');
    if (w === undefined || b === undefined)
        return undefined;
    const rgb = hwbToRgb(normalizeHue(h), clamp(w, 0, 1), clamp(b, 0, 1));
    return { r: rgb.r, g: rgb.g, b: rgb.b, a: parseAlpha(alpha) };
}
function parseAlpha(token) {
    if (token === undefined)
        return 1;
    const value = parseChannel(token);
    if (value === undefined)
        return 1;
    return clamp(value, 0, 1);
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
export function roundChannel(value) {
    return Math.round(value + 1e-7);
}
/** Convert RGBA (0–255) to a lowercase hex string, with alpha when < 1. */
export function rgbaToHex(rgba) {
    const to2 = (v) => clamp(roundChannel(v), 0, 255).toString(16).padStart(2, '0');
    let hex = `#${to2(rgba.r)}${to2(rgba.g)}${to2(rgba.b)}`;
    if (rgba.a < 1)
        hex += to2(rgba.a * 255);
    return hex;
}
/** Convert RGBA (0–255) to an rgb()/rgba() string. */
export function rgbaToRgbString(rgba) {
    const r = roundChannel(rgba.r);
    const g = roundChannel(rgba.g);
    const b = roundChannel(rgba.b);
    if (rgba.a >= 1)
        return `rgb(${r}, ${g}, ${b})`;
    return `rgba(${r}, ${g}, ${b}, ${round(rgba.a, 3)})`;
}
/** Convert RGBA (0–255) to an hsl()/hsla() string (h 1dp, s/l in %). */
export function rgbaToHslString(rgba) {
    const { h, s, l } = rgbToHsl(rgba.r, rgba.g, rgba.b);
    const hText = round(h, 1);
    const sText = round(s * 100, 1);
    const lText = round(l * 100, 1);
    if (rgba.a >= 1)
        return `hsl(${hText}, ${sText}%, ${lText}%)`;
    return `hsla(${hText}, ${sText}%, ${lText}%, ${round(rgba.a, 3)})`;
}
/** Convert RGBA (0–255) to an hwb() string (h 1dp, w/b in %). */
export function rgbaToHwbString(rgba) {
    const h = rgbToHsl(rgba.r, rgba.g, rgba.b).h;
    const w = (Math.min(rgba.r, rgba.g, rgba.b) / 255) * 100;
    const b = (1 - Math.max(rgba.r, rgba.g, rgba.b) / 255) * 100;
    const alpha = rgba.a >= 1 ? '' : ` / ${round(rgba.a, 3)}`;
    return `hwb(${round(h, 1)} ${round(w, 1)}% ${round(b, 1)}%${alpha})`;
}
/** Convert RGBA (0–255) to { h, s, l } with h in degrees, s/l in [0, 1]. */
export function rgbToHsl(r, g, b) {
    const rn = r / 255;
    const gn = g / 255;
    const bn = b / 255;
    const max = Math.max(rn, gn, bn);
    const min = Math.min(rn, gn, bn);
    const l = (max + min) / 2;
    if (max === min)
        return { h: 0, s: 0, l };
    const d = max - min;
    const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    let h;
    if (max === rn) {
        h = (gn - bn) / d + (gn < bn ? 6 : 0);
    }
    else if (max === gn) {
        h = (bn - rn) / d + 2;
    }
    else {
        h = (rn - gn) / d + 4;
    }
    return { h: h * 60, s, l };
}
function hueToRgb(p, q, t) {
    let tt = t;
    if (tt < 0)
        tt += 1;
    if (tt > 1)
        tt -= 1;
    let value;
    if (tt < 1 / 6)
        value = p + (q - p) * 6 * tt;
    else if (tt < 1 / 2)
        value = q;
    else if (tt < 2 / 3)
        value = p + (q - p) * (2 / 3 - tt) * 6;
    else
        value = p;
    // Snap to [p, q] with an epsilon to absorb floating-point dust at sextant
    // boundaries (e.g. (2/3 - 0.5) * 6 evaluates to 0.9999999999999998 instead
    // of 1). Without this, hsl(180) would round-trip to 254.99999999999994.
    if (value > q - 1e-12)
        return q;
    if (value < p + 1e-12)
        return p;
    return Math.min(q, Math.max(p, value));
}
/** Convert HSL (h degrees, s/l in [0, 1]) to RGB in [0, 255]. */
export function hslToRgb(h, s, l) {
    if (s === 0) {
        const gray = l * 255;
        return { r: gray, g: gray, b: gray };
    }
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    const hn = h / 360;
    return {
        r: hueToRgb(p, q, hn + 1 / 3) * 255,
        g: hueToRgb(p, q, hn) * 255,
        b: hueToRgb(p, q, hn - 1 / 3) * 255,
    };
}
/** Convert HWB (h degrees, w/b in [0, 1]) to RGB in [0, 255]. */
export function hwbToRgb(h, w, b) {
    if (w + b >= 1) {
        const gray = (w / (w + b)) * 255;
        return { r: gray, g: gray, b: gray };
    }
    const rgb = hslToRgb(h, 1, 0.5);
    const factor = 1 - w - b;
    return {
        r: (rgb.r * factor + w * 255),
        g: (rgb.g * factor + w * 255),
        b: (rgb.b * factor + w * 255),
    };
}
// ---------------------------------------------------------------------------
// WCAG contrast
// ---------------------------------------------------------------------------
/** sRGB relative luminance of an RGBA color (alpha ignored), in [0, 1]. */
export function relativeLuminance(rgba) {
    const linearize = (v) => {
        const c = v / 255;
        return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
    };
    return (0.2126 * linearize(rgba.r) + 0.7152 * linearize(rgba.g) + 0.0722 * linearize(rgba.b));
}
/**
 * WCAG 2.x contrast ratio between two colors: (L1 + 0.05) / (L2 + 0.05) with
 * L1 the lighter luminance. Ranges from 1 (identical) to 21 (black vs white).
 */
export function contrastRatio(first, second) {
    const l1 = relativeLuminance(first);
    const l2 = relativeLuminance(second);
    const lighter = Math.max(l1, l2);
    const darker = Math.min(l1, l2);
    return (lighter + 0.05) / (darker + 0.05);
}
/** WCAG level verdict for a ratio, given the text size class. */
export function wcagLevel(ratio, largeText) {
    const aa = largeText ? 3 : 4.5;
    const aaa = largeText ? 4.5 : 7;
    if (ratio >= aaa)
        return 'AAA';
    if (ratio >= aa)
        return 'AA';
    return 'fail';
}
/**
 * Canonical hue offsets (degrees) for the hue-rotation harmonies. The base
 * hue comes first for every type except analogous, whose offsets are centered
 * on the base ([-30, 0, 30] for 3 colors, [-60, -30, 0, 30, 60] for 5).
 */
const HUE_ROTATION_OFFSETS = {
    complementary: [0, 180],
    triadic: [0, 120, 240],
    'split-complementary': [0, 150, 210],
    tetradic: [0, 60, 180, 240],
    square: [0, 90, 180, 270],
};
/** All valid harmony types, for runtime validation in the tool layer. */
export const HARMONY_TYPES = [
    'complementary',
    'analogous',
    'triadic',
    'split-complementary',
    'tetradic',
    'square',
    'monochromatic',
];
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
export function harmonyHsl(h, s, l, type, count) {
    if (type === 'analogous') {
        const offsets = count === 5 ? [-60, -30, 0, 30, 60] : [-30, 0, 30];
        return offsets.map((offset) => ({ h: normalizeHue(h + offset), s, l }));
    }
    if (type === 'monochromatic') {
        const n = clamp(Math.trunc(count ?? 5), 2, 9);
        const lower = Math.max(0.02, l - 0.4);
        const upper = Math.min(0.98, l + 0.4);
        const step = n > 1 ? (upper - lower) / (n - 1) : 0;
        return Array.from({ length: n }, (_unused, i) => ({ h, s, l: lower + step * i }));
    }
    const offsets = HUE_ROTATION_OFFSETS[type];
    return offsets.map((offset) => ({ h: normalizeHue(h + offset), s, l }));
}
/** All valid adjustment operations, for runtime validation in the tool layer. */
export const ADJUST_OPS = ['lighten', 'darken', 'saturate', 'desaturate', 'hue'];
/**
 * Apply one adjustment to an HSL triplet.
 *
 * `amount` semantics: for lighten/darken/saturate/desaturate it is percentage
 * points in [0, 100] (clamped); for hue it is degrees to rotate (any sign,
 * normalized to [0, 360)). Saturating an achromatic color (s = 0) is a no-op,
 * matching CSS filter saturate() — a gray has no hue to intensify.
 */
export function adjustHsl(h, s, l, op, amount) {
    switch (op) {
        case 'lighten':
            return { h, s, l: clamp(l + clamp(amount, 0, 100) / 100, 0, 1) };
        case 'darken':
            return { h, s, l: clamp(l - clamp(amount, 0, 100) / 100, 0, 1) };
        case 'saturate':
            return s === 0 ? { h, s, l } : { h, s: clamp(s + clamp(amount, 0, 100) / 100, 0, 1), l };
        case 'desaturate':
            return { h, s: clamp(s - clamp(amount, 0, 100) / 100, 0, 1), l };
        case 'hue':
            return { h: normalizeHue(h + amount), s, l };
    }
}
// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
/** Round to `digits` decimals, trimming trailing zeros. */
export function round(value, digits) {
    const factor = Math.pow(10, digits);
    return Math.round(value * factor) / factor;
}
/** Canonical blend-mode list (drives the tool enum). */
export const BLEND_MODES = ['over', 'mix'];
/**
 * Composite `source` over `backdrop` — Porter-Duff source-over with
 * non-premultiplied channels in and out (CSS Compositing and Blending §9.1).
 * This is what a browser paints for a translucent overlay on a solid backdrop.
 */
export function blendOver(source, backdrop) {
    const alpha = source.a + backdrop.a * (1 - source.a);
    if (alpha === 0)
        return { r: 0, g: 0, b: 0, a: 0 };
    const channel = (s, b) => (s * source.a + b * backdrop.a * (1 - source.a)) / alpha;
    return {
        r: channel(source.r, backdrop.r),
        g: channel(source.g, backdrop.g),
        b: channel(source.b, backdrop.b),
        a: alpha,
    };
}
/**
 * Premultiplied sRGB interpolation: `weight` is the weight of `second` in
 * [0, 1], so `first` carries the remaining 1 − weight. Identical to CSS
 * `color-mix(in srgb, first, second <weight × 100>%)`, alpha included: the
 * interpolation happens on premultiplied channels and is divided back out.
 */
export function blendMix(first, second, weight) {
    const w2 = clamp(weight, 0, 1);
    const w1 = 1 - w2;
    const alpha = first.a * w1 + second.a * w2;
    if (alpha === 0)
        return { r: 0, g: 0, b: 0, a: 0 };
    const channel = (c1, c2) => (c1 * first.a * w1 + c2 * second.a * w2) / alpha;
    return {
        r: channel(first.r, second.r),
        g: channel(first.g, second.g),
        b: channel(first.b, second.b),
        a: alpha,
    };
}
/** Canonical direction list (drives the tool enum). */
export const CONTRAST_DIRECTIONS = ['auto', 'darken', 'lighten'];
/** Lightness scan resolution of ensureContrast (1/1000 of the trip to the extreme). */
const CONTRAST_SCAN_STEPS = 1000;
/** Bisection count used to shave the scan's last step down. */
const CONTRAST_REFINE_STEPS = 20;
const BLACK = { r: 0, g: 0, b: 0, a: 1 };
const WHITE = { r: 255, g: 255, b: 255, a: 1 };
/** 8-bit serialization of a float channel — the color a renderer actually shows. */
function serializeChannel(value) {
    return clamp(roundChannel(value), 0, 255);
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
export function ensureContrast(foreground, background, target, direction = 'auto') {
    const base = contrastRatio(foreground, background);
    const resolved = direction === 'auto'
        ? (contrastRatio(WHITE, background) > contrastRatio(BLACK, background) ? 'lighten' : 'darken')
        : direction;
    if (base >= target) {
        return {
            ok: true,
            changed: false,
            direction: resolved,
            rgba: foreground,
            ratio: base,
            lightnessShift: 0,
        };
    }
    const { h, s, l } = rgbToHsl(foreground.r, foreground.g, foreground.b);
    const extreme = resolved === 'darken' ? 0 : 1;
    const at = (t) => {
        const rgb = hslToRgb(h, s, l + (extreme - l) * t);
        return {
            r: serializeChannel(rgb.r),
            g: serializeChannel(rgb.g),
            b: serializeChannel(rgb.b),
            a: foreground.a,
        };
    };
    let low = 0;
    let high = 0;
    let passing;
    for (let i = 1; i <= CONTRAST_SCAN_STEPS; i += 1) {
        const t = i / CONTRAST_SCAN_STEPS;
        const candidate = at(t);
        if (contrastRatio(candidate, background) >= target) {
            low = (i - 1) / CONTRAST_SCAN_STEPS;
            high = t;
            passing = candidate;
            break;
        }
    }
    if (passing === undefined) {
        const best = at(1);
        return {
            ok: false,
            changed: false,
            direction: resolved,
            bestRgba: best,
            bestRatio: contrastRatio(best, background),
        };
    }
    for (let i = 0; i < CONTRAST_REFINE_STEPS; i += 1) {
        const mid = (low + high) / 2;
        const candidate = at(mid);
        if (contrastRatio(candidate, background) >= target) {
            high = mid;
            passing = candidate;
        }
        else {
            low = mid;
        }
    }
    return {
        ok: true,
        changed: true,
        direction: resolved,
        rgba: passing,
        ratio: contrastRatio(passing, background),
        lightnessShift: (extreme - l) * high * 100,
    };
}
/** Convenience: parse a user color string, resolving named colors first. */
export function parseColorInput(input, namedLookup) {
    const trimmed = input.trim();
    if (trimmed === '')
        return { ok: false, error: 'empty color input' };
    const lowered = trimmed.toLowerCase();
    if (lowered === 'transparent') {
        return { ok: true, color: { format: 'name', name: 'transparent', rgba: { r: 0, g: 0, b: 0, a: 0 } } };
    }
    const named = namedLookup(lowered);
    if (named !== undefined) {
        const rgba = parseHex(`#${named}`);
        if (rgba !== undefined) {
            return { ok: true, color: { format: 'name', name: lowered, rgba } };
        }
    }
    const hex = parseHex(lowered);
    if (hex !== undefined)
        return { ok: true, color: { format: 'hex', rgba: hex } };
    const functional = parseFunctional(lowered);
    if (functional !== undefined) {
        const format = lowered.startsWith('hwb') ? 'hwb' : lowered.startsWith('hsl') ? 'hsl' : 'rgb';
        return { ok: true, color: { format, rgba: functional } };
    }
    return { ok: false, error: `unrecognized color format: "${input}" (expected hex, rgb(), hsl(), hwb(), or a CSS color name)` };
}
//# sourceMappingURL=color.js.map