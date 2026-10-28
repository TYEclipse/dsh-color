#!/usr/bin/env python3
"""dsh-color oracle — the authority for every numeric expectation in test/.

Independent re-implementation of the math the plugin performs, written in a
different language from the same published definitions (CSS Color 4, WCAG 2.x,
CSS Compositing and Blending §9.1, Sharma/Wu/Dalal 2005, Ottosson 2020). Nothing
here imports or mirrors `src/`; the TypeScript implementation is never read, only
disagreed with.

    python3 test/oracle/anchors.py            # print every anchor the tests assert
    python3 test/oracle/anchors.py --check    # self-check against published data

`--check` is the part that matters: it replays external ground truth (the 34-pair
CIEDE2000 reference table published by Sharma et al., the Oklab XYZ reference
table published by Ottosson, WCAG's exact 21:1 black-on-white, the CSS Color 4
keyword count) plus the domain invariants that catch transcription slips (white
must land exactly on a=b=0, a matrix times its inverse must be the identity).
A red self-check means the anchors themselves are untrustworthy.
"""

from __future__ import annotations

import argparse
import math
import sys

# ---------------------------------------------------------------------------
# sRGB plumbing (definitions from CSS Color 4 / IEC 61966-2-1)
# ---------------------------------------------------------------------------


def clamp(value: float, low: float, high: float) -> float:
    return min(high, max(low, value))


def srgb_to_linear(channel: float) -> float:
    """One sRGB channel, 0-255, to linear light 0-1."""
    c = channel / 255
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def linear_to_srgb(value: float) -> float:
    """Linear light to an sRGB channel 0-255 (not clamped)."""
    sign = -1 if value < 0 else 1
    abs_value = abs(value)
    if abs_value > 0.0031308:
        return sign * (1.055 * abs_value ** (1 / 2.4) - 0.055) * 255
    return 12.92 * value * 255


def serialize(value: float) -> int:
    """8-bit serialization: round half up, with the documented 1e-7 dust guard.

    Quantizing *before* comparing is the point — what a contrast check passes
    must be the color a renderer actually shows.
    """
    return int(clamp(math.floor(value + 1e-7 + 0.5), 0, 255))


def hex_of(rgb: tuple[float, float, float], alpha: float = 1.0) -> str:
    text = "#" + "".join(f"{serialize(c):02x}" for c in rgb)
    if alpha < 1:
        text += f"{serialize(alpha * 255):02x}"
    return text


def rgb_string(rgb: tuple[float, float, float], alpha: float = 1.0) -> str:
    r, g, b = (serialize(c) for c in rgb)
    if alpha >= 1:
        return f"rgb({r}, {g}, {b})"
    return f"rgba({r}, {g}, {b}, {round(alpha, 3)})"


def parse_hex(text: str) -> tuple[int, int, int, float]:
    digits = text.lstrip("#").lower()
    if len(digits) in (3, 4):
        digits = "".join(d * 2 for d in digits)
    if len(digits) == 6:
        digits += "ff"
    return (
        int(digits[0:2], 16),
        int(digits[2:4], 16),
        int(digits[4:6], 16),
        int(digits[6:8], 16) / 255,
    )


def rgb_to_hsl(r: float, g: float, b: float) -> tuple[float, float, float]:
    rn, gn, bn = r / 255, g / 255, b / 255
    hi, lo = max(rn, gn, bn), min(rn, gn, bn)
    lightness = (hi + lo) / 2
    if hi == lo:
        return 0.0, 0.0, lightness
    delta = hi - lo
    saturation = delta / (2 - hi - lo) if lightness > 0.5 else delta / (hi + lo)
    if hi == rn:
        hue = (gn - bn) / delta + (6 if gn < bn else 0)
    elif hi == gn:
        hue = (bn - rn) / delta + 2
    else:
        hue = (rn - gn) / delta + 4
    return hue * 60, saturation, lightness


def hsl_to_rgb(h: float, s: float, l: float) -> tuple[float, float, float]:
    if s == 0:
        return l * 255, l * 255, l * 255
    q = l * (1 + s) if l < 0.5 else l + s - l * s
    p = 2 * l - q
    hn = h / 360

    def channel(t: float) -> float:
        tt = t
        if tt < 0:
            tt += 1
        if tt > 1:
            tt -= 1
        if tt < 1 / 6:
            value = p + (q - p) * 6 * tt
        elif tt < 1 / 2:
            value = q
        elif tt < 2 / 3:
            value = p + (q - p) * (2 / 3 - tt) * 6
        else:
            value = p
        return min(q, max(p, value)) * 255

    return channel(hn + 1 / 3), channel(hn), channel(hn - 1 / 3)


def hwb_to_rgb(h: float, w: float, b: float) -> tuple[float, float, float]:
    if w + b >= 1:
        gray = (w / (w + b)) * 255
        return gray, gray, gray
    pure = hsl_to_rgb(h, 1, 0.5)
    factor = 1 - w - b
    return tuple(pure[i] * factor + w * 255 for i in range(3))  # type: ignore[return-value]


def luminance(rgb: tuple[float, float, float]) -> float:
    """WCAG relative luminance (alpha ignored)."""
    r, g, b = (srgb_to_linear(c) for c in rgb)
    return 0.2126 * r + 0.7152 * g + 0.0722 * b


def contrast(first: tuple[float, float, float], second: tuple[float, float, float]) -> float:
    a, b = luminance(first), luminance(second)
    return (max(a, b) + 0.05) / (min(a, b) + 0.05)


# ---------------------------------------------------------------------------
# Compositing (CSS Compositing and Blending §9.1) and premultiplied interpolation
# ---------------------------------------------------------------------------


def blend_over(src: tuple[float, float, float, float], dst: tuple[float, float, float, float]) -> tuple[float, float, float, float]:
    sa, da = src[3], dst[3]
    out_a = sa + da * (1 - sa)
    if out_a == 0:
        return 0.0, 0.0, 0.0, 0.0
    channels = tuple((src[i] * sa + dst[i] * da * (1 - sa)) / out_a for i in range(3))
    return channels[0], channels[1], channels[2], out_a


def blend_mix(first: tuple[float, float, float, float], second: tuple[float, float, float, float], weight: float) -> tuple[float, float, float, float]:
    w2 = clamp(weight, 0, 1)
    w1 = 1 - w2
    out_a = first[3] * w1 + second[3] * w2
    if out_a == 0:
        return 0.0, 0.0, 0.0, 0.0
    channels = tuple((first[i] * first[3] * w1 + second[i] * second[3] * w2) / out_a for i in range(3))
    return channels[0], channels[1], channels[2], out_a


# ---------------------------------------------------------------------------
# Contrast repair (same deterministic scan+bisect contract as the tool)
# ---------------------------------------------------------------------------

BLACK = (0.0, 0.0, 0.0, 1.0)
WHITE = (255.0, 255.0, 255.0, 1.0)


