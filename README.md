# dsh-color

Color toolbox for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (dsh):
parse and convert any CSS color, evaluate WCAG contrast, look up CSS color names,
generate harmonious palettes, adjust and blend colors, repair contrast, measure how
different two colors look, and build perceptually even tint/shade scales.

**Pure local math — zero runtime dependencies, no network, no side effects.**

## Tools

| Tool | Description |
|------|-------------|
| `convert_color` | Parse any CSS color (hex `#rgb`/`#rgba`/`#rrggbb`/`#rrggbbaa`, `rgb()`/`rgba()`, `hsl()`/`hsla()`, `hwb()`, CSS color names) and convert it to hex / rgb / hsl / hwb — or all formats at once |
| `contrast_ratio` | WCAG 2.x contrast ratio between two colors with AA/AAA verdicts for normal or large text (WCAG 1.4.3 thresholds) |
| `color_info` | CSS named-color lookup: search by name substring ("blue" → blue, blueviolet, lightblue, …) or by exact value (aqua ≡ cyan), with hex/rgb/hsl/luminance per match |
| `color_scheme` | Harmonious palettes from a base color: complementary, analogous (3/5), triadic, split-complementary, tetradic, square, monochromatic (2–9 shades) — every color as hex + rgb + hsl |
| `adjust_color` | lighten / darken / saturate / desaturate (percentage points) or hue-rotate (degrees) a color — result as hex + rgb + hsl |
| `blend_colors` | Blend two colors: `over` (alpha compositing — what a translucent overlay actually shows) or `mix` (premultiplied sRGB interpolation, the math behind CSS `color-mix(in srgb, …)`) with a weight |
| `ensure_contrast` | The nearest color to a foreground that reaches a WCAG target on a given background: hue and saturation kept, lightness moved toward black or white, ratio before/after and the lightness shift reported; says so — with the best achievable ratio — when the target is impossible |
| `color_difference` | How different two colors look: CIEDE2000 (the perceptual metric used by print/brand QA) and CIE76, both CIELAB colors, a plain-language verdict and a tolerance check — "is this really the same brand color?" |
| `color_scale` | An evenly spaced ramp from a base color: `tints` (→ white), `shades` (→ black), `both` (black → base → white) or `between` (→ a second color), interpolated in Oklab by default, with each step's ΔE00 from the base |

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

blend_colors("rgba(255, 0, 0, 0.5)", "#ffffff")
  → #ff8080 — half-transparent red on white

blend_colors("#ff0000", "#0000ff", mode: "mix", weight: 0.5)
  → #800080 — purple, the color-mix() midpoint

ensure_contrast("#777777", "#ffffff")
  → #767676 at 4.54:1 — darkens just enough to pass AA

ensure_contrast("#555555", "#000000", level: "AAA")
  → #959595 at 7.01:1 — lighten, +24.9 lightness points

ensure_contrast("#8080ff", "#808080", level: "AAA")
  → target unreachable; best #000000 at 5.32:1

color_difference("#336699", "#3366ff")
  → ΔE00 11.7766 (ΔE76 61.1101) — different, beyond the default tolerance of 2

color_difference("#000000", "#010101")
  → ΔE00 0.1571 — identical: one 8-bit step is invisible

color_scale("#336699", mode: "tints", steps: 5)
  → #336699, #658bb3, #97b1cd, #cad7e6, #ffffff (even in Oklab)

color_scale("#336699", mode: "between", to: "#ff0080", steps: 4)
  → #336699, #866092, #c44e8a, #ff0080

color_scale("rgba(51, 102, 153, 0.5)", mode: "tints", steps: 3)
  → #33669980, #97b1cdbf, #ffffff — alpha rides along the ramp
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
- **Blend math**: `over` is Porter-Duff source-over with non-premultiplied
  channels (CSS Compositing and Blending §9.1) — the color a browser paints for
  a translucent overlay; `mix` interpolates premultiplied sRGB channels and
  divides the alpha back out, which is exactly `color-mix(in srgb, …)`. Weights
  outside 0–1 are clamped instead of extrapolated.
- **Contrast repair**: `ensure_contrast` keeps hue and saturation and moves
  lightness toward black or white — `auto` picks whichever extreme scores higher
  against the background. It scans 1000 lightness steps and tests the **8-bit
  rounded** color at each step (what passes is what a renderer will show), then
  bisects 20 times so the shift stays minimal (e.g. `#777777` → `#767676`, not
  `#757575`). Unreachable targets report the best achievable ratio rather than a
  color that silently misses.
- **Input channel scales** (fixed in v0.3.0): a bare number in `rgb()` is on the
  0–255 scale (`rgb(51, 102, 153)` = `#336699`) while a percentage is a share of
  255; in `hsl()`/`hwb()` a bare number means the same as a percentage
  (`hsl(210 100 50)` = `hsl(210, 100%, 50%)`).
- **Colour difference**: Lab uses the **D65** white point (the classic CIE/ICC
  convention for sRGB, not CSS `lab()`'s D50), alpha is ignored, and CIEDE2000
  follows Sharma, Wu & Dalal (2005) including both hue-average special cases.
  Verdict bands: ≤1 identical, ≤2 barely perceptible, ≤10 perceptible,
  ≤49 different, above that very different.
- **Scale math**: `tints`/`shades` run from the base to white/black with the base
  first; `both` spans black → base → white and puts the base exactly in the middle
  when the step count is odd; `between` needs a `to` color. Interpolation happens
  in Oklab by default (perceptually even; steps outside sRGB are clamped back in)
  or in plain sRGB channels with `space: "srgb"` (what CSS gradients do). Alpha is
  interpolated linearly, so a tint ramp fades toward opaque white. Each step
  reports its ΔE00 distance from the base.
- **Oklab constants** are the 64-bit ones CSS Color 4 recalculated for a
  consistent D65 reference white, so sRGB white lands on Oklab (1, 0, 0) exactly.
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
