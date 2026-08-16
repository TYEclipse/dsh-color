/**
 * Tool definitions for dsh-color: three pure-math color tools exposed to every
 * agent via defineTool. No network, no filesystem — everything is computed
 * locally from the input string.
 *
 * @module dsh-color/tools
 */
import { type ToolDefinition } from '@deepseek-ai/dsh-tools';
export interface ToolSet {
    convert_color: ToolDefinition;
    contrast_ratio: ToolDefinition;
    color_info: ToolDefinition;
}
/** Result of convert_color, kept flat and JsonValue-safe. */
export interface ConvertResult {
    input: string;
    ok: boolean;
    error?: string;
    hex?: string;
    rgb?: string;
    hsl?: string;
    hwb?: string;
    alpha: number;
    name?: string;
}
/** Result of contrast_ratio. */
export interface ContrastResult {
    color1: string;
    color2: string;
    ok: boolean;
    error?: string;
    ratio?: number;
    aa?: boolean;
    aaa?: boolean;
    level?: 'AAA' | 'AA' | 'fail';
    largeText: boolean;
}
/** One row of color_info matches. */
export interface ColorMatch {
    name: string;
    hex: string;
    rgb: string;
    hsl: string;
    luminance: number;
}
/** Result of color_info. */
export interface InfoResult {
    ok: boolean;
    error?: string;
    query: string;
    by: 'name' | 'value';
    count: number;
    total: number;
    matches: ColorMatch[];
}
/** Build all three tool definitions. */
export declare function buildColorTools(): ToolSet;
//# sourceMappingURL=tools.d.ts.map