def ensure_contrast(
    fg: tuple[float, float, float, float],
    bg: tuple[float, float, float, float],
    target: float,
    direction: str = "auto",
) -> dict[str, object]:
    base = contrast(fg[:3], bg[:3])
    if direction == "auto":
        resolved = "lighten" if contrast(WHITE[:3], bg[:3]) > contrast(BLACK[:3], bg[:3]) else "darken"
    else:
        resolved = direction
    if base >= target:
        return {"ok": True, "changed": False, "direction": resolved, "ratio": base, "shift": 0.0, "rgba": fg}

    h, s, l = rgb_to_hsl(fg[0], fg[1], fg[2])
    extreme = 0.0 if resolved == "darken" else 1.0

    def at(t: float) -> tuple[float, float, float, float]:
        rgb = hsl_to_rgb(h, s, l + (extreme - l) * t)
        return serialize(rgb[0]), serialize(rgb[1]), serialize(rgb[2]), fg[3]

    low, high, passing = 0.0, 0.0, None
    steps = 1000
    for i in range(1, steps + 1):
        t = i / steps
        candidate = at(t)
        if contrast(candidate[:3], bg[:3]) >= target:
            low, high, passing = (i - 1) / steps, t, candidate
            break
    if passing is None:
        best = at(1.0)
        return {
            "ok": False,
            "changed": False,
            "direction": resolved,
            "best_hex": hex_of(best[:3]),
            "best_ratio": contrast(best[:3], bg[:3]),
        }
    for _ in range(20):
        mid = (low + high) / 2
        candidate = at(mid)
        if contrast(candidate[:3], bg[:3]) >= target:
            high, passing = mid, candidate
        else:
            low = mid
    return {
        "ok": True,
        "changed": True,
        "direction": resolved,
        "hex": hex_of(passing[:3]),
        "ratio": contrast(passing[:3], bg[:3]),
        "shift": (extreme - l) * high * 100,
    }


# ---------------------------------------------------------------------------
# Harmonies and adjustments
# ---------------------------------------------------------------------------

HUE_OFFSETS = {
    "complementary": [0, 180],
    "triadic": [0, 120, 240],
    "split-complementary": [0, 150, 210],
    "tetradic": [0, 60, 180, 240],
    "square": [0, 90, 180, 270],
}


def normalize_hue(degrees: float) -> float:
    mod = degrees % 360
    return mod + 360 if mod < 0 else mod


def harmony_lightness(l: float, count: int) -> list[float]:
    n = int(clamp(count, 2, 9))
    low, high = max(0.02, l - 0.4), min(0.98, l + 0.4)
    step = (high - low) / (n - 1)
    return [low + step * i for i in range(n)]


def adjust(h: float, s: float, l: float, op: str, amount: float) -> tuple[float, float, float]:
    if op == "lighten":
        return h, s, clamp(l + clamp(amount, 0, 100) / 100, 0, 1)
    if op == "darken":
        return h, s, clamp(l - clamp(amount, 0, 100) / 100, 0, 1)
    if op == "saturate":
        return (h, s, l) if s == 0 else (h, clamp(s + clamp(amount, 0, 100) / 100, 0, 1), l)
    if op == "desaturate":
        return h, clamp(s - clamp(amount, 0, 100) / 100, 0, 1), l
    return normalize_hue(h + amount), s, l


# ---------------------------------------------------------------------------
# CIELAB / CIEDE2000 (CIE 15, Sharma-Wu-Dalal 2005)
# ---------------------------------------------------------------------------

# D65 derived from its 4-figure chromaticity coordinates, exactly as CSS Color 4
# writes it, so the white point and the matrix below stay consistent.
D65 = (0.3127 / 0.3290, 1.0, (1 - 0.3127 - 0.3290) / 0.3290)

# linear sRGB -> XYZ (rational form, CSS Color 4 §8)
SRGB_TO_XYZ = (
    (506752 / 1228815, 87881 / 245763, 12673 / 70218),
    (87098 / 409605, 175762 / 245763, 12673 / 175545),
    (7918 / 409605, 87881 / 737289, 1001167 / 1053270),
)
XYZ_TO_SRGB = (
    (12831 / 3959, -329 / 214, -1974 / 3959),
    (-851781 / 878810, 1648619 / 878810, 36519 / 878810),
    (705 / 12673, -2585 / 12673, 705 / 667),
)
LAB_EPS = 216 / 24389
LAB_KAPPA = 24389 / 27


def mat_vec(m, v):
    return tuple(sum(m[i][j] * v[j] for j in range(3)) for i in range(3))


def mat_mul(a, b):
    return tuple(tuple(sum(a[i][k] * b[k][j] for k in range(3)) for j in range(3)) for i in range(3))


def mat_inverse_gauss(m):
    """Invert a 3x3 by Gauss-Jordan elimination (a different method from src/)."""
    rows = [list(m[i]) + [1.0 if i == j else 0.0 for j in range(3)] for i in range(3)]
    for col in range(3):
        pivot = max(range(col, 3), key=lambda r: abs(rows[r][col]))
        if abs(rows[pivot][col]) < 1e-15:
            raise ValueError("singular matrix")
        rows[col], rows[pivot] = rows[pivot], rows[col]
        scale = rows[col][col]
        rows[col] = [value / scale for value in rows[col]]
        for r in range(3):
            if r == col:
                continue
            factor = rows[r][col]
            rows[r] = [rows[r][k] - factor * rows[col][k] for k in range(6)]
    return tuple(tuple(rows[i][3:]) for i in range(3))


def rgb_to_xyz(rgb: tuple[float, float, float]) -> tuple[float, float, float]:
    return mat_vec(SRGB_TO_XYZ, tuple(srgb_to_linear(c) for c in rgb))


def xyz_to_lab(xyz) -> tuple[float, float, float]:
    def f(value: float, white: float) -> float:
        t = value / white
        return t ** (1 / 3) if t > LAB_EPS else (LAB_KAPPA * t + 16) / 116

    fx, fy, fz = (f(xyz[i], D65[i]) for i in range(3))
    return 116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)


def lab_to_xyz(lab) -> tuple[float, float, float]:
    fy = (lab[0] + 16) / 116
    fx = fy + lab[1] / 500
    fz = fy - lab[2] / 200

    def back(f: float) -> float:
        cube = f ** 3
        return cube if cube > LAB_EPS else (116 * f - 16) / LAB_KAPPA

    return tuple(back(f) * D65[i] for i, f in enumerate((fx, fy, fz)))  # type: ignore[return-value]


def rgb_to_lab(rgb: tuple[float, float, float]) -> tuple[float, float, float]:
    return xyz_to_lab(rgb_to_xyz(rgb))


def delta_e76(a, b) -> float:
    return math.dist(a, b)


def delta_e2000(lab1, lab2) -> float:
    """CIEDE2000 with kL = kC = kH = 1 (Sharma, Wu & Dalal 2005, eq. 22)."""
    l1, a1, b1 = lab1
    l2, a2, b2 = lab2
    c1 = math.hypot(a1, b1)
    c2 = math.hypot(a2, b2)
    c_bar = (c1 + c2) / 2
    g = 0.5 * (1 - math.sqrt(c_bar**7 / (c_bar**7 + 25**7)))
    a1p, a2p = a1 * (1 + g), a2 * (1 + g)
    c1p, c2p = math.hypot(a1p, b1), math.hypot(a2p, b2)

    def hue(a: float, b: float) -> float:
        angle = math.degrees(math.atan2(b, a))
        return angle + 360 if angle < 0 else angle

    h1p, h2p = hue(a1p, b1), hue(a2p, b2)
    d_lp = l2 - l1
    d_cp = c2p - c1p
    if c1p * c2p == 0:
        d_hp = 0.0
    else:
        diff = h2p - h1p
        d_hp = diff - 360 if diff > 180 else (diff + 360 if diff < -180 else diff)
    big_dh = 2 * math.sqrt(c1p * c2p) * math.sin(math.radians(d_hp / 2))

    l_bar_p = (l1 + l2) / 2
    c_bar_p = (c1p + c2p) / 2
    if c1p * c2p == 0:
        h_bar_p = h1p + h2p
    elif abs(h1p - h2p) <= 180:
        h_bar_p = (h1p + h2p) / 2
    elif h1p + h2p < 360:
        h_bar_p = (h1p + h2p + 360) / 2
    else:
        h_bar_p = (h1p + h2p - 360) / 2

    t = (
        1
        - 0.17 * math.cos(math.radians(h_bar_p - 30))
        + 0.24 * math.cos(math.radians(2 * h_bar_p))
        + 0.32 * math.cos(math.radians(3 * h_bar_p + 6))
        - 0.20 * math.cos(math.radians(4 * h_bar_p - 63))
    )
    d_theta = 30 * math.exp(-(((h_bar_p - 275) / 25) ** 2))
    r_c = 2 * math.sqrt(c_bar_p**7 / (c_bar_p**7 + 25**7))
    s_l = 1 + (0.015 * (l_bar_p - 50) ** 2) / math.sqrt(20 + (l_bar_p - 50) ** 2)
    s_c = 1 + 0.045 * c_bar_p
    s_h = 1 + 0.015 * c_bar_p * t
    r_t = -math.sin(math.radians(2 * d_theta)) * r_c

    l_term, c_term, h_term = d_lp / s_l, d_cp / s_c, big_dh / s_h
    return math.sqrt(l_term**2 + c_term**2 + h_term**2 + r_t * c_term * h_term)


