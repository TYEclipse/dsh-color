# CHANGELOG · dsh-color

> 版本口径：patch 修 bug/补测试｜minor 新增用户可见功能｜major 破坏性变更。安装：`dsh plugin --profile web add github:TYEclipse/dsh-color`

## [0.3.0] — 2026-09-18
### Minor · R42
- 新增 `blend_colors`：`over`（Alpha 合成——半透明叠加真实显示的颜色）与 `mix`（预乘 sRGB 插值，即 CSS `color-mix(in srgb, …)` 的算法），可设权重
- 新增 `ensure_contrast`：保留色相与饱和度，只把明度推向黑或白，给出在指定背景上刚好达到 WCAG AA/AAA 的最小改动颜色；目标不可达时如实返回最佳可达对比度
- 修复 `rgb()` 裸数字量纲：`rgb(51, 102, 153)` 曾被误乘 255 并钳成 `#ffffff`；`hsl()`/`hwb()` 裸数字改按百分比解释（`hsl(210 100 50)` = `hsl(210, 100%, 50%)`）
- 测试 97 → 109 条，覆盖率 90.03% → 92.63%（棘轮已上调）

### Added (en)
- `blend_colors` — alpha compositing (`over`) and premultiplied sRGB interpolation (`mix`, the `color-mix()` math), with an adjustable weight.
- `ensure_contrast` — the smallest lightness change to a foreground that reaches a WCAG AA/AAA target on a background; reports the best achievable ratio when the target is unreachable.

### Fixed (en)
- Bare numbers in `rgb()` are on the 0–255 scale again (mid-range inputs used to be scaled by 255 and clamped to `#ffffff`); bare numbers in `hsl()`/`hwb()` now read as percentages.
- 109 tests (from 97), coverage 92.63%.

## [0.2.3] — 2026-09-11
### Patch · R31
- [自主进化] 接入版本与覆盖率门禁（工具链）

## [0.2.2] — 2026-09-11
### Patch · R31
- [自主进化] 接入版本与覆盖率门禁（工具链）

## [0.2.1] — 2026-09-11
### Patch · R31
- [自主进化] 接入版本与覆盖率门禁（工具链）

