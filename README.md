# dsh-color

Color toolbox for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (dsh):
parse and convert any CSS color, evaluate WCAG contrast, look up CSS color names,
generate harmonious palettes, and adjust colors.

**Pure local math — zero runtime dependencies, no network, no side effects.**

## Tools

| Tool | Description |
|------|-------------|
| `convert_color` | Parse any CSS color (hex `#rgb`/`#rgba`/`#rrggbb`/`#rrggbbaa`, `rgb()`/`rgba()`, `hsl()`/`hsla()`, `hwb()`, CSS color names) and convert it to hex / rgb / hsl / hwb — or all formats at once |
| `contrast_ratio` | WCAG 2.x contrast ratio between two colors with AA/AAA verdicts for normal or large text (WCAG 1.4.3 thresholds) |
| `color_info` | CSS named-color lookup: search by name substring ("blue" → blue, blueviolet, lightblue, …) or by exact value (aqua ≡ cyan), with hex/rgb/hsl/luminance per match |
| `color_scheme` | Harmonious palettes from a base color: complementary, analogous (3/5), triadic, split-complementary, tetradic, square, monochromatic (2–9 shades) — every color as hex + rgb + hsl |
| `adjust_color` | lighten / darken / saturate / desaturate (percentage points) or hue-rotate (degrees) a color — result as hex + rgb + hsl |

## Install

```bash
dsh plugin --profile web add github:TYEclipse/dsh-color
```

Replace `web` with your profile name (`dsh plugin` has no default profile).

## Usage examples

```
convert_color("rebeccapurple")
  → hex #663399, rgb(102, 51, 153), hsl(270, 50%, 40%), hwb(270 20% 40%)

convert_color("#ff000080", format: "hex")
  → #ff000080 (alpha preserved)

contrast_ratio("#777777", "#ffffff")
  → ratio 4.48 — fail for normal text, AA for large text

contrast_ratio("white", "hsl(0, 100%, 50%)")
  → ratio 4.0 — AA for large text only

color_info(query: "blue", limit: 5)
  → blue #0000ff, blueviolet #8a2be2, cadetblue #5f9ea0, …

color_info(query: "#00ffff", by: "value")
  → aqua, cyan (both map to #00ffff)

color_scheme("#336699", type: "triadic")
  → #336699, #993366, #669933

color_scheme("#ff0000", type: "analogous", count: 5)
  → #ff00ff, #ff0080, #ff0000, #ff8000, #ffff00

color_scheme("#336699", type: "monochromatic", count: 4)
  → #030508, #24476b, #4f8ac4, #b3cce6

adjust_color("#336699", op: "lighten", amount: 25)
  → #79a6d2

adjust_color("#ff0000", op: "hue", amount: 120)
  → #00ff00
```

## Feature notes

- **Input formats**: hex shorthand/full (3/4/6/8 digits), legacy comma syntax
  (`rgb(255, 0, 0)`) and modern space syntax (`rgb(255 0 0 / 50%)`),
  percentages (`rgb(100% 0% 0%)`), angle units for hue (`deg`/`rad`/`grad`/`turn`),
  all 148 CSS Color Module Level 4 named colors, and `transparent`.
- **Alpha** is preserved through every conversion; hex output switches to
  8-digit form only when alpha < 1.
- **WCAG math**: relative luminance per WCAG 2.x (sRGB linearization), ratio
  `(L1+0.05)/(L2+0.05)`, thresholds AA 4.5 / AAA 7 for normal text and
  AA 3 / AAA 4.5 for large text (≥18pt or ≥14pt bold).
- **Palette math**: rotation harmonies keep the base saturation/lightness and
  rotate the hue by the canonical offsets (complementary +180°, triadic
  +120°/+240°, split-complementary +150°/+210°, tetradic +60°/+180°/+240°,
  square +90°/+180°/+270°); analogous is centered on the base (−30°/0/+30°,
  or −60°/−30°/0/+30°/+60° for 5 colors); monochromatic keeps hue/saturation
  and steps lightness evenly across [l−0.4, l+0.4] (clamped to [0.02, 0.98]).
- **Adjustment math**: lighten/darken/saturate/desaturate shift the channel by
  N percentage points (clamped 0–100); hue rotates by N degrees (any sign,
  normalized). Saturating a gray is a no-op, matching CSS filter semantics.
- **Channel serialization** rounds half up with a floating-point dust guard,
  matching CSS serialization (e.g. `hsl(210, 100%, 50%)` → `rgb(0, 128, 255)`).
- Out-of-range channels are clamped (modern CSS behavior).

## Development

```bash
pnpm install     # CI=true if pnpm asks about build scripts
pnpm build       # tsc → dist/
pnpm test        # vitest
pnpm lint        # oxlint src test
```

## License

MIT
