/**
 * CSS Color Module Level 4 named colors (148 entries), name → hex.
 * Data is the public W3C standard table (https://www.w3.org/TR/css-color-4/#named-colors).
 * `transparent` is handled specially by the parser, not listed here.
 *
 * @module dsh-color/named
 */
export declare const NAMED_COLORS: Readonly<Record<string, string>>;
/** Case-insensitive name → hex lookup (without '#'); undefined if unknown. */
export declare function lookupNamed(name: string): string | undefined;
/** Reverse lookup: all names whose hex equals the given normalized hex. */
export declare function namesByHex(hex: string): string[];
/**
 * Fuzzy search across names and hex values. A query matches a color when the
 * query is a substring of its name or of its hex value. Sorted alphabetically.
 */
export declare function searchNamed(query: string): {
    name: string;
    hex: string;
}[];
//# sourceMappingURL=named.d.ts.map