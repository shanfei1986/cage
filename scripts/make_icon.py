#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
生成应用图标：build/icon.png（512）与 build/icon.ico（多尺寸）。
纯标准库实现（zlib + struct），不依赖 Pillow。

图形：蓝色圆角方块 + 白色文档 + 蓝色文字线 + 右下角绿色对勾。
先用 3 倍分辨率逐像素判定、再盒式降采样，得到平滑边缘。
"""

import os
import struct
import zlib

OUT_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'build')
SUPER = 3  # 超采样倍数


# ─────────────────────────── 几何工具 ───────────────────────────

def sd_round_rect(px, py, cx, cy, hw, hh, r):
    """圆角矩形的有符号距离，<=0 表示在内部"""
    dx = abs(px - cx) - (hw - r)
    dy = abs(py - cy) - (hh - r)
    ax, ay = max(dx, 0.0), max(dy, 0.0)
    return (ax * ax + ay * ay) ** 0.5 + min(max(dx, dy), 0.0) - r


def sd_segment(px, py, x1, y1, x2, y2):
    """点到线段的距离"""
    vx, vy = x2 - x1, y2 - y1
    wx, wy = px - x1, py - y1
    L2 = vx * vx + vy * vy
    t = 0.0 if L2 == 0 else max(0.0, min(1.0, (wx * vx + wy * vy) / L2))
    dx, dy = px - (x1 + t * vx), py - (y1 + t * vy)
    return (dx * dx + dy * dy) ** 0.5


def sd_triangle(px, py, ax, ay, bx, by, cx, cy):
    """三角形：用三条边的半平面判断（顺时针点序）"""
    def cross(x1, y1, x2, y2, x3, y3):
        return (x2 - x1) * (y3 - y1) - (y2 - y1) * (x3 - x1)
    d1 = cross(ax, ay, bx, by, px, py)
    d2 = cross(bx, by, cx, cy, px, py)
    d3 = cross(cx, cy, ax, ay, px, py)
    if (d1 >= 0 and d2 >= 0 and d3 >= 0) or (d1 <= 0 and d2 <= 0 and d3 <= 0):
        return -1.0
    return 1.0


def over(dst, src):
    """src over dst，均为 (r, g, b, a)，a 取 0..1"""
    dr, dg, db, da = dst
    sr, sg, sb, sa = src
    oa = sa + da * (1 - sa)
    if oa <= 0:
        return (0.0, 0.0, 0.0, 0.0)
    return (
        (sr * sa + dr * da * (1 - sa)) / oa,
        (sg * sa + dg * da * (1 - sa)) / oa,
        (sb * sa + db * da * (1 - sa)) / oa,
        oa,
    )


def mix(c1, c2, t):
    return tuple(c1[i] + (c2[i] - c1[i]) * t for i in range(3))


# ─────────────────────────── 绘制 ───────────────────────────

BLUE_TOP = (0.259, 0.529, 1.0)      # #4287ff
BLUE_BOTTOM = (0.043, 0.353, 0.851)  # #0b5ad9
WHITE = (1.0, 1.0, 1.0)
LINE = (0.086, 0.467, 1.0)          # #1677ff
GREEN = (0.322, 0.769, 0.102)       # #52c41a


def render(size):
    """渲染 size×size 的 RGBA 像素（返回 float 列表，a 为 0..1）"""
    n = size
    px = [0.0] * (n * n * 4)

    # 归一化坐标下的常量（乘上 n 就是像素坐标）
    bg_cx, bg_cy = 0.5 * n, 0.5 * n
    bg_hw = bg_hh = 0.463 * n
    bg_r = 0.215 * n

    doc_cx, doc_cy = 0.485 * n, 0.47 * n
    doc_hw, doc_hh = 0.205 * n, 0.255 * n
    doc_r = 0.030 * n

    # 文档右上角折角
    fold = 0.085 * n
    fold_x = doc_cx + doc_hw
    fold_y = doc_cy - doc_hh

    line_h = 0.022 * n
    lines = [
        (0.355 * n, 0.455 * n, 0.625 * n, 0.455 * n),
        (0.355 * n, 0.545 * n, 0.625 * n, 0.545 * n),
        (0.355 * n, 0.635 * n, 0.520 * n, 0.635 * n),
    ]

    badge_cx, badge_cy = 0.700 * n, 0.720 * n
    badge_r = 0.170 * n
    ring = 0.030 * n  # 与文档之间的留白描边宽度

    ck_a = (0.618 * n, 0.722 * n)
    ck_b = (0.678 * n, 0.782 * n)
    ck_c = (0.788 * n, 0.648 * n)
    ck_w = 0.036 * n

    for y in range(n):
        for x in range(n):
            fx, fy = x + 0.5, y + 0.5
            c = (0.0, 0.0, 0.0, 0.0)

            # 1) 圆角方块背景（带上下渐变）
            if sd_round_rect(fx, fy, bg_cx, bg_cy, bg_hw, bg_hh, bg_r) <= 0:
                t = max(0.0, min(1.0, (fy - (bg_cy - bg_hh)) / (2 * bg_hh)))
                c = over(c, mix(BLUE_TOP, BLUE_BOTTOM, t) + (1.0,))

            # 2) 文档白底
            if sd_round_rect(fx, fy, doc_cx, doc_cy, doc_hw, doc_hh, doc_r) <= 0:
                # 挖掉右上角，形成折角效果
                if not (fx > fold_x - fold and fy < fold_y + fold):
                    c = over(c, WHITE + (1.0,))

            # 3) 折角小三角（同样白色，但稍暗一点以示层次）
            if sd_triangle(fx, fy, fold_x, fold_y, fold_x, fold_y + fold, fold_x - fold, fold_y) <= 0:
                c = over(c, (0.878, 0.906, 0.949, 1.0))

            # 4) 文档上的文字线
            for (x1, y1, x2, y2) in lines:
                if (sd_segment(fx, fy, x1, y1, x2, y2) - line_h * 0.5) <= 0:
                    c = over(c, LINE + (1.0,))

            # 5) 右下角对勾徽标：先铺一圈白环，再画绿圆，最后画白勾
            d_badge = ((fx - badge_cx) ** 2 + (fy - badge_cy) ** 2) ** 0.5
            if d_badge <= badge_r + ring:
                c = over(c, WHITE + (1.0,))
            if d_badge <= badge_r:
                c = over(c, GREEN + (1.0,))

            d_ck = min(
                sd_segment(fx, fy, ck_a[0], ck_a[1], ck_b[0], ck_b[1]),
                sd_segment(fx, fy, ck_b[0], ck_b[1], ck_c[0], ck_c[1]),
            )
            if d_ck - ck_w * 0.5 <= 0:
                c = over(c, WHITE + (1.0,))

            i = (y * n + x) * 4
            px[i] = c[0]
            px[i + 1] = c[1]
            px[i + 2] = c[2]
            px[i + 3] = c[3]

    return px


def downsample(src, src_size, dst_size):
    """盒式降采样（整数倍最理想，非整数倍用面积加权平均）"""
    if src_size == dst_size:
        return src
    scale = src_size / dst_size
    out = [0.0] * (dst_size * dst_size * 4)
    for dy in range(dst_size):
        y0 = int(dy * scale)
        y1 = max(y0 + 1, int((dy + 1) * scale))
        for dx in range(dst_size):
            x0 = int(dx * scale)
            x1 = max(x0 + 1, int((dx + 1) * scale))
            acc = [0.0, 0.0, 0.0, 0.0]
            cnt = 0
            for sy in range(y0, min(y1, src_size)):
                base = sy * src_size
                for sx in range(x0, min(x1, src_size)):
                    i = (base + sx) * 4
                    acc[0] += src[i]
                    acc[1] += src[i + 1]
                    acc[2] += src[i + 2]
                    acc[3] += src[i + 3]
                    cnt += 1
            j = (dy * dst_size + dx) * 4
            if cnt:
                out[j] = acc[0] / cnt
                out[j + 1] = acc[1] / cnt
                out[j + 2] = acc[2] / cnt
                out[j + 3] = acc[3] / cnt
    return out


# ─────────────────────────── 编码 ───────────────────────────

def to_bytes(px):
    return bytes(
        max(0, min(255, int(round(v * 255)))) for v in px
    )


def chunk(tag, data):
    body = tag + data
    return struct.pack('>I', len(data)) + body + struct.pack('>I', zlib.crc32(body) & 0xFFFFFFFF)


def write_png(path, size, rgba):
    raw = bytearray()
    stride = size * 4
    for y in range(size):
        raw.append(0)  # filter type 0
        raw += rgba[y * stride:(y + 1) * stride]
    png = b'\x89PNG\r\n\x1a\n'
    png += chunk(b'IHDR', struct.pack('>IIBBBBB', size, size, 8, 6, 0, 0, 0))
    png += chunk(b'IDAT', zlib.compress(bytes(raw), 9))
    png += chunk(b'IEND', b'')
    with open(path, 'wb') as f:
        f.write(png)


def write_ico(path, images):
    """images: [(size, png_bytes)]，使用 PNG 压缩的 ICO 条目（Vista+ 支持，256 必须用）"""
    count = len(images)
    header = struct.pack('<HHH', 0, 1, count)
    offset = 6 + 16 * count
    entries = b''
    payload = b''
    for size, data in images:
        dim = 0 if size >= 256 else size
        entries += struct.pack(
            '<BBBBHHII', dim, dim, 0, 0, 1, 32, len(data), offset + len(payload)
        )
        payload += data
    with open(path, 'wb') as f:
        f.write(header + entries + payload)


def main():
    os.makedirs(OUT_DIR, exist_ok=True)

    # 基准尺寸取 512：Windows 的 ico 里最大那档只需要 256，但 electron-builder
    # 在非 Windows 平台打「解包验证」包时会要求图标至少 512×512，
    # 而 512 的 png 顺手也能当高清图标用。超过 512 只是徒增渲染时间。
    base = 512
    print(f'渲染 {base}×{base}（{SUPER} 倍精度）…')
    # 先在 base*SUPER 上逐像素渲染，再降到 base，得到平滑边缘
    big = render(base * SUPER)
    px = downsample(big, base * SUPER, base)
    rgba = to_bytes(px)

    png_path = os.path.join(OUT_DIR, 'icon.png')
    write_png(png_path, base, rgba)
    print('已生成', png_path)

    sizes = [16, 32, 48, 64, 128, 256]
    images = []
    for s in sizes:
        small = downsample(px, base, s)
        data = to_bytes(small)
        # 复用 write_png 的逻辑但输出到内存
        raw = bytearray()
        stride = s * 4
        for y in range(s):
            raw.append(0)
            raw += data[y * stride:(y + 1) * stride]
        png = b'\x89PNG\r\n\x1a\n'
        png += chunk(b'IHDR', struct.pack('>IIBBBBB', s, s, 8, 6, 0, 0, 0))
        png += chunk(b'IDAT', zlib.compress(bytes(raw), 9))
        png += chunk(b'IEND', b'')
        images.append((s, png))
        print(f'  {s}×{s} 完成')

    ico_path = os.path.join(OUT_DIR, 'icon.ico')
    write_ico(ico_path, images)
    print('已生成', ico_path)


if __name__ == '__main__':
    main()