# ---------------------------------------------------------------------------
# Oklab (Ottosson 2020) and perceptual ramps
# ---------------------------------------------------------------------------

# Oklab M1/M2 in the 64-bit form CSS Color 4 §13 recalculated for a consistent
# D65 reference white ("recalculated for 64bit precision", w3c/csswg-drafts#6642).
# Ottosson's original 2020 constants pair with his older sRGB matrix and drift
# ~1e-4 from the modern white; the point of using these is that sRGB white lands
# on (1, 0, 0) exactly, which is what makes the invariant below a real check.
XYZ_TO_LMS = (
    (0.8190224379967030, 0.3619062600528904, -0.1288737815209879),
    (0.0329836539323885, 0.9292868615863434, 0.0361446663506424),
    (0.0481771893596242, 0.2642395317527308, 0.6335478284694309),
)
LMS_TO_OKLAB = (
    (0.2104542683093140, 0.7936177747023054, -0.0040720430116193),
    (1.9779985324311684, -2.4285922420485799, 0.4505937096174110),
    (0.0259040424655478, 0.7827717124575296, -0.8086757549230774),
)
LMS_TO_XYZ = mat_inverse_gauss(XYZ_TO_LMS)
OKLAB_TO_LMS = mat_inverse_gauss(LMS_TO_OKLAB)
OKLAB_TO_SRGB = mat_mul(XYZ_TO_SRGB, LMS_TO_XYZ)


def rgb_to_oklab(rgb: tuple[float, float, float]) -> tuple[float, float, float]:
    lms = mat_vec(XYZ_TO_LMS, rgb_to_xyz(rgb))
    return mat_vec(LMS_TO_OKLAB, tuple(math.copysign(abs(v) ** (1 / 3), v) for v in lms))


def oklab_to_rgb(lab) -> tuple[float, float, float]:
    lms = mat_vec(OKLAB_TO_LMS, lab)
    linear = mat_vec(OKLAB_TO_SRGB, tuple(v**3 for v in lms))
    return tuple(clamp(linear_to_srgb(v), 0, 255) for v in linear)  # type: ignore[return-value]


def mix(first, second, weight: float, space: str = "oklab", alpha1: float = 1.0, alpha2: float = 1.0):
    """Mix two opaque RGB triples; returns (rgb, alpha)."""
    t = clamp(weight, 0, 1)
    alpha = alpha1 + (alpha2 - alpha1) * t
    if space == "srgb":
        return tuple(first[i] + (second[i] - first[i]) * t for i in range(3)), alpha
    a = rgb_to_oklab(first)
    b = rgb_to_oklab(second)
    return oklab_to_rgb(tuple(a[i] + (b[i] - a[i]) * t for i in range(3))), alpha


def scale_ramp(base, target, mode: str, steps: int, space: str = "oklab"):
    n = int(clamp(steps, 2, 11))
    white, black = (255.0, 255.0, 255.0), (0.0, 0.0, 0.0)
    out = []
    for i in range(n):
        t = i / (n - 1) if n > 1 else 0.0
        if mode == "tints":
            rgb, alpha = mix(base, white, t, space)
        elif mode == "shades":
            rgb, alpha = mix(base, black, t, space)
        elif mode == "both":
            w = -1 + 2 * t
            rgb, alpha = mix(base, black, -w, space) if w < 0 else mix(base, white, w, space)
        else:
            rgb, alpha = mix(base, target or base, t, space)
        out.append((hex_of(rgb, alpha), rgb_string(rgb, alpha), rgb, alpha))
    return out


def mix_alpha_ramp(base, base_alpha: float, mode: str, steps: int, space: str = "oklab"):
    """The same ramps as scale_ramp, but starting from a translucent base color.

    Alpha is interpolated linearly in both spaces (white/black count as opaque),
    so a tint ramp fades toward fully opaque white.
    """
    n = int(clamp(steps, 2, 11))
    white, black = (255.0, 255.0, 255.0), (0.0, 0.0, 0.0)
    out = []
    for i in range(n):
        t = i / (n - 1) if n > 1 else 0.0
        if mode == "tints":
            rgb, alpha = mix(base, white, t, space, base_alpha, 1.0)
        elif mode == "shades":
            rgb, alpha = mix(base, black, t, space, base_alpha, 1.0)
        elif mode == "both":
            w = -1 + 2 * t
            rgb, alpha = (mix(base, black, -w, space, base_alpha, 1.0) if w < 0
                          else mix(base, white, w, space, base_alpha, 1.0))
        else:
            rgb, alpha = mix(base, base, t, space, base_alpha, 1.0)
        out.append((hex_of(rgb, alpha), rgb_string(rgb, alpha), rgb, alpha))
    return out


# ---------------------------------------------------------------------------
# Published reference data (the external rulers used by --check)
# ---------------------------------------------------------------------------

