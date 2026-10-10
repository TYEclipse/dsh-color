# dsh-color

DeepSeek Harness (dsh) 颜色工具箱：解析并转换任意 CSS 颜色、计算 WCAG 对比度、查询 CSS 颜色名称、生成和谐配色方案、调整与混合颜色、修复对比度、量化两个颜色的感知差异、生成感知均匀的明暗色阶。

**纯本地数学计算——零运行时依赖、无网络、无副作用。**

## 工具

| 工具 | 说明 |
|------|------|
| `convert_color` | 解析任意 CSS 颜色（hex `#rgb`/`#rgba`/`#rrggbb`/`#rrggbbaa`、`rgb()`/`rgba()`、`hsl()`/`hsla()`、`hwb()`、CSS 颜色名），并转换为 hex / rgb / hsl / hwb——或一次性输出全部格式 |
| `contrast_ratio` | 两个颜色的 WCAG 2.x 对比度，并给出普通/大号文字的 AA/AAA 判定（WCAG 1.4.3 阈值） |
| `color_info` | CSS 颜色名查询：按名称子串搜索（"blue" → blue、blueviolet、lightblue…）或按精确值反查（aqua ≡ cyan），每个匹配给出 hex/rgb/hsl/相对亮度 |
| `color_scheme` | 由基色生成和谐配色：互补、类似（3/5 色）、三角、分裂互补、四角（矩形）、方形、单色（2–9 个明度梯度）——每个颜色输出 hex + rgb + hsl |
| `adjust_color` | 调整颜色：变亮 / 变暗 / 加饱和 / 去饱和（百分点）或色相旋转（度数）——输出 hex + rgb + hsl |
| `blend_colors` | 混合两个颜色：`over`（Alpha 合成，即半透明叠加真实显示的颜色）或 `mix`（预乘 sRGB 插值，即 CSS `color-mix(in srgb, …)` 的算法），可设权重 |
| `ensure_contrast` | 求「在指定背景上达到 WCAG 目标」且离原前景色最近的颜色：保留色相与饱和度，只把明度推向黑或白，报告前后对比度与明度位移；目标不可能达成时如实说明并给出最佳可达对比度 |
| `color_difference` | 两个颜色「看起来差多少」：CIEDE2000（印刷/品牌规范验收用的感知色差）+ CIE76、两者的 CIELAB 坐标、白话判定与容差检查——回答「这真的是同一个品牌色吗」 |
| `color_scale` | 从基色生成等距色阶：`tints`（向白）、`shades`（向黑）、`both`（黑 → 基色 → 白）或 `between`（向第二个颜色）；默认在 Oklab 空间插值，每步给出与基色的 ΔE00 |

## 安装

```bash
dsh plugin --profile web add github:TYEclipse/dsh-color
```

把 `web` 换成你的 profile 名（`dsh plugin` 没有默认 profile）。

## 使用示例

```
convert_color("rebeccapurple")
  → hex #663399, rgb(102, 51, 153), hsl(270, 50%, 40%), hwb(270 20% 40%)

convert_color("#ff000080", format: "hex")
  → #ff000080（保留 alpha）

contrast_ratio("#777777", "#ffffff")
  → 4.48:1——普通文字不达标，大号文字 AA

contrast_ratio("white", "hsl(0, 100%, 50%)")
  → 4.0:1——仅大号文字 AA

color_info(query: "blue", limit: 5)
  → blue #0000ff、blueviolet #8a2be2、cadetblue #5f9ea0、…

color_info(query: "#00ffff", by: "value")
  → aqua、cyan（都映射到 #00ffff）

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
  → #ff8080 —— 半透明红叠在白底上的真实颜色

blend_colors("#ff0000", "#0000ff", mode: "mix", weight: 0.5)
  → #800080 —— 紫色，即 color-mix() 的中点

ensure_contrast("#777777", "#ffffff")
  → #767676，对比度 4.54:1 —— 只压暗到刚好达标 AA

ensure_contrast("#555555", "#000000", level: "AAA")
  → #959595，对比度 7.01:1 —— 提亮 +24.9 个明度点

ensure_contrast("#8080ff", "#808080", level: "AAA")
  → 该背景无法达到目标；最佳为 #000000，5.32:1

color_difference("#336699", "#3366ff")
  → ΔE00 11.7766（ΔE76 61.1101）—— different，超出默认容差 2

color_difference("#000000", "#010101")
  → ΔE00 0.1571 —— identical：8 位的一个步进肉眼看不见

color_scale("#336699", mode: "tints", steps: 5)
  → #336699, #658bb3, #97b1cd, #cad7e6, #ffffff（Oklab 空间等距）

color_scale("#336699", mode: "between", to: "#ff0080", steps: 4)
  → #336699, #866092, #c44e8a, #ff0080

color_scale("rgba(51, 102, 153, 0.5)", mode: "tints", steps: 3)
  → #33669980, #97b1cdbf, #ffffff —— alpha 也随色阶变化
```

