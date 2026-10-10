# CHANGELOG · dsh-color

> 版本口径：patch 修 bug/补测试｜minor 新增用户可见功能｜major 破坏性变更。安装：`dsh plugin --profile web add github:TYEclipse/dsh-color`

## [0.4.0] — 2026-10-11
### Minor · R66
- 新增 `color_difference`：量化两个颜色「看起来差多少」——CIEDE2000（Sharma、Wu & Dalal 2005 公式，含两个色相均值特例）与 CIE76、两者的 CIELAB 坐标（D65 白点）、白话判定（identical / barely-perceptible / perceptible / different / very-different）与容差检查（默认 2，判定一律用感知量 ΔE00）
- 新增 `color_scale`：从基色生成感知等距色阶——`tints`（基色 → 白）、`shades`（基色 → 黑）、`both`（黑 → 基色 → 白，奇数步时基色居中）、`between`（基色 → 第二个颜色）；默认在 Oklab 空间插值（实测比 sRGB 通道插值更均匀），越界结果钳回 sRGB；alpha 线性插值（向白 tint 会渐变为不透明）；每步给出与基色的 ΔE00
- oracle 迁入仓内 `test/oracle/anchors.py`：独立 Python 实现（不共享任何 TS 代码），`--check` 自检含 **Sharma 等 2005 发表的 34 对 CIEDE2000 参考数据**（实测最大偏差 4.95e-5，即数据本身的舍入位）、Ottosson 的 Oklab XYZ 参考表、以及「sRGB 白必须落在 Lab a=b=0 / Oklab (1,0,0)」等矩阵转写不变量
- 测试 100 → 138 条，覆盖率 92.63% → 94.74%（棘轮已上调）；7 个测试文件全部带 `ORACLE:` 标记

### Added (en)
- `color_difference` — CIEDE2000 (Sharma/Wu/Dalal 2005, both hue-average special cases), CIE76, both CIELAB colors under D65, a plain-language verdict and a tolerance check (default 2, always compared against the perceptual ΔE00).
- `color_scale` — perceptually even ramps from a base color: `tints`, `shades`, `both` (black → base → white, base centered on odd step counts) and `between`; interpolated in Oklab by default (measurably more even than sRGB channel interpolation), out-of-gamut steps clamped back into sRGB, alpha interpolated linearly, each step reporting its ΔE00 from the base.

### Quality (en)
- The expected-value oracle moved in-repo to `test/oracle/anchors.py` (independent Python, no shared code with `src/`); its `--check` replays the published 34-pair CIEDE2000 reference table (max deviation 4.95e-5 = the table's own rounding), Ottosson's Oklab XYZ table, and matrix-transcription invariants (sRGB white must land on Lab a=b=0 and Oklab (1,0,0)).
- Tests 100 → 138, coverage 92.63% → 94.74% (baseline ratcheted up).

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