# Sharma, Wu & Dalal (2005), "The CIEDE2000 color-difference formula:
# implementation notes, supplementary test data, and mathematical observations",
# Color Research & Application 30(1) — the canonical 34-pair verification table,
# retrieved from the author's page (hajim.rochester.edu, ciede2000testdata.txt).
# Columns: L1 a1 b1 L2 a2 b2 published dE00.
CIEDE2000_REFERENCE = [
    (50.0000, 2.6772, -79.7751, 50.0000, 0.0000, -82.7485, 2.0425),
    (50.0000, 3.1571, -77.2803, 50.0000, 0.0000, -82.7485, 2.8615),
    (50.0000, 2.8361, -74.0200, 50.0000, 0.0000, -82.7485, 3.4412),
    (50.0000, -1.3802, -84.2814, 50.0000, 0.0000, -82.7485, 1.0000),
    (50.0000, -1.1848, -84.8006, 50.0000, 0.0000, -82.7485, 1.0000),
    (50.0000, -0.9009, -85.5211, 50.0000, 0.0000, -82.7485, 1.0000),
    (50.0000, 0.0000, 0.0000, 50.0000, -1.0000, 2.0000, 2.3669),
    (50.0000, -1.0000, 2.0000, 50.0000, 0.0000, 0.0000, 2.3669),
    (50.0000, 2.4900, -0.0010, 50.0000, -2.4900, 0.0009, 7.1792),
    (50.0000, 2.4900, -0.0010, 50.0000, -2.4900, 0.0010, 7.1792),
    (50.0000, 2.4900, -0.0010, 50.0000, -2.4900, 0.0011, 7.2195),
    (50.0000, 2.4900, -0.0010, 50.0000, -2.4900, 0.0012, 7.2195),
    (50.0000, -0.0010, 2.4900, 50.0000, 0.0009, -2.4900, 4.8045),
    (50.0000, -0.0010, 2.4900, 50.0000, 0.0010, -2.4900, 4.8045),
    (50.0000, -0.0010, 2.4900, 50.0000, 0.0011, -2.4900, 4.7461),
    (50.0000, 2.5000, 0.0000, 50.0000, 0.0000, -2.5000, 4.3065),
    (50.0000, 2.5000, 0.0000, 73.0000, 25.0000, -18.0000, 27.1492),
    (50.0000, 2.5000, 0.0000, 61.0000, -5.0000, 29.0000, 22.8977),
    (50.0000, 2.5000, 0.0000, 56.0000, -27.0000, -3.0000, 31.9030),
    (50.0000, 2.5000, 0.0000, 58.0000, 24.0000, 15.0000, 19.4535),
    (50.0000, 2.5000, 0.0000, 50.0000, 3.1736, 0.5854, 1.0000),
    (50.0000, 2.5000, 0.0000, 50.0000, 3.2972, 0.0000, 1.0000),
    (50.0000, 2.5000, 0.0000, 50.0000, 1.8634, 0.5757, 1.0000),
    (50.0000, 2.5000, 0.0000, 50.0000, 3.2592, 0.3350, 1.0000),
    (60.2574, -34.0099, 36.2677, 60.4626, -34.1751, 39.4387, 1.2644),
    (63.0109, -31.0961, -5.8663, 62.8187, -29.7946, -4.0864, 1.2630),
    (61.2901, 3.7196, -5.3901, 61.4292, 2.2480, -4.9620, 1.8731),
    (35.0831, -44.1164, 3.7933, 35.0232, -40.0716, 1.5901, 1.8645),
    (22.7233, 20.0904, -46.6940, 23.0331, 14.9730, -42.5619, 2.0373),
    (36.4612, 47.8580, 18.3852, 36.2715, 50.5065, 21.2231, 1.4146),
    (90.8027, -2.0831, 1.4410, 91.1528, -1.6435, 0.0447, 1.4441),
    (90.9257, -0.5406, -0.9208, 88.6381, -0.8985, -0.7239, 1.5381),
    (6.7747, -0.2908, -2.4247, 5.8714, -0.0985, -2.2286, 0.6377),
    (2.0776, 0.0795, -1.1350, 0.9033, -0.0636, -0.5514, 0.9082),
]

# Ottosson, "A perceptual color space for image processing" (2020) — the XYZ→Oklab
# example table, rounded to three decimals by the author.
OKLAB_REFERENCE = [
    ((0.950, 1.000, 1.089), (1.000, 0.000, 0.000)),
    ((1.000, 0.000, 0.000), (0.450, 1.236, -0.019)),
    ((0.000, 1.000, 0.000), (0.922, -0.671, 0.263)),
    ((0.000, 0.000, 1.000), (0.153, -1.415, -0.449)),
]

# CSS Color 4 §6 defines exactly 148 color keywords (147 plus rebeccapurple);
# a handful of published hex values guard the table itself.
NAMED_KEYWORD_COUNT = 148
NAMED_SAMPLES = {
    "aliceblue": "f0f8ff",
    "tomato": "ff6347",
    "rebeccapurple": "663399",
    "aqua": "00ffff",
    "cyan": "00ffff",
    "white": "ffffff",
    "black": "000000",
}


# ---------------------------------------------------------------------------
# CVD simulation — Machado, Oliveira & Fernandes (2009), Table 1
# ---------------------------------------------------------------------------
# The matrices are the ones published with the paper (severity 0.0 … 1.0 in
# steps of 0.1). They act on linear RGB. Two facts about the table are the
# rulers `--check` uses, so a transcription slip cannot hide behind "both sides
# typed the same wrong number": severity 0.0 is exactly the identity, and every
# row sums to 1 (within the table's six decimals) so neutral colors stay neutral.

CVD_MATRICES = {
    "protan": (
        ((1.000000, 0.000000, 0.000000), (0.000000, 1.000000, 0.000000), (0.000000, 0.000000, 1.000000)),
        ((0.856167, 0.182038, -0.038205), (0.029342, 0.955115, 0.015544), (-0.002880, -0.001563, 1.004443)),
        ((0.734766, 0.334872, -0.069637), (0.051840, 0.919198, 0.028963), (-0.004928, -0.004209, 1.009137)),
        ((0.630323, 0.465641, -0.095964), (0.069181, 0.890046, 0.040773), (-0.006308, -0.007724, 1.014032)),
        ((0.539009, 0.579343, -0.118352), (0.082546, 0.866121, 0.051332), (-0.007136, -0.011959, 1.019095)),
        ((0.458064, 0.679578, -0.137642), (0.092785, 0.846313, 0.060902), (-0.007494, -0.016807, 1.024301)),
        ((0.385450, 0.769005, -0.154455), (0.100526, 0.829802, 0.069673), (-0.007442, -0.022190, 1.029632)),
        ((0.319627, 0.849633, -0.169261), (0.106241, 0.815969, 0.077790), (-0.007025, -0.028051, 1.035076)),
        ((0.259411, 0.923008, -0.182420), (0.110296, 0.804340, 0.085364), (-0.006276, -0.034346, 1.040622)),
        ((0.203876, 0.990338, -0.194214), (0.112975, 0.794542, 0.092483), (-0.005222, -0.041043, 1.046265)),
        ((0.152286, 1.052583, -0.204868), (0.114503, 0.786281, 0.099216), (-0.003882, -0.048116, 1.051998)),
    ),
    "deutan": (
        ((1.000000, 0.000000, 0.000000), (0.000000, 1.000000, 0.000000), (0.000000, 0.000000, 1.000000)),
        ((0.866435, 0.177704, -0.044139), (0.049567, 0.939063, 0.011370), (-0.003453, 0.007233, 0.996220)),
        ((0.760729, 0.319078, -0.079807), (0.090568, 0.889315, 0.020117), (-0.006027, 0.013325, 0.992702)),
        ((0.675425, 0.433850, -0.109275), (0.125303, 0.847755, 0.026942), (-0.007950, 0.018572, 0.989378)),
        ((0.605511, 0.528560, -0.134071), (0.155318, 0.812366, 0.032316), (-0.009376, 0.023176, 0.986200)),
        ((0.547494, 0.607765, -0.155259), (0.181692, 0.781742, 0.036566), (-0.010410, 0.027275, 0.983136)),
        ((0.498864, 0.674741, -0.173604), (0.205199, 0.754872, 0.039929), (-0.011131, 0.030969, 0.980162)),
        ((0.457771, 0.731899, -0.189670), (0.226409, 0.731012, 0.042579), (-0.011595, 0.034333, 0.977261)),
        ((0.422823, 0.781057, -0.203881), (0.245752, 0.709602, 0.044646), (-0.011843, 0.037423, 0.974421)),
        ((0.392952, 0.823610, -0.216562), (0.263559, 0.690210, 0.046232), (-0.011910, 0.040281, 0.971630)),
        ((0.367322, 0.860646, -0.227968), (0.280085, 0.672501, 0.047413), (-0.011820, 0.042940, 0.968881)),
    ),
    "tritan": (
        ((1.000000, 0.000000, 0.000000), (0.000000, 1.000000, 0.000000), (0.000000, 0.000000, 1.000000)),
        ((0.926670, 0.092514, -0.019184), (0.021191, 0.964503, 0.014306), (0.008437, 0.054813, 0.936750)),
        ((0.895720, 0.133330, -0.029050), (0.029997, 0.945400, 0.024603), (0.013027, 0.104707, 0.882266)),
        ((0.905871, 0.127791, -0.033662), (0.026856, 0.941251, 0.031893), (0.013410, 0.148296, 0.838294)),
        ((0.948035, 0.089490, -0.037526), (0.014364, 0.946792, 0.038844), (0.010853, 0.193991, 0.795156)),
        ((1.017277, 0.027029, -0.044306), (-0.006113, 0.958479, 0.047634), (0.006379, 0.248708, 0.744913)),
        ((1.104996, -0.046633, -0.058363), (-0.032137, 0.971635, 0.060503), (0.001336, 0.317922, 0.680742)),
        ((1.193214, -0.109812, -0.083402), (-0.058496, 0.979410, 0.079086), (-0.002346, 0.403492, 0.598854)),
        ((1.257728, -0.139648, -0.118081), (-0.078003, 0.975409, 0.102594), (-0.003316, 0.501214, 0.502102)),
        ((1.278864, -0.125333, -0.153531), (-0.084748, 0.957674, 0.127074), (-0.000989, 0.601151, 0.399838)),
        ((1.255528, -0.076749, -0.178779), (-0.078411, 0.930809, 0.147602), (0.004733, 0.691367, 0.303900)),
    ),
}