## 特性

- **输入格式**：hex 缩写/全写（3/4/6/8 位）、传统逗号语法（`rgb(255, 0, 0)`）与现代空格语法（`rgb(255 0 0 / 50%)`）、百分比（`rgb(100% 0% 0%)`）、色相角度单位（`deg`/`rad`/`grad`/`turn`）、全部 148 个 CSS Color 4 命名色、以及 `transparent`。
- **Alpha** 全程保留；hex 仅在 alpha < 1 时输出 8 位形式。
- **WCAG 数学**：按 WCAG 2.x 计算相对亮度（sRGB 线性化）、对比度 `(L1+0.05)/(L2+0.05)`；普通文字 AA 4.5 / AAA 7，大号文字（≥18pt 或 ≥14pt 加粗）AA 3 / AAA 4.5。
- **配色数学**：旋转类方案保持基色饱和度/明度，按经典偏移旋转色相（互补 +180°、三角 +120°/+240°、分裂互补 +150°/+210°、四角 +60°/+180°/+240°、方形 +90°/+180°/+270°）；类似色以基色为中心（−30°/0/+30°，5 色时 −60°/−30°/0/+30°/+60°）；单色保持色相/饱和度、明度在 [l−0.4, l+0.4]（钳制到 [0.02, 0.98]）内均匀步进。
- **调整数学**：变亮/变暗/加饱和/去饱和按百分点移动通道（钳制 0–100）；色相按度数旋转（任意符号，自动归一化）。灰色加饱和为空操作（与 CSS filter 语义一致）。
- **混合数学**：`over` 是非预乘通道的 Porter-Duff source-over（CSS Compositing and Blending §9.1），即浏览器叠加半透明色时的真实结果；`mix` 在预乘 sRGB 通道上插值再除回 alpha，与 `color-mix(in srgb, …)` 完全一致。权重超出 0–1 时钳制，不做外推。
- **对比度修复**：`ensure_contrast` 保留色相与饱和度，把明度推向黑或白——`auto` 取对背景得分更高的那端。算法先按 1000 步扫描，且每步都检验**8 位量化后**的颜色（能达标 = 渲染器真的显示得出来），再二分 20 次把位移压到最小（如 `#777777` → `#767676`，而不是 `#757575`）。目标不可达时给出最佳可达对比度，而不是悄悄返回一个不达标的颜色。
- **输入通道量纲**（v0.3.0 修复）：`rgb()` 里的裸数字按 0–255 解释（`rgb(51, 102, 153)` = `#336699`），百分比才是 255 的份额；`hsl()`/`hwb()` 里的裸数字与百分比同义（`hsl(210 100 50)` = `hsl(210, 100%, 50%)`）。
- **色差数学**：Lab 取 **D65** 白点（sRGB 的经典 CIE/ICC 约定，不是 CSS `lab()` 的 D50），忽略 alpha；CIEDE2000 按 Sharma、Wu & Dalal（2005）实现，含两个色相均值特例。判定档位：≤1 identical、≤2 barely-perceptible、≤10 perceptible、≤49 different，再高为 very-different。
- **色阶数学**：`tints`/`shades` 从基色走到白/黑（基色在首位）；`both` 从黑经基色到白，步数为奇数时基色正好居中；`between` 需要 `to` 颜色。默认在 Oklab 空间插值（感知等距，越界结果钳回 sRGB），也可用 `space: "srgb"` 走原始通道插值（CSS 渐变的做法）。alpha 线性插值，所以向白 tint 会逐渐变为不透明。每步给出与基色的 ΔE00。
- **Oklab 常量**：用 CSS Color 4 为「统一 D65 参考白」重算的 64 位版本，因此 sRGB 白恰好落在 Oklab (1, 0, 0)。
- **通道序列化**：四舍五入（0.5 进位）并带浮点尘埃防护，与 CSS 序列化一致（如 `hsl(210, 100%, 50%)` → `rgb(0, 128, 255)`）。
- 越界通道自动钳制（现代 CSS 行为）。

## 开发

```bash
pnpm install     # 提示构建脚本审批时用 CI=true
pnpm build       # tsc → dist/
pnpm test        # vitest
pnpm lint        # oxlint src test
```

## 许可证

MIT
