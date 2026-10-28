/**
 * dsh-color — color toolbox for DeepSeek Harness.
 *
 * Ten pure-math tools, zero runtime dependencies:
 *   convert_color  — parse any CSS color (hex / rgb() / hsl() / hwb() / named) and convert formats
 *   contrast_ratio — WCAG 2.x contrast ratio with AA/AAA verdicts for normal or large text
 *   color_info     — CSS named-color lookup by name substring or by exact value
 *   color_scheme   — harmonious palettes (complementary / analogous / triadic / split-complementary /
 *                    tetradic / square / monochromatic) from a base color
 *   adjust_color   — lighten / darken / saturate / desaturate / hue-rotate by a given amount
 *   blend_colors   — alpha compositing ("over") and premultiplied sRGB interpolation ("mix")
 *   ensure_contrast— nearest color to a foreground that reaches a WCAG contrast target on a background
 *   color_difference — CIEDE2000 / CIE76 difference between two colors, with a plain-language verdict
 *   color_scale    — perceptually even tint / shade / gradient ramps (Oklab by default)
 *   cvd_simulate   — how colors look with protan / deutan / tritan color-vision deficiency, and
 *                    which pairs of a palette collapse (Machado, Oliveira & Fernandes 2009)
 *
 * Everything is computed locally: no network, no filesystem, no side effects.
 *
 * @module dsh-color
 */
import type { Context } from '@deepseek-ai/cordis';
import z from '@deepseek-ai/schemastery';
/** Stable Cordis plugin name (also the config key under `plugins:`). */
export declare const name = "dsh-color";
/** Services required before tool registration can start. */
export declare const inject: string[];
/** Plugin configuration (no tunables today — kept for schema completeness). */
export interface Config {
    /** Reserved for future options. */
    _?: never;
}
export declare const Config: z<Config>;
/** Mount the color tools on every live agent and every future one. */
export declare function apply(ctx: Context, _config: Config): void;
//# sourceMappingURL=index.d.ts.map