CVD_CLAMP_TOLERANCE = 1e-5


def cvd_matrix(kind: str, severity: float):
    """Interpolated matrix for a severity between the tabulated tenths."""
    table = CVD_MATRICES[kind]
    scaled = round(min(1.0, max(0.0, severity)) * 10, 9)
    low = int(scaled)
    weight = scaled - low
    high = min(10, low + 1)
    if weight == 0:
        return table[low]
    return tuple(
        tuple(table[low][r][c] + (table[high][r][c] - table[low][r][c]) * weight for c in range(3))
        for r in range(3)
    )


def simulate_cvd(rgb: tuple[float, float, float], kind: str, severity: float) -> tuple[tuple[float, float, float], float]:
    """(simulated 8-bit rgb floats, pre-clamp linear excursion)."""
    m = cvd_matrix(kind, severity)
    linear = [srgb_to_linear(c) for c in rgb]
    out = [sum(m[r][c] * linear[c] for c in range(3)) for r in range(3)]
    excursion = max(0.0, out[0] - 1, out[1] - 1, out[2] - 1, -out[0], -out[1], -out[2])
    encoded = (
        float(serialize(clamp(linear_to_srgb(clamp(out[0], 0.0, 1.0)), 0, 255))),
        float(serialize(clamp(linear_to_srgb(clamp(out[1], 0.0, 1.0)), 0, 255))),
        float(serialize(clamp(linear_to_srgb(clamp(out[2], 0.0, 1.0)), 0, 255))),
    )
    return encoded, excursion


def cvd_clamped(rgb: tuple[float, float, float], kind: str, severity: float) -> bool:
    return simulate_cvd(rgb, kind, severity)[1] > CVD_CLAMP_TOLERANCE


def cvd_shift(rgb: tuple[float, float, float], kind: str, severity: float) -> float:
    simulated = simulate_cvd(rgb, kind, severity)[0]
    return delta_e2000(rgb_to_lab(rgb), rgb_to_lab(simulated))


# ---------------------------------------------------------------------------
# Self-check
# ---------------------------------------------------------------------------


