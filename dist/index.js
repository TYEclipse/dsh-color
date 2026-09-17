/**
 * dsh-color — color toolbox for DeepSeek Harness.
 *
 * Seven pure-math tools, zero runtime dependencies:
 *   convert_color  — parse any CSS color (hex / rgb() / hsl() / hwb() / named) and convert formats
 *   contrast_ratio — WCAG 2.x contrast ratio with AA/AAA verdicts for normal or large text
 *   color_info     — CSS named-color lookup by name substring or by exact value
 *   color_scheme   — harmonious palettes (complementary / analogous / triadic / split-complementary /
 *                    tetradic / square / monochromatic) from a base color
 *   adjust_color   — lighten / darken / saturate / desaturate / hue-rotate by a given amount
 *   blend_colors   — alpha compositing ("over") and premultiplied sRGB interpolation ("mix")
 *   ensure_contrast— nearest color to a foreground that reaches a WCAG contrast target on a background
 *
 * Everything is computed locally: no network, no filesystem, no side effects.
 *
 * @module dsh-color
 */
import z from '@deepseek-ai/schemastery';
import { buildColorTools } from "./tools.js";
/** Stable Cordis plugin name (also the config key under `plugins:`). */
export const name = 'dsh-color';
/** Services required before tool registration can start. */
export const inject = ['agents', 'tools'];
export const Config = z.object({});
/** Register every color tool on one agent; returns the disposer. */
function decorate(agent, tools) {
    const disposers = Object.values(tools).map((definition) => agent.ctx.tools.register(definition));
    return () => {
        for (const dispose of disposers) {
            try {
                dispose();
            }
            catch {
                // already disposed
            }
        }
    };
}
/** Mount the color tools on every live agent and every future one. */
export function apply(ctx, _config) {
    const tools = buildColorTools();
    const disposers = new Set();
    const decorateAgent = (agent) => {
        try {
            disposers.add(decorate(agent, tools));
        }
        catch (error) {
            ctx.logger('color').warn(`tool registration for agent ${agent.id} failed: ${error instanceof Error ? error.message : String(error)}`);
        }
    };
    for (const agent of ctx.agents.list())
        decorateAgent(agent);
    const off = ctx.on('agent/created', ({ agent }) => decorateAgent(agent));
    ctx.effect(() => () => {
        off();
        for (const dispose of disposers) {
            try {
                dispose();
            }
            catch {
                // already disposed
            }
        }
        disposers.clear();
    });
}
//# sourceMappingURL=index.js.map