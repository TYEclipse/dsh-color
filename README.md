# dsh-color

Color conversion toolbox for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (dsh):
parse and convert any CSS color, evaluate WCAG contrast, and look up CSS color names.

**Pure local math — zero runtime dependencies, no network, no side effects.**

## Tools

| Tool | Description |
|------|-------------|
| `convert_color` | Parse any CSS color (hex `#rgb`/`#rgba`/`#rrggbb`/`#rrggbbaa`, `rgb()`/`rgba()`, `hsl()`/`hsla()`, `hwb()`, CSS color names) and convert it to hex / rgb / hsl / hwb — or all formats at once |
| `contrast_ratio` | WCAG 2.x contrast ratio between two colors with AA/AAA verdicts for normal or large text (WCAG 1.4.3 thresholds) |
| `color_info` | CSS named-color lookup: search by name substring ("blue" → blue, blueviolet, lightblue, …) or by exact value (aqua ≡ cyan), with hex/rgb/hsl/luminance per match |

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