def check() -> int:
    failures: list[str] = []

    def report(name: str, ok: bool, detail: str) -> None:
        print(f"{'✅' if ok else '❌'} {name}: {detail}")
        if not ok:
            failures.append(name)

    # 1. CIEDE2000 against the published 34-pair table (tolerance = the table's
    #    own rounding, 4 decimals → half a unit in the last place).
    worst, worst_pair = 0.0, None
    for index, row in enumerate(CIEDE2000_REFERENCE):
        mine = delta_e2000(row[0:3], row[3:6])
        error = abs(mine - row[6])
        if error > worst:
            worst, worst_pair = error, index
    report(
        "CIEDE2000 vs Sharma et al. 2005 (34 pairs)",
        worst <= 5.1e-5,
        f"max |Δ| = {worst:.2e} on pair #{worst_pair}",
    )

    # 2. Oklab against the author's XYZ table. The table itself is rounded to
    #    three decimals upstream and was generated with the pre-2021 constants,
    #    which is the whole tolerance budget here (measured ≈4.1e-4).
    worst_lms, worst_xyz = 0.0, None
    for xyz, expected in OKLAB_REFERENCE:
        mine = mat_vec(LMS_TO_OKLAB, tuple(math.copysign(abs(v) ** (1 / 3), v) for v in mat_vec(XYZ_TO_LMS, xyz)))
        error = max(abs(mine[i] - expected[i]) for i in range(3))
        if error > worst_lms:
            worst_lms, worst_xyz = error, xyz
    report(
        "Oklab vs Ottosson's published XYZ table",
        worst_lms <= 1e-3,
        f"max |Δ| = {worst_lms:.2e} at XYZ {worst_xyz}",
    )

    # 3. Matrix inverses (Gauss-Jordan here vs adjugate in src/).
    identity = ((1.0, 0.0, 0.0), (0.0, 1.0, 0.0), (0.0, 0.0, 1.0))
    worst_inv = max(
        abs(mat_mul(XYZ_TO_LMS, LMS_TO_XYZ)[i][j] - identity[i][j])
        for i in range(3)
        for j in range(3)
    )
    worst_inv = max(
        worst_inv,
        max(abs(mat_mul(LMS_TO_OKLAB, OKLAB_TO_LMS)[i][j] - identity[i][j]) for i in range(3) for j in range(3)),
    )
    report("matrix inverses round-trip to identity", worst_inv <= 1e-12, f"max |Δ| = {worst_inv:.2e}")

    # 4. White point invariants: a transcription slip in either matrix breaks these.
    white_lab = rgb_to_lab((255.0, 255.0, 255.0))
    black_lab = rgb_to_lab((0.0, 0.0, 0.0))
    gray_lab = rgb_to_lab((128.0, 128.0, 128.0))
    white_oklab = rgb_to_oklab((255.0, 255.0, 255.0))
    report(
        "sRGB white → L* 100, a = b = 0",
        abs(white_lab[0] - 100) <= 1e-9 and abs(white_lab[1]) <= 1e-9 and abs(white_lab[2]) <= 1e-9,
        f"Lab = ({white_lab[0]:.10f}, {white_lab[1]:.2e}, {white_lab[2]:.2e})",
    )
    report(
        "sRGB black → Lab (0, 0, 0)",
        max(abs(v) for v in black_lab) <= 1e-12,
        f"Lab = ({black_lab[0]:.2e}, {black_lab[1]:.2e}, {black_lab[2]:.2e})",
    )
    report(
        "neutral grays stay on the a = b = 0 axis",
        abs(gray_lab[1]) <= 1e-9 and abs(gray_lab[2]) <= 1e-9,
        f"#808080 Lab = ({gray_lab[0]:.6f}, {gray_lab[1]:.2e}, {gray_lab[2]:.2e})",
    )
    report(
        "sRGB white → Oklab (1, 0, 0)",
        abs(white_oklab[0] - 1) <= 1e-9 and abs(white_oklab[1]) <= 1e-9 and abs(white_oklab[2]) <= 1e-9,
        f"Oklab = ({white_oklab[0]:.10f}, {white_oklab[1]:.2e}, {white_oklab[2]:.2e})",
    )

    # 5. Round trips: Lab and Oklab both have to survive a grid of colors.
    worst_trip = 0.0
    for r in (0, 17, 64, 128, 200, 255):
        for g in (0, 33, 96, 160, 255):
            for b in (0, 51, 128, 204, 255):
                rgb = (float(r), float(g), float(b))
                back = tuple(clamp(linear_to_srgb(v), 0, 255) for v in mat_vec(XYZ_TO_SRGB, lab_to_xyz(rgb_to_lab(rgb))))
                back_ok = oklab_to_rgb(rgb_to_oklab(rgb))
                worst_trip = max(worst_trip, max(abs(back[i] - rgb[i]) for i in range(3)))
                worst_trip = max(worst_trip, max(abs(back_ok[i] - rgb[i]) for i in range(3)))
    report("Lab / Oklab round-trips stay inside sRGB", worst_trip <= 1e-9, f"max channel |Δ| = {worst_trip:.2e}")

    # 6. WCAG anchors: the 21:1 extreme is exact by definition.
    report(
        "WCAG black on white = 21:1",
        abs(contrast((0.0, 0.0, 0.0), (255.0, 255.0, 255.0)) - 21) <= 1e-12,
        f"ratio = {contrast((0.0, 0.0, 0.0), (255.0, 255.0, 255.0)):.12f}",
    )
    report(
        "WCAG luminance of pure red = 0.2126",
        abs(luminance((255.0, 0.0, 0.0)) - 0.2126) <= 1e-12,
        f"Y = {luminance((255.0, 0.0, 0.0)):.12f}",
    )
    report(
        "WCAG #777777 on white = 4.48:1 (the classic AA boundary)",
        abs(contrast((119.0, 119.0, 119.0), (255.0, 255.0, 255.0)) - 4.48) <= 0.005,
        f"ratio = {contrast((119.0, 119.0, 119.0), (255.0, 255.0, 255.0)):.4f}",
    )

    # 7. Named-color table: a few published keywords must resolve to their hex.
    bad = {name: hex_of(parse_hex(hex_value)[:3]) for name, hex_value in NAMED_SAMPLES.items()}
    report(
        "CSS keyword samples resolve to their published hex",
        all(f"#{hex_value}" == bad[name] for name, hex_value in NAMED_SAMPLES.items()),
        f"{len(NAMED_SAMPLES)} samples checked, keyword count documented as {NAMED_KEYWORD_COUNT}",
    )

    # 8. CVD matrices (Machado et al. 2009): the table's own invariants are the
    #    ruler — a shared typo in oracle and implementation cannot survive them.
    row_sum_worst = 0.0
    identity_bad = 0
    for table in CVD_MATRICES.values():
        for index, m in enumerate(table):
            for row in m:
                row_sum_worst = max(row_sum_worst, abs(sum(row) - 1))
            for r in range(3):
                for c in range(3):
                    expected = 1.0 if r == c else 0.0
                    if index == 0 and abs(m[r][c] - expected) > 1e-12:
                        identity_bad += 1
    report("CVD table: severity 0.0 is exactly the identity", identity_bad == 0, f"{identity_bad} cells off identity")
    report(
        "CVD table: every row sums to 1 (neutrals stay neutral)",
        row_sum_worst <= 5e-6,
        f"max |row sum - 1| = {row_sum_worst:.2e} over {sum(len(t) for t in CVD_MATRICES.values())} matrices",
    )

    neutral_bad = []
    for kind in CVD_MATRICES:
        for gray in ((128.0, 128.0, 128.0), (255.0, 255.0, 255.0), (0.0, 0.0, 0.0), (17.0, 17.0, 17.0), (200.0, 200.0, 200.0)):
            shown = hex_of(simulate_cvd(gray, kind, 1.0)[0])
            if shown != hex_of(gray):
                neutral_bad.append(f"{kind} {hex_of(gray)}→{shown}")
    report(
        "CVD simulation leaves neutral colors on their own 8-bit value",
        not neutral_bad,
        "all grays unchanged" if not neutral_bad else ", ".join(neutral_bad),
    )

    # Physiology, not self-comparison: a red/green pair that a deuteranope
    # cannot separate, and a blue/yellow pair that only tritanopia disturbs.
    red_green_before = delta_e2000(rgb_to_lab((229.0, 57.0, 53.0)), rgb_to_lab((44.0, 160.0, 44.0)))
    red_green_deutan = delta_e2000(
        rgb_to_lab(simulate_cvd((229.0, 57.0, 53.0), "deutan", 1)[0]),
        rgb_to_lab(simulate_cvd((44.0, 160.0, 44.0), "deutan", 1)[0]),
    )
    report(
        "deuteranopia collapses a red/green pair (ΔE00 >60 → <2)",
        red_green_before > 60 and red_green_deutan < 2,
        f"ΔE00 {red_green_before:.4f} → {red_green_deutan:.4f}",
    )
    red_green_tritan = delta_e2000(
        rgb_to_lab(simulate_cvd((229.0, 57.0, 53.0), "tritan", 1)[0]),
        rgb_to_lab(simulate_cvd((44.0, 160.0, 44.0), "tritan", 1)[0]),
    )
    report(
        "tritanopia leaves that red/green pair far apart",
        red_green_tritan > 20,
        f"ΔE00 {red_green_tritan:.4f}",
    )

    monotone = [cvd_shift((255.0, 0.0, 0.0), "deutan", s) for s in (0.2, 0.4, 0.6, 0.8, 1.0)]
    report(
        "severity grows monotonically for #ff0000 under deuteranopia",
        all(monotone[i] < monotone[i + 1] for i in range(len(monotone) - 1)),
        " > ".join(f"{v:.2f}" for v in monotone),
    )

    print()
    if failures:
        print(f"❌ 自检失败 {len(failures)} 项：{', '.join(failures)}")
        return 1
    print("✅ 自检全部通过（oracle 可信）")
    return 0


# ---------------------------------------------------------------------------
# Anchor output
# ---------------------------------------------------------------------------


def p(label: str, value) -> None:
    if isinstance(value, float):
        print(f"  {label:52s} {value:.10g}")
    else:
        print(f"  {label:52s} {value}")


