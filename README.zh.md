# dsh-color

DeepSeek Harness (dsh) 颜色转换工具箱：解析并转换任意 CSS 颜色、计算 WCAG 对比度、查询 CSS 颜色名称。

**纯本地数学计算——零运行时依赖、无网络、无副作用。**

## 工具

| 工具 | 说明 |
|------|------|
| `convert_color` | 解析任意 CSS 颜色（hex `#rgb`/`#rgba`/`#rrggbb`/`#rrggbbaa`、`rgb()`/`rgba()`、`hsl()`/`hsla()`、`hwb()`、CSS 颜色名），并转换为 hex / rgb / hsl / hwb——或一次性输出全部格式 |
| `contrast_ratio` | 两个颜色的 WCAG 2.x 对比度，并给出普通/大号文字的 AA/AAA 判定（WCAG 1.4.3 阈值） |
| `color_info` | CSS 颜色名查询：按名称子串搜索（"blue" → blue、blueviolet、lightblue…）或按精确值反查（aqua ≡ cyan），每个匹配给出 hex/rgb/hsl/相对亮度 |

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
```

## 特性

- **输入格式**：hex 缩写/全写（3/4/6/8 位）、传统逗号语法（`rgb(255, 0, 0)`）与现代空格语法（`rgb(255 0 0 / 50%)`）、百分比（`rgb(100% 0% 0%)`）、色相角度单位（`deg`/`rad`/`grad`/`turn`）、全部 148 个 CSS Color 4 命名色、以及 `transparent`。
- **Alpha** 全程保留；hex 仅在 alpha < 1 时输出 8 位形式。
- **WCAG 数学**：按 WCAG 2.x 计算相对亮度（sRGB 线性化）、对比度 `(L1+0.05)/(L2+0.05)`；普通文字 AA 4.5 / AAA 7，大号文字（≥18pt 或 ≥14pt 加粗）AA 3 / AAA 4.5。
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