def anchors() -> None:
    print("dsh-color oracle — every value test/ asserts (independent implementation)")
    print("usage: python3 test/oracle/anchors.py [--check]")
    print()

    print("## A. parsing / formatting (legacy anchors, R42 regressions included)")
    p("#abc →", parse_hex("#abc"))
    p("#abcd →", parse_hex("#abcd"))
    p("#ff000080 alpha", parse_hex("#ff000080")[3])
    p("#f008 alpha", parse_hex("#f008")[3])
    p("rgb(51 102 153) channel r", 51.0)
    p("rgb(20% 40% 60%) → hex", hex_of((51.0, 102.0, 153.0)))
    p("hsl(120 100 25) → rgb channels", hsl_to_rgb(120.0, 1.0, 0.25))
    p("hsl(0.5turn,100%,50%) → rgb channels", hsl_to_rgb(180.0, 1.0, 0.5))
    p("hsl(210,100%,50%) → serialized rgb", tuple(serialize(c) for c in hsl_to_rgb(210.0, 1.0, 0.5)))
    p("hwb(0 40% 40%) → rgb channels", hwb_to_rgb(0.0, 0.4, 0.4))
    p("hwb(0 40% 60%) → rgb channels", hwb_to_rgb(0.0, 0.4, 0.6))
    p("hwbToRgb(0, 0.2, 0.3) → rgb channels", hwb_to_rgb(0.0, 0.2, 0.3))
    p("rgbToHsl(128,128,128).l", rgb_to_hsl(128.0, 128.0, 128.0)[2])
    p("rgbaToHslString(0,128,0) →", f"hsl(120, 100%, {round(rgb_to_hsl(0.0, 128.0, 0.0)[2] * 100, 1)}%)")
    p("round trip #ff7f50 → hex", hex_of(hsl_to_rgb(*rgb_to_hsl(*parse_hex("#ff7f50")[:3]))))
    p("148 CSS color keywords (CSS Color 4 §6)", NAMED_KEYWORD_COUNT)

    print()
    print("## B. WCAG contrast (legacy)")
    for a, b in ((("#000000", "#ffffff"), 21.0), (("#777777", "#ffffff"), 4.48), (("#767676", "#ffffff"), 4.54), (("#ff0000", "#ffffff"), 4.0), (("#123456", "#123456"), 1.0)):
        p(f"contrast {a[0]} vs {a[1]}", round(contrast(parse_hex(a[0])[:3], parse_hex(a[1])[:3]), 4))
    p("relativeLuminance(#ff0000)", round(luminance((255.0, 0.0, 0.0)), 4))
    p("relativeLuminance(#ffffff)", luminance((255.0, 255.0, 255.0)))
    p("relativeLuminance(#000000)", luminance((0.0, 0.0, 0.0)))

    print()
    print("## C. blending (legacy)")
    over1 = blend_over((255.0, 0.0, 0.0, 0.5), (255.0, 255.0, 255.0, 1.0))
    p("rgba(255,0,0,.5) over #ffffff → rgb", over1[:3])
    p("rgba(255,0,0,.5) over #ffffff → hex", hex_of(over1[:3], over1[3]))
    p("rgba(255,0,0,.5) over #ffffff → rgb() string", rgb_string(over1[:3], over1[3]))
    over2 = blend_over((0.0, 0.0, 255.0, 0.5), (0.0, 0.0, 0.0, 0.5))
    p("rgba(0,0,255,.5) over rgba(0,0,0,.5) alpha", over2[3])
    p("rgba(0,0,255,.5) over rgba(0,0,0,.5) blue", over2[2])
    p("rgba(0,0,255,.5) over rgba(0,0,0,.5) hex", hex_of(over2[:3], over2[3]))
    p("rgba(0,0,255,.5) over rgba(0,0,0,.5) rgb() string", rgb_string(over2[:3], over2[3]))
    over3 = blend_over((0.0, 128.0, 0.0, 0.25), (51.0, 102.0, 153.0, 1.0))
    p("rgba(0,128,0,.25) over #336699 hex", hex_of(over3[:3], over3[3]))
    p("rgba(0,128,0,.25) over #336699 rgb() string", rgb_string(over3[:3], over3[3]))
    p("transparent over #336699 red channel", blend_over((0.0, 0.0, 0.0, 0.0), (51.0, 102.0, 153.0, 1.0))[0])
    p("transparent over #336699 alpha", blend_over((0.0, 0.0, 0.0, 0.0), (51.0, 102.0, 153.0, 1.0))[3])
    mix1 = blend_mix((255.0, 0.0, 0.0, 1.0), (0.0, 0.0, 255.0, 1.0), 0.5)
    p("#ff0000 mix 0.5 #0000ff hex", hex_of(mix1[:3], mix1[3]))
    p("#ff0000 mix 0.5 #0000ff rgb() string", rgb_string(mix1[:3], mix1[3]))
    mix2 = blend_mix((255.0, 0.0, 0.0, 1.0), (0.0, 0.0, 255.0, 1.0), 0.25)
    p("#ff0000 mix 0.25 #0000ff hex", hex_of(mix2[:3], mix2[3]))
    p("#ff0000 mix 0.25 #0000ff rgb() string", rgb_string(mix2[:3], mix2[3]))
    mix3 = blend_mix((255.0, 0.0, 0.0, 0.5), (0.0, 0.0, 255.0, 1.0), 0.5)
    p("rgba(255,0,0,.5) mix .5 #0000ff hex", hex_of(mix3[:3], mix3[3]))
    p("rgba(255,0,0,.5) mix .5 #0000ff rgb() string", rgb_string(mix3[:3], mix3[3]))
    mix4 = blend_mix((51.0, 102.0, 153.0, 1.0), (255.0, 255.0, 255.0, 1.0), 0.8)
    p("#336699 mix 0.8 #ffffff hex", hex_of(mix4[:3], mix4[3]))
    p("#336699 mix 0.8 #ffffff rgb() string", rgb_string(mix4[:3], mix4[3]))
    p("#ff0000 mix 1.0 #0000ff hex (clamped weight)", hex_of(blend_mix((255.0, 0.0, 0.0, 1.0), (0.0, 0.0, 255.0, 1.0), 1.0)[:3]))
    p("#ff0000 mix 0.0 #0000ff hex (clamped weight)", hex_of(blend_mix((255.0, 0.0, 0.0, 1.0), (0.0, 0.0, 255.0, 1.0), 0.0)[:3]))

    print()
    print("## D. ensure_contrast (legacy; deterministic scan + bisect)")
    cases = [
        ("#777777", "#ffffff", 4.5, "auto"),
        ("#767676", "#ffffff", 4.5, "auto"),
        ("#555555", "#000000", 7.0, "auto"),
        ("#ff9900", "#ffffff", 4.5, "auto"),
        ("#ff9900", "#ffffff", 3.0, "auto"),
        ("#8080ff", "#808080", 7.0, "auto"),
        ("#336699", "#ffffff", 7.0, "darken"),
        ("#336699", "#ffffff", 4.5, "lighten"),
    ]
    for fg, bg, target, direction in cases:
        result = ensure_contrast(parse_hex(fg), parse_hex(bg), target, direction)
        label = f"{fg} on {bg} target {target} {direction}"
        p(f"{label} input ratio", round(contrast(parse_hex(fg)[:3], parse_hex(bg)[:3]), 2))
        p(f"{label} direction", result["direction"])
        if result.get("hex"):
            p(f"{label} hex", result["hex"])
            p(f"{label} ratio", round(float(result["ratio"]), 2))
            p(f"{label} lightness shift", round(float(result["shift"]), 2))
        if result.get("best_hex"):
            p(f"{label} best hex", result["best_hex"])
            p(f"{label} best ratio", round(float(result["best_ratio"]), 2))
        p(f"{label} changed", result["changed"])

    print()
    print("## E. harmonies / adjustments (legacy)")
    p("harmonyHsl(200,0.8,0.5,analogous) hues", [normalize_hue(200 + o) for o in (-30, 0, 30)])
    p("harmonyHsl(200,0.8,0.5,analogous,5) hues", [normalize_hue(200 + o) for o in (-60, -30, 0, 30, 60)])
    p("harmonyHsl(210,0.5,0.4,monochromatic,6) lightness", harmony_lightness(0.4, 6))
    p("adjustHsl(210,0.5,0.4,lighten,30).l", adjust(210, 0.5, 0.4, "lighten", 30)[2])
    p("adjustHsl(123,0.9,0.6,desaturate,100).s", adjust(123, 0.9, 0.6, "desaturate", 100)[1])
    p("adjustHsl(10,1,0.5,hue,-30).h", round(adjust(10, 1, 0.5, "hue", -30)[0], 4))
    p("adjustHsl(350,1,0.5,hue,400).h", round(adjust(350, 1, 0.5, "hue", 400)[0], 4))
    for text, op, amount in (
        ("#000000", "lighten", 50), ("#ffffff", "darken", 20), ("#bf4040", "saturate", 50),
        ("#ff0000", "desaturate", 100), ("#ff0000", "hue", 120), ("#ff0000", "hue", -30),
        ("#336699", "lighten", 25), ("#336699", "darken", 30), ("#336699", "desaturate", 60),
    ):
        h, s, l = rgb_to_hsl(*parse_hex(text)[:3])
        adjusted = adjust(h, s, l, op, amount)
        p(f"adjust {text} {op} {amount} → hex", hex_of(hsl_to_rgb(*adjusted)))

    print()
    print("## F. CIELAB + color_difference (new in v0.4.0)")
    for text in ("#ff0000", "#00ff00", "#0000ff", "#ffffff", "#808080", "#336699", "#3366ff", "#ff0080"):
        lab = rgb_to_lab(parse_hex(text)[:3])
        p(f"Lab {text}", tuple(round(v, 4) for v in lab))
    pairs = [
        ("#336699", "#3366ff"), ("#ff0000", "#ff0000"), ("#ffffff", "#000000"),
        ("#000000", "#010101"), ("#ff0000", "#00ff00"), ("#808080", "#7f7f7f"),
        ("#336699", "#336699"),
    ]
    for first, second in pairs:
        lab1 = rgb_to_lab(parse_hex(first)[:3])
        lab2 = rgb_to_lab(parse_hex(second)[:3])
        p(f"ΔE2000 {first} vs {second}", round(delta_e2000(lab1, lab2), 4))
        p(f"ΔE76 {first} vs {second}", round(delta_e76(lab1, lab2), 4))
    print("  published CIEDE2000 reference pairs (Sharma et al. 2005, as published):")
    for index in (6, 8, 15, 16, 17, 24, 33):
        row = CIEDE2000_REFERENCE[index]
        p(f"    pair #{index} Lab ({row[0]}, {row[1]}, {row[2]}) vs ({row[3]}, {row[4]}, {row[5]})", row[6])
        p(f"    pair #{index} oracle value", round(delta_e2000(row[0:3], row[3:6]), 4))

    print()
    print("## G. Oklab + color_scale (new in v0.4.0)")
    for text in ("#ff0000", "#336699", "#ffffff", "#808080"):
        p(f"Oklab {text}", tuple(round(v, 6) for v in rgb_to_oklab(parse_hex(text)[:3])))
    for mode, steps, space, target in (
        ("tints", 5, "oklab", None), ("shades", 5, "oklab", None), ("both", 5, "oklab", None),
        ("both", 4, "oklab", None), ("between", 4, "oklab", "#ff0080"), ("tints", 3, "srgb", None),
        ("tints", 5, "srgb", None),
    ):
        base_rgb = parse_hex("#336699")[:3]
        target_rgb = parse_hex(target)[:3] if target else None
        ramp = scale_ramp(base_rgb, target_rgb, mode, steps, space)
        label = f"{mode} {steps} {space} from #336699" + (f" to {target}" if target else "")
        print(f"  color_scale {label}:")
        base_lab = rgb_to_lab(base_rgb)
        for index, (hex_value, rgb_value, rgb, alpha) in enumerate(ramp):
            delta = delta_e2000(base_lab, rgb_to_lab(rgb))
            p(f"    step {index}", f"{hex_value}  {rgb_value}  ΔE00 {round(delta, 4)}")
    p("scale steps clamp low (1 → 2)", len(scale_ramp(parse_hex("#336699")[:3], None, "tints", 1)))
    p("scale steps clamp high (42 → 11)", len(scale_ramp(parse_hex("#336699")[:3], None, "tints", 42)))
    p("default steps", 5)

    print()
    print("## H. alpha handling in ramps (new in v0.4.0)")
    base_rgb = parse_hex("#336699")[:3]
    for index, (hex_value, rgb_value, _rgb, alpha) in enumerate(mix_alpha_ramp(base_rgb, 0.5, "tints", 3, "oklab")):
        p(f"    translucent tints 3 step {index}", f"{hex_value}  {rgb_value}  alpha {round(alpha, 3)}")
    for index, (hex_value, rgb_value, _rgb, alpha) in enumerate(mix_alpha_ramp(base_rgb, 0.5, "both", 3, "oklab")):
        p(f"    translucent both 3 step {index}", f"{hex_value}  {rgb_value}  alpha {round(alpha, 3)}")


    print()
    print("## I. difference verdict bands (new in v0.4.0)")
    for value in (0, 1, 1.5, 2, 2.5, 10, 25, 49, 50, 100):
        band = ("identical" if value <= 1 else "barely-perceptible" if value <= 2
                else "perceptible" if value <= 10 else "different" if value <= 49 else "very-different")
        p(f"ΔE00 {value} → band", band)


    print()
    print("## J. CVD simulation (new in v0.5.0)")
    cvd_colors = ("#ff0000", "#00ff00", "#0000ff", "#1565c0", "#e53935", "#2ca02c", "#673ab7", "#9c27b0", "#e91e63")
    for kind in ("protan", "deutan", "tritan"):
        print(f"  cvd_simulate {kind} severity 1:")
        for text in cvd_colors:
            rgb = parse_hex(text)[:3]
            shown, excursion = simulate_cvd(rgb, kind, 1.0)
            p(
                f"    {text}",
                f"{hex_of(shown)}  {rgb_string(shown)}  ΔE00 {round(cvd_shift(rgb, kind, 1.0), 4)}"
                f"  clamped {cvd_clamped(rgb, kind, 1.0)}  excursion {round(excursion, 8)}",
            )
    for kind, pairs in (
        ("deutan", (("#ff0000", "#00ff00"), ("#e53935", "#2ca02c"), ("#3f51b5", "#673ab7"), ("#d32f2f", "#c62828"))),
        ("protan", (("#673ab7", "#9c27b0"), ("#2e7d32", "#c62828"))),
        ("tritan", (("#e53935", "#e91e63"), ("#1565c0", "#00897b"))),
    ):
        print(f"  cvd pairs {kind} severity 1:")
        for first, second in pairs:
            before = delta_e2000(rgb_to_lab(parse_hex(first)[:3]), rgb_to_lab(parse_hex(second)[:3]))
            after = delta_e2000(
                rgb_to_lab(simulate_cvd(parse_hex(first)[:3], kind, 1.0)[0]),
                rgb_to_lab(simulate_cvd(parse_hex(second)[:3], kind, 1.0)[0]),
            )
            p(f"    {first} vs {second}", f"before {round(before, 4)}  after {round(after, 4)}  collapse(2) {before >= 2 and after < 2}")
    print("  cvd severity sweep (#ff0000, deutan):")
    for severity in (0.0, 0.2, 0.5, 0.55, 0.8, 1.0):
        rgb = parse_hex("#ff0000")[:3]
        shown = simulate_cvd(rgb, "deutan", severity)[0]
        p(f"    severity {severity}", f"{hex_of(shown)}  {rgb_string(shown)}  ΔE00 {round(cvd_shift(rgb, 'deutan', severity), 4)}")
    rgb = parse_hex("#ff0000")[:3]
    p("matrix row 0 of deutan severity 0.55", tuple(round(v, 6) for v in cvd_matrix("deutan", 0.55)[0]))
    p("matrix row 0 of deutan severity 1.0", CVD_MATRICES["deutan"][10][0])
    for text in ("#ffffff", "#808080", "#000000", "#336699"):
        rgb = parse_hex(text)[:3]
        p(f"clamped? {text} deutan 1", cvd_clamped(rgb, "deutan", 1.0))
        p(f"clamped? {text} tritan 1", cvd_clamped(rgb, "tritan", 1.0))


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description="dsh-color oracle")
    parser.add_argument("--check", action="store_true", help="self-check against published reference data")
    args = parser.parse_args(argv)
    if args.check:
        return check()
    anchors()
